from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from sztu_docs_backend.latex_bundle import LatexBundleError, build_latex_bundle


def _write_sources(directory: Path, *, absolute_path: bool = False) -> Path:
    directory.mkdir()
    (directory / "main.tex").write_text(
        "\\input{proposal-fonts.tex}\n\\input{proposal-data.tex}\n"
        + ("/Users/example/private.tex\n" if absolute_path else ""),
        encoding="utf-8",
    )
    (directory / "proposal-data.tex").write_text(
        "\\def\\ProposalTitle{虚构课题}\n", encoding="utf-8"
    )
    (directory / "proposal-fonts.tex").write_text(
        "\\setCJKmainfont[Path={/Users/example/Fonts/}]{SimSun.ttf}\n",
        encoding="utf-8",
    )
    (directory / "official-template.docx").write_bytes(b"not redistributed")
    (directory / "private-font.otf").write_bytes(b"not redistributed")
    proposal = directory.parent / "proposal.json"
    proposal.write_text(
        json.dumps(
            {
                "schema_version": "0.2",
                "metadata": {"title": "虚构课题"},
                "sections": {},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return proposal


def _write_midterm_sources(directory: Path) -> Path:
    directory.mkdir()
    (directory / "main.tex").write_text(
        "\\input{midterm-fonts.tex}\n"
        "\\input{midterm-typography.tex}\n"
        "\\input{midterm-data.tex}\n",
        encoding="utf-8",
    )
    (directory / "midterm-data.tex").write_text(
        "\\def\\ThesisTitle{虚构中期检查课题}\n", encoding="utf-8"
    )
    (directory / "midterm-fonts.tex").write_text(
        "\\newCJKfontfamily\\formtitle[Path={/Users/example/Fonts/}]{FZ.ttf}\n",
        encoding="utf-8",
    )
    (directory / "midterm-typography.tex").write_text(
        "\\newcommand{\\SZTUTitleSize}{\\zihao{2}}\n", encoding="utf-8"
    )
    midterm = directory.parent / "midterm.json"
    midterm.write_text(
        json.dumps(
            {
                "schema_version": "0.1",
                "metadata": {"title": "虚构中期检查课题"},
                "sections": {},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return midterm


def _write_task_book_sources(directory: Path) -> Path:
    directory.mkdir()
    for name, content in {
        "main.tex": "\\input{task-book-fonts.tex}\n\\input{task-book-data.tex}\n",
        "task-book-data.tex": "\\def\\TaskTitle{虚构任务书课题}\n",
        "task-book-fixed.tex": "\\def\\TaskFixedTitle{任务书}\n",
        "task-book-fonts.tex": "\\newCJKfontfamily\\schoolmark[Path={/Users/example/Fonts/}]{STXingkai.ttf}\n",
        "task-book-typography.tex": "\\newcommand{\\TaskBodySize}{\\zihao{-4}}\n",
    }.items():
        (directory / name).write_text(content, encoding="utf-8")
    assets = directory / "assets"
    assets.mkdir()
    (assets / "workflow-a1b2c3d4e5f6.png").write_bytes(b"synthetic-png")
    task_book = directory.parent / "task-book.json"
    task_book.write_text(
        json.dumps(
            {
                "schema_version": "0.1",
                "metadata": {"title": "虚构任务书课题"},
                "sections": {},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return task_book


class LatexBundleTests(unittest.TestCase):
    def test_task_book_bundle_is_portable_and_keeps_hashed_local_assets(self) -> None:
        with tempfile.TemporaryDirectory(prefix="latex-bundle-test-") as root:
            root_path = Path(root)
            source = root_path / "generated"
            task_book = _write_task_book_sources(source)
            first = root_path / "task-book-first.zip"
            second = root_path / "task-book-second.zip"
            result = build_latex_bundle(
                source, task_book, first, document_type="task_book"
            )
            build_latex_bundle(
                source, task_book, second, document_type="task_book"
            )
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with zipfile.ZipFile(first) as archive:
                names = archive.namelist()
                manifest = json.loads(archive.read("bundle-manifest.json"))
                font_config = archive.read("task-book-fonts.tex")
            self.assertIn("assets/workflow-a1b2c3d4e5f6.png", names)
            self.assertIn("task-book.json", names)
            self.assertEqual(manifest["document_type"], "task_book")
            self.assertEqual(
                manifest["task_book_sha256"], manifest["input_sha256"]
            )
            self.assertNotIn(b"/Users/", font_config)
            self.assertIn(b"STXingkai", font_config)
            self.assertFalse(result["details"]["fonts_embedded"])

    def test_midterm_bundle_is_portable_and_uses_a_frozen_midterm_snapshot(self) -> None:
        with tempfile.TemporaryDirectory(prefix="latex-bundle-test-") as root:
            root_path = Path(root)
            source = root_path / "generated"
            midterm = _write_midterm_sources(source)
            output = root_path / "midterm.zip"
            result = build_latex_bundle(
                source,
                midterm,
                output,
                document_type="midterm",
            )
            with zipfile.ZipFile(output) as archive:
                names = archive.namelist()
                manifest = json.loads(archive.read("bundle-manifest.json"))
                font_config = archive.read("midterm-fonts.tex")
            self.assertEqual(
                names,
                [
                    "README.md",
                    "bundle-manifest.json",
                    "main.tex",
                    "midterm-data.tex",
                    "midterm-fonts.tex",
                    "midterm-typography.tex",
                    "midterm.json",
                ],
            )
            self.assertEqual(manifest["document_type"], "midterm")
            self.assertNotIn("proposal_sha256", manifest)
            self.assertNotIn(b"/Users/", font_config)
            self.assertFalse(result["details"]["fonts_embedded"])

    def test_bundle_is_byte_deterministic_and_excludes_restricted_assets(self) -> None:
        with tempfile.TemporaryDirectory(prefix="latex-bundle-test-") as root:
            root_path = Path(root)
            source = root_path / "generated"
            proposal = _write_sources(source)
            first = root_path / "first.zip"
            second = root_path / "second.zip"
            first_result = build_latex_bundle(source, proposal, first)
            second_result = build_latex_bundle(source, proposal, second)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(
                first_result["details"]["sha256"], second_result["details"]["sha256"]
            )
            self.assertEqual(first_result["check_id"], "latex-bundle")
            with zipfile.ZipFile(first) as archive:
                names = archive.namelist()
                self.assertEqual(names, sorted(names))
            self.assertEqual(
                names,
                [
                    "README.md",
                    "bundle-manifest.json",
                    "main.tex",
                    "proposal-data.tex",
                    "proposal-fonts.tex",
                    "proposal.json",
                ],
            )
            self.assertNotIn("official-template.docx", names)
            self.assertNotIn("private-font.otf", names)
            self.assertTrue(
                all(info.date_time == (1980, 1, 1, 0, 0, 0) for info in archive.infolist())
            )
            with zipfile.ZipFile(first) as archive:
                font_config = archive.read("proposal-fonts.tex")
                self.assertIn(b"SimSun", font_config)
                self.assertNotIn(b"/Users/", font_config)
                manifest = json.loads(archive.read("bundle-manifest.json"))
            self.assertFalse(manifest["fonts_embedded"])
            self.assertFalse(manifest["official_office_template_embedded"])

    def test_absolute_path_in_source_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="latex-bundle-test-") as root:
            root_path = Path(root)
            source = root_path / "generated"
            proposal = _write_sources(source, absolute_path=True)
            with self.assertRaises(LatexBundleError) as context:
                build_latex_bundle(source, proposal, root_path / "output.zip")
        self.assertEqual(context.exception.code, "LATEX_BUNDLE_ABSOLUTE_PATH")

    def test_required_source_symlink_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="latex-bundle-test-") as root:
            root_path = Path(root)
            source = root_path / "generated"
            proposal = _write_sources(source)
            target = source / "real-main.tex"
            (source / "main.tex").replace(target)
            (source / "main.tex").symlink_to(target)
            with self.assertRaises(LatexBundleError) as context:
                build_latex_bundle(source, proposal, root_path / "output.zip")
        self.assertEqual(context.exception.code, "LATEX_BUNDLE_INCOMPLETE")

    def test_invalid_proposal_json_is_rejected_without_path_echo(self) -> None:
        with tempfile.TemporaryDirectory(prefix="latex-bundle-test-") as root:
            root_path = Path(root)
            source = root_path / "generated"
            proposal = _write_sources(source)
            proposal.write_text("not json", encoding="utf-8")
            with self.assertRaises(LatexBundleError) as context:
                build_latex_bundle(source, proposal, root_path / "output.zip")
        self.assertEqual(context.exception.code, "LATEX_BUNDLE_INVALID_INPUT")
        self.assertNotIn(str(proposal), str(context.exception.details))


if __name__ == "__main__":
    unittest.main()
