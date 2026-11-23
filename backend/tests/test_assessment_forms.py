from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
import uuid
import zipfile
from pathlib import Path
from unittest.mock import patch

from sztu_docs_backend import template_engine
from sztu_docs_backend.exporter import (
    ASSESSMENT_METADATA_FIELDS, ExportError, _check_pdf, _run,
    build_export_document, content_check, run_export, validate_document, _render_content_without_editor_state,
)
from sztu_docs_backend.latex_bundle import build_latex_bundle
from sztu_docs_backend.docx_inspector import DocxInspectionError, inspect_docx, _check_assessment_prompts
from sztu_docs_backend.protocol import ProtocolSession, dispatch
from sztu_docs_backend.storage import Workspace
from sztu_docs_backend.template_engine import ASSESSMENT_DOCUMENT_TYPES, EngineDescriptor, TemplateEngineError


def fixture() -> dict:
    metadata = {field: '' for field in ASSESSMENT_METADATA_FIELDS}
    metadata.update(title='合成评审用途题目', student_name='合成学生', student_id='ASSESS-001', college='合成学院', major='合成专业')
    return {'schema_version': '0.1', 'metadata': metadata, 'sections': {
        'comments': [], 'division_of_work': [], 'suggested_grade': '',
        'questions': [], 'members': [], 'final_grade': '', 'date': '',
    }}


class AssessmentContractTests(unittest.TestCase):
    def test_missing_official_master_reports_an_actionable_code(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'templates/advisor-review').mkdir(parents=True)
            (root / 'scripts').mkdir()
            (root / 'scripts/validate_cjk_render.py').write_text('', encoding='utf-8')
            source = template_engine._workspace_source(root, 'advisor_review')
            for _, candidate in source.files:
                if candidate.name != 'official-template.docx':
                    candidate.parent.mkdir(parents=True, exist_ok=True)
                    candidate.write_bytes(b'')
            with self.assertRaises(TemplateEngineError) as error:
                template_engine._workspace_pack_sha256(source)
            self.assertEqual(error.exception.code, 'TEMPLATE_OFFICIAL_MASTER_MISSING')

    def test_blank_review_regions_and_optional_teachers_are_printable(self) -> None:
        for kind in ASSESSMENT_DOCUMENT_TYPES:
            with self.subTest(kind=kind):
                data = fixture()
                self.assertIs(validate_document(kind, data), data)
                self.assertEqual(content_check(data, kind)['status'], 'pass')

    def test_optional_editable_prompt_state_is_boolean_and_preserved(self) -> None:
        for value in (True, False):
            data = fixture(); data['sections']['editable_headings'] = value
            self.assertIs(validate_document('advisor_review', data), data)
            self.assertIs(_render_content_without_editor_state(data, 'advisor_review')['sections']['editable_headings'], value)
        for value in (0, 1, 'true', None, []):
            data = fixture(); data['sections']['editable_headings'] = value
            with self.subTest(value=value), self.assertRaises(ExportError):
                validate_document('advisor_review', data)
        contract = json.loads((Path(__file__).resolve().parents[2] / 'contracts/assessment-form.schema.json').read_text(encoding="utf-8"))
        self.assertEqual(contract['properties']['sections']['properties']['editable_headings']['type'], 'boolean')
        self.assertNotIn('editable_headings', contract['properties']['sections']['required'])

    def test_default_prompt_font_gate_respects_deletion_and_user_marks(self) -> None:
        from xml.etree import ElementTree
        namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
        document = ElementTree.fromstring(f'<w:document xmlns:w="{namespace}"><w:body><w:p><w:r><w:t>评语说明</w:t></w:r></w:p></w:body></w:document>')
        layout = {'regions': [{'key': 'prompt', 'label': '评语', 'value': '说明', 'label_font': 'heiti', 'label_size_pt': 14, 'font': 'songti', 'size_pt': 10.5}]}
        data = fixture(); data['sections']['editable_headings'] = True
        _check_assessment_prompts(document, data, layout)
        data['sections']['comments'] = [{'runs': [{'text': '评语说明', 'bold': True}]}]
        _check_assessment_prompts(document, data, layout)
        data['sections']['comments'] = ['评语说明']
        with self.assertRaises(DocxInspectionError) as raised:
            _check_assessment_prompts(document, data, layout)
        self.assertEqual(raised.exception.code, 'DOCX_FONT_MISMATCH')
        data['sections'].pop('editable_headings')
        with self.assertRaises(DocxInspectionError):
            _check_assessment_prompts(document, data, layout)

    def test_explicit_guidance_validates_shape_and_preserves_deletion(self) -> None:
        for value in (None, '', '（合成提示）', {'runs': []}, {'type': 'paragraph', 'runs': [{'text': '合成', 'italic': True}, {'text': '提示', 'script': 'super'}]}):
            data = fixture(); data['sections']['writing_guidance'] = {'comments': value}
            with self.subTest(value=value):
                self.assertIs(validate_document('advisor_review', data), data)
                self.assertEqual(_render_content_without_editor_state(data, 'advisor_review')['sections']['writing_guidance'], {'comments': value})
        for guidance in (None, [], {'title': ''}, {'comments': False}, {'comments': {'runs': [], 'signature': ''}}, {'comments': {'runs': [{'text': '', 'bold': True}]}}, {'comments': {'runs': [{'text': '提示', 'bold': 'yes'}]}}):
            data = fixture(); data['sections']['writing_guidance'] = guidance
            with self.subTest(guidance=guidance), self.assertRaises(ExportError):
                validate_document('advisor_review', data)
        data = fixture(); data['sections']['writing_guidance'] = {}
        self.assertIs(validate_document('advisor_review', data), data)
        contract = json.loads((Path(__file__).resolve().parents[2] / 'contracts/assessment-form.schema.json').read_text(encoding="utf-8"))
        self.assertEqual(set(contract['properties']['sections']['properties']['writing_guidance']['properties']), {'comments', 'division_of_work', 'questions'})

    def test_explicit_guidance_keeps_fixed_title_font_and_separate_indent(self) -> None:
        from xml.etree import ElementTree
        namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
        layout = {'regions': [{'key': 'prompt', 'label': '评语', 'value': '旧提示', 'label_font': 'heiti', 'label_size_pt': 14, 'font': 'songti', 'size_pt': 10.5, 'line_spacing_pt': 31.2, 'suffix': {'text': '：'}}]}
        layout['regions'][0]['guidance_style'] = {'fixed_label': {'font': 'heiti', 'size_pt': 14, 'bold': False, 'first_line_indent_em': 0}, 'text': {'font': 'songti', 'size_pt': 10.5}, 'fixed_suffix': {'font': 'songti', 'size_pt': 14, 'bold': False}}
        source = f'''<w:document xmlns:w="{namespace}"><w:body><w:p><w:pPr><w:ind w:firstLine="0" w:left="0"/><w:spacing w:line="624" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:eastAsia="黑体"/><w:sz w:val="28"/><w:b/></w:rPr><w:t>评语</w:t></w:r><w:r><w:rPr><w:rFonts w:eastAsia="宋体"/><w:sz w:val="21"/><w:i/></w:rPr><w:t>新提示</w:t></w:r><w:r><w:rPr><w:rFonts w:eastAsia="黑体"/><w:sz w:val="28"/><w:b/></w:rPr><w:t>：</w:t></w:r></w:p></w:body></w:document>'''
        source = source.replace('<w:b/>', '').replace('<w:rFonts w:eastAsia="黑体"/><w:sz w:val="28"/></w:rPr><w:t>：</w:t>', '<w:rFonts w:eastAsia="宋体"/><w:sz w:val="28"/></w:rPr><w:t>：</w:t>')
        data = fixture(); data['sections']['writing_guidance'] = {'comments': {'runs': [{'text': '新提示', 'italic': True}]}}
        _check_assessment_prompts(ElementTree.fromstring(source), data, layout)
        for changed, code in ((source.replace('w:firstLine="0"', 'w:firstLine="420"'), 'DOCX_PARAGRAPH_LAYOUT_MISMATCH'), (source.replace('<w:sz w:val="28"/>', '<w:sz w:val="28"/><w:b/>', 1), 'DOCX_FONT_MISMATCH'), (source.replace('<w:i/>', ''), 'DOCX_FONT_MISMATCH'), (source.replace('<w:rFonts w:eastAsia="宋体"/><w:sz w:val="28"/>', '<w:rFonts w:eastAsia="黑体"/><w:sz w:val="28"/>'), 'DOCX_FONT_MISMATCH')):
            with self.subTest(code=code), self.assertRaises(DocxInspectionError) as raised:
                _check_assessment_prompts(ElementTree.fromstring(changed), data, layout)
            self.assertEqual(raised.exception.code, code)
        data['sections']['writing_guidance']['comments'] = None
        _check_assessment_prompts(ElementTree.fromstring(source.replace('<w:t>新提示</w:t>', '<w:t/>')), data, layout)

    def test_required_identity_and_unknown_lower_fields_are_rejected(self) -> None:
        for field in ('title', 'student_name', 'student_id', 'college', 'major'):
            data = fixture(); data['metadata'][field] = ''
            with self.subTest(field=field), self.assertRaises(ExportError):
                validate_document('advisor_review', data)
        data = fixture(); data['sections']['signature'] = '禁止打印签名替代'
        with self.assertRaises(ExportError):
            validate_document('advisor_review', data)

    def test_semantic_text_questions_and_unbounded_nonnegative_final_grade(self) -> None:
        data = fixture()
        data['sections'].update(
            comments=[{'type': 'paragraph', 'runs': [{'text': 'H'}, {'text': '2', 'script': 'sub'}, {'text': 'O', 'bold': True}]}],
            questions=[{'question': ['合成问题。'], 'answer': ['合成回答。']}],
            members=['合成成员'], final_grade='105.5', suggested_grade='优秀', date='2026-10-02',
        )
        self.assertIs(validate_document('defense_record', data), data)
        self.assertEqual(data['sections']['final_grade'], '105.5')
        for score in ('-1', 'NaN', 'Infinity', '1e5', '字符串'):
            data['sections']['final_grade'] = score
            with self.subTest(score=score), self.assertRaises(ExportError):
                validate_document('grade_assessment', data)
        data = fixture(); data['sections']['comments'] = [{'type': 'image', 'path': 'private.png'}]
        with self.assertRaises(ExportError): validate_document('advisor_review', data)

    def test_shared_profile_merges_title_and_advisor_without_overwriting_reviewer(self) -> None:
        with Workspace.create_temporary() as workspace:
            profile = workspace.save_profile({'full_name': '当前合成学生', 'student_number': 'PROFILE-001', 'college': '当前合成学院', 'major': '当前合成专业', 'advisor_name': '合成导师', 'advisor_title': '副教授', 'thesis_title': ['当前共享题目']})
            data = fixture(); data['metadata'].update(reviewer='合成评阅人', reviewer_title='教授')
            record = {'content': data, 'profile_id': profile['id'], 'schema_version': '0.1', 'document_type': 'reviewer_review'}
            merged = build_export_document(workspace, record)
            self.assertEqual(merged['metadata']['title'], '当前共享题目')
            self.assertEqual(merged['metadata']['student_id'], 'PROFILE-001')
            self.assertEqual(merged['metadata']['advisor_title'], '副教授')
            self.assertEqual(merged['metadata']['reviewer'], '合成评阅人')
            self.assertEqual(data['metadata']['student_name'], '合成学生')

    def test_blank_editor_placeholders_are_removed_only_from_render_input(self) -> None:
        data = fixture()
        data['sections'].update(comments=['', {'type': 'paragraph', 'runs': []}], members=['', '  '], questions=[{'question': [''], 'answer': []}])
        normalized = _render_content_without_editor_state(data, 'defense_record')
        self.assertEqual(normalized['sections']['comments'], [])
        self.assertEqual(normalized['sections']['members'], [])
        self.assertEqual(normalized['sections']['questions'], [])
        self.assertEqual(data['sections']['members'], ['', '  '])
        data['sections']['questions'] = [{'question': [{'runs': [{'text': '', 'script': 'invalid'}]}], 'answer': []}]
        with self.assertRaises(ExportError):
            validate_document('defense_record', _render_content_without_editor_state(data, 'defense_record'))

    def test_pdf_page_count_is_enforced_before_fonts(self) -> None:
        pdf = Path('/tmp/synthetic.pdf')
        for count in (2, 0, None):
            info = 'Page size: 595 x 842 pts (A4)\n' + (f'Pages: {count}\n' if count is not None else '')
            with self.subTest(count=count), patch('sztu_docs_backend.exporter._run', return_value=info) as mocked:
                with self.assertRaises(ExportError) as raised:
                    _check_pdf(pdf, document_type='defense_record')
                self.assertEqual(raised.exception.code, 'SINGLE_PAGE_OVERFLOW')
                self.assertEqual(mocked.call_count, 1)
        fonts = (
            'name                                 type              encoding         emb sub uni object ID\n'
            '------------------------------------ ----------------- ----------------- ------------ --- --- --- ---\n'
            'ABCDEF+SimHei                        CID TrueType      Identity-H       yes yes yes      7  0\n'
            'ABCDEF+SimSun                        CID TrueType      Identity-H       yes yes yes      8  0\n'
            'ABCDEF+TimesNewRoman                 TrueType          WinAnsi          yes yes yes      9  0\n'
        )
        with patch('sztu_docs_backend.exporter._run', side_effect=['Page size: 595 x 842 pts (A4)\nPages: 1\n', fonts]):
            self.assertEqual(_check_pdf(pdf, document_type='grade_assessment')[0]['status'], 'pass')
        not_embedded = fonts.replace('yes yes yes      7  0', 'no  yes yes      7  0')
        with patch('sztu_docs_backend.exporter._run', side_effect=['Page size: 595 x 842 pts (A4)\nPages: 1\n', not_embedded]):
            with self.assertRaises(ExportError) as raised:
                _check_pdf(pdf, document_type='grade_assessment')
            self.assertEqual(raised.exception.code, 'PDF_FONT_NOT_EMBEDDED')

    def test_extra_pdf_page_never_reaches_output_or_completed_history(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); output = root / 'output'; output.mkdir()
            with Workspace.open_persistent(root / 'workspace') as workspace:
                data = fixture(); metadata = data['metadata']
                profile = workspace.save_profile({'full_name': metadata['student_name'], 'student_number': metadata['student_id'], 'college': metadata['college'], 'major': metadata['major']})
                doc = workspace.create_document({'document_type': 'defense_record', 'profile_id': profile['id'], 'template_version': '0.1', 'schema_version': '0.1', 'title': metadata['title']})
                workspace.save_draft(doc['id'], {'metadata': metadata, 'sections': data['sections']}, 0)
                descriptor = EngineDescriptor(root=root / 'engine', validator=root / 'validator.py', pack_sha256='a' * 64, source='synthetic', document_type='defense_record')
                def render(command, **kwargs):
                    if '--output-dir' in command:
                        generated = Path(command[command.index('--output-dir') + 1]); generated.mkdir()
                        (generated / 'main.pdf').write_bytes(b'synthetic two-page pdf')
                        return ''
                    if command[0] == 'pdfinfo':
                        return 'Page size: 595 x 842 pts (A4)\nPages: 2\n'
                    return ''
                with patch('sztu_docs_backend.exporter._run', side_effect=render), self.assertRaises(ExportError) as raised:
                    run_export(workspace, document_id=doc['id'], formats=['pdf'], output_directory=str(output), request_id=str(uuid.uuid4()), engine=descriptor)
                self.assertEqual(raised.exception.code, 'SINGLE_PAGE_OVERFLOW')
                self.assertEqual(list(output.iterdir()), [])
                job = workspace.database.connection.execute('SELECT status, error_code FROM export_jobs').fetchone()
                self.assertEqual(job['status'], 'failed')
                self.assertEqual(job['error_code'], 'SINGLE_PAGE_OVERFLOW')
                self.assertEqual(workspace.database.connection.execute('SELECT count(*) FROM export_artifacts').fetchone()[0], 0)

    def test_optional_date_requires_real_iso_calendar_date(self) -> None:
        for value in ('20261002', '2026-02-30', '2026/10/02', '2026-1-2'):
            data = fixture(); data['sections']['date'] = value
            with self.subTest(value=value), self.assertRaises(ExportError):
                validate_document('advisor_review', data)
        for value in ('', '2024-02-29'):
            data = fixture(); data['sections']['date'] = value
            self.assertIs(validate_document('advisor_review', data), data)

    def test_renderer_overflow_is_a_stable_sanitized_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(ExportError) as raised:
            _run([sys.executable, '-c', "import sys; print('SINGLE_PAGE_OVERFLOW: private input', file=sys.stderr); sys.exit(2)"], cwd=Path(tmp))
        self.assertEqual(raised.exception.code, 'SINGLE_PAGE_OVERFLOW')
        self.assertNotIn('private input', raised.exception.message)

    def test_renderer_overflow_names_only_allowlisted_fields(self) -> None:
        for diagnostic in ('SINGLE_PAGE_OVERFLOW: metadata.major private input', '! SINGLE_PAGE_OVERFLOW: major.'):
            with self.subTest(diagnostic=diagnostic), tempfile.TemporaryDirectory() as tmp, self.assertRaises(ExportError) as raised:
                _run([sys.executable, '-c', 'import sys; print(sys.argv[1], file=sys.stderr); sys.exit(2)', diagnostic], cwd=Path(tmp))
            self.assertEqual(raised.exception.code, 'SINGLE_PAGE_OVERFLOW')
            self.assertIn('“专业”栏', raised.exception.message)
            self.assertNotIn('private input', raised.exception.message)

    def test_protocol_can_create_each_type_without_database_tables(self) -> None:
        session = ProtocolSession()
        def request(method, params):
            result = dispatch({'protocol': '1.0', 'id': str(uuid.uuid4()), 'method': method, 'params': params}, session)
            self.assertNotIn('error', result)
            return result['result']
        try:
            request('workspace.open', {'mode': 'temporary'})
            for kind in ASSESSMENT_DOCUMENT_TYPES:
                doc = request('workspace.createDocument', {'document': {'document_type': kind, 'template_version': '0.1', 'schema_version': '0.1', 'title': '合成评审表'}})
                self.assertEqual(doc['document_type'], kind)
        finally:
            session.close()

    def test_source_zip_removes_font_paths_and_keeps_frozen_input(self) -> None:
        for kind in ASSESSMENT_DOCUMENT_TYPES:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); generated = root / 'latex'; generated.mkdir()
                (generated / 'main.tex').write_text('\\input{assessment-fonts.tex}\n\\input{body.tex}\n', encoding='utf-8')
                (generated / 'body.tex').write_text('合成基本信息', encoding='utf-8')
                (generated / 'assessment-fonts.tex').write_text('private fonts /Users/example/private.ttf', encoding='utf-8')
                source = root / 'input.json'; source.write_text(json.dumps(fixture(), ensure_ascii=False), encoding='utf-8')
                target = root / 'assessment.zip'
                self.assertEqual(build_latex_bundle(generated, source, target, document_type=kind)['status'], 'pass')
                with zipfile.ZipFile(target) as archive:
                    self.assertNotIn(b'/Users/', archive.read('assessment-fonts.tex'))
                    self.assertIn(b'AutoFakeBold=3,AutoFakeSlant=0.2', archive.read('assessment-fonts.tex'))
                    self.assertIn(b'\\newfontfamily\\assessmentTitleLatin', archive.read('assessment-fonts.tex'))
                    input_name = kind.replace('_', '-') + '.json'
                    self.assertEqual(json.loads(archive.read(input_name)), fixture())
                    self.assertFalse(any(name.endswith(('.ttf', '.docx')) for name in archive.namelist()))

    def test_available_local_templates_render_each_type_from_isolated_snapshot(self) -> None:
        source = Path(__file__).resolve().parents[3] / 'Thesis'
        if not (source / 'templates/common/python/assessment_word.py').is_file():
            self.skipTest('Adjacent assessment templates are unavailable.')
        if not all((source / f'templates/{kind.replace("_", "-")}/word/official-template.docx').is_file() for kind in ASSESSMENT_DOCUMENT_TYPES):
            self.skipTest('Validated local assessment Word masters are unavailable.')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = fixture()
            data['sections'].update(
                comments=[{'runs': [{'text': '合成富文本评语：', 'bold': True}, {'text': 'H'}, {'text': '2', 'script': 'sub'}, {'text': 'O。'}]}],
                division_of_work=['合成分工说明。'], suggested_grade='优秀',
                questions=[{'question': ['合成问题。'], 'answer': ['合成回答。']}],
                members=['合成成员甲'], final_grade='105.5', date='2026-10-02',
            )
            input_path = root / 'input.json'; input_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            for kind in sorted(ASSESSMENT_DOCUMENT_TYPES):
                with self.subTest(kind=kind):
                    data['sections']['editable_headings'] = kind == 'defense_record'
                    input_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                    descriptor, _, _ = template_engine._snapshot_workspace_engine(root / 'data', source, kind, source_label='test-workspace')
                    output = root / (kind + '.docx')
                    try:
                        _run([sys.executable, str(descriptor.root / 'word/render.py'), '--data', str(input_path), '--output', str(output)], cwd=root)
                    except ExportError as exc:
                        if exc.code == 'REQUIRED_FONT_MISSING':
                            self.skipTest('Required licensed fonts are unavailable.')
                        raise
                    layout = json.loads((descriptor.root / 'spec/layout.json').read_text(encoding="utf-8"))
                    result = inspect_docx(output, data, document_type=kind, layout=layout)
                    self.assertEqual(result['status'], 'pass')
                    self.assertFalse(result['details']['target_editor_verified'])

    def test_measured_defense_row_layout_passes_export_checks_and_rejects_stale_reports(self) -> None:
        from sztu_docs_backend.exporter import _assessment_docx_layout
        source = Path(__file__).resolve().parents[3] / 'Thesis'
        if not (source / 'templates/defense-record/word/official-template.docx').is_file():
            self.skipTest('Validated local defense master is unavailable.')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = fixture()
            data['metadata'].update(title='合成Windows安装包验收题目', student_name='合成验收学生', major='合成材料科学工程专业')
            input_path = root / 'input.json'
            input_path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
            descriptor, _, _ = template_engine._snapshot_workspace_engine(root / 'data', source, 'defense_record', source_label='test-workspace')
            output = root / 'defense.docx'
            report = root / 'effective-layout.json'
            try:
                _run([sys.executable, str(descriptor.root / 'word/render.py'), '--data', str(input_path), '--output', str(output), '--layout-output', str(report)], cwd=root)
            except ExportError as exc:
                if exc.code == 'REQUIRED_FONT_MISSING':
                    self.skipTest('Required document fonts are unavailable.')
                raise
            spec = descriptor.root / 'spec/layout.json'
            effective = _assessment_docx_layout(spec, input_path, report)
            original = json.loads(spec.read_text(encoding='utf-8'))
            self.assertNotEqual(effective['word']['row_heights_twips'], original['word']['row_heights_twips'])
            self.assertEqual(inspect_docx(output, data, document_type='defense_record', layout=effective)['status'], 'pass')
            input_path.write_text(input_path.read_text(encoding='utf-8') + '\n', encoding='utf-8')
            with self.assertRaises(ExportError) as failure:
                _assessment_docx_layout(spec, input_path, report)
            self.assertEqual(failure.exception.code, 'DOCX_EXPECTATION_INVALID')

    def test_deleted_editable_prompts_are_not_restored_in_docx(self) -> None:
        source = Path(__file__).resolve().parents[3] / 'Thesis'
        if not (source / 'templates/common/python/assessment_word.py').is_file():
            self.skipTest('Adjacent assessment templates are unavailable.')
        if not all((source / f'templates/{kind.replace("_", "-")}/word/official-template.docx').is_file() for kind in ASSESSMENT_DOCUMENT_TYPES):
            self.skipTest('Validated local assessment Word masters are unavailable.')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); data = fixture(); data['sections']['editable_headings'] = True
            input_path = root / 'input.json'; input_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            for kind in sorted(ASSESSMENT_DOCUMENT_TYPES):
                with self.subTest(kind=kind):
                    descriptor, _, _ = template_engine._snapshot_workspace_engine(root / 'data', source, kind, source_label='test-workspace')
                    output = root / (kind + '.docx')
                    _run([sys.executable, str(descriptor.root / 'word/render.py'), '--data', str(input_path), '--output', str(output)], cwd=root)
                    layout = json.loads((descriptor.root / 'spec/layout.json').read_text(encoding="utf-8"))
                    self.assertEqual(inspect_docx(output, data, document_type=kind, layout=layout)['status'], 'pass')
                    from xml.etree import ElementTree
                    with zipfile.ZipFile(output) as archive:
                        document = ElementTree.fromstring(archive.read('word/document.xml'))
                    text = ''.join(node.text or '' for node in document.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'))
                    for region in layout['regions']:
                        if region['key'] in {'prompt', 'division-label', 'questions-prompt'}:
                            self.assertNotIn(region['value'], text)
                            if region.get('label'): self.assertNotIn(region['label'], text)

    def test_assessment_snapshot_covers_support_files_and_rejects_symlinks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); source = root / 'source'; slug = 'advisor-review'
            # First enumerate the allowlist through a minimally located workspace.
            (source / f'templates/{slug}').mkdir(parents=True)
            (source / 'scripts').mkdir(); (source / 'scripts/validate_cjk_render.py').write_text('')
            engine_source = template_engine._workspace_source(source, 'advisor_review')
            for name, path in engine_source.files:
                path.parent.mkdir(parents=True, exist_ok=True); path.write_text('')
            shared = source / 'templates/common/python/assessment_forms.py'; shared.write_text('VALUE = 42\n')
            renderer = source / f'templates/{slug}/word/render.py'; renderer.write_text("import sys\nfrom pathlib import Path\nsys.path.insert(0,str(Path(__file__).resolve().parents[2]))\nfrom common.python.assessment_forms import VALUE\nprint(VALUE)\n")
            descriptor, _, _ = template_engine._snapshot_workspace_engine(root / 'data', source, 'advisor_review', source_label='test-workspace')
            frozen_guidance_schema = descriptor.root.parent / 'common/schema/writing-guidance.schema.json'
            self.assertTrue(frozen_guidance_schema.is_file())
            shared.write_text('VALUE = 99\n')
            result = subprocess.run([sys.executable, str(descriptor.root / 'word/render.py')], capture_output=True, text=True, check=True)
            self.assertEqual(result.stdout.strip(), '42')
            self.assertTrue(descriptor.template_id.startswith('sztu.advisor-review.'))
            renderer.unlink()
            try:
                renderer.symlink_to(shared)
            except OSError as exc:
                if getattr(exc, 'winerror', None) == 1314:
                    self.skipTest('Windows user lacks symbolic-link creation privilege')
                raise
            with self.assertRaises(TemplateEngineError):
                template_engine._snapshot_workspace_engine(root / 'data', source, 'advisor_review', source_label='test-workspace')
