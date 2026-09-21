from __future__ import annotations
import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from sztu_docs_backend.exporter import validate_midterm, ExportError
from sztu_docs_backend.docx_inspector import inspect_docx, DocxInspectionError

TEMPLATES = Path(__file__).resolve().parents[3] / 'Thesis' / 'templates'
FIXTURE = TEMPLATES / 'midterm/fixtures/embedded-tools.json'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

@unittest.skipUnless(FIXTURE.is_file(), 'Local template source with embedded-tools fixture required')
class EmbeddedToolTests(unittest.TestCase):
    def fixture(self):
        return json.loads(FIXTURE.read_text())

    def test_valid_tool_blocks_and_rejections(self):
        source = self.fixture()
        self.assertIs(validate_midterm(source), source)
        changes = [
            ('table style', lambda d: d['sections']['main_research_content'][1].update(style='unknown')),
            ('unequal cells', lambda d: d['sections']['main_research_content'][1]['rows'][0].update(cells=['only'])),
            ('empty cells', lambda d: d['sections']['main_research_content'][1]['rows'][0].update(cells=['', 'value'])),
            ('excess rows', lambda d: d['sections']['main_research_content'][1].update(rows=[{'cells':['a','b']}] * 41)),
            ('columns boolean', lambda d: d['sections']['progress'][1].update(columns=True)),
            ('columns range', lambda d: d['sections']['progress'][1].update(columns=5)),
            ('one image', lambda d: d['sections']['progress'][1].update(items=d['sections']['progress'][1]['items'][:1])),
            ('missing caption', lambda d: d['sections']['progress'][1].pop('caption')),
            ('unknown child fields', lambda d: d['sections']['progress'][1]['items'][0].update(script='bad')),
            ('reference in subcaption', lambda d: d['sections']['progress'][1]['items'][0].update(caption='{{fig:fig-tools_0001}}')),
        ]
        for label, change in changes:
            with self.subTest(label=label):
                document = copy.deepcopy(source); change(document)
                with self.assertRaises(ExportError): validate_midterm(document)

    def test_word_output_keeps_tables_grid_images_and_passes_deep_check(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            subprocess.run([sys.executable, str(TEMPLATES/'midterm/render.py'), '--data', str(FIXTURE), '--output-dir', str(output), '--format', 'word'], check=True, capture_output=True)
            docx = output / 'midterm.docx'
            result = inspect_docx(docx, self.fixture(), document_type='midterm')
            self.assertEqual(result['status'], 'pass')
            with ZipFile(docx) as archive: root = ET.fromstring(archive.read('word/document.xml'))
            tables = list(root.iter(W+'tbl'))
            self.assertEqual(len(tables), 4)
            three_line, grid, group = tables[1:]
            self.assertEqual(len(group.findall(W+'tr')), 2)
            self.assertEqual([len(row.findall(W+'tc')) for row in group.findall(W+'tr')], [2, 2])
            for row_index, row in enumerate(three_line.findall(W+'tr')):
                for cell in row.findall(W+'tc'):
                    borders = cell.find(W+'tcPr/'+W+'tcBorders')
                    self.assertEqual(borders.find(W+'left').get(W+'val'), 'nil')
                    self.assertEqual(borders.find(W+'right').get(W+'val'), 'nil')
                    self.assertEqual(borders.find(W+'top').get(W+'val'), 'single' if row_index == 0 else 'nil')
                    self.assertEqual(borders.find(W+'bottom').get(W+'val'), 'single' if row_index in (0, 2) else 'nil')
            self.assertEqual(grid.find(W+'tblPr/'+W+'tblBorders/'+W+'insideV').get(W+'val'), 'single')
            self.assertEqual(len(list(root.iter('{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}inline'))), 4)
            altered = self.fixture(); altered['sections']['progress'].pop(1)
            with self.assertRaises(DocxInspectionError): inspect_docx(docx, altered, document_type='midterm')
