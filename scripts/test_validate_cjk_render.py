#!/usr/bin/env python3
"""Regression tests for scripts/validate_cjk_render.py path handling.

On Windows, poppler converts argv to UTF-8 bytes for main(), but pdftotext and
pdftocairo open their output files with bare fopen(). A Chinese user name puts
%TEMP% on a non-ASCII path, so writing bbox HTML or page rasters there fails.
The validator therefore reads the bbox layout from stdout and renders pages
with pdftoppm, which writes through goo::openFile() (_wfopen on Windows).

These tests pin that contract and the unchanged PASS / FAIL / INCONCLUSIVE
semantics.
"""

from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO

from PIL import Image
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("validate_cjk_render.py")
PAGE_TOOLS = ("pdftotext", "pdftoppm")

# Two text lines produce at least two CJK "word" boxes in pdftotext bbox output,
# which is the minimum this fixture needs. The content is entirely fictional.
CJK_TEXT = "中文渲染检查。这是一份完全虚构的测试文档。字形识别正常。"
CJK_LINES = (CJK_TEXT, "中文 测试 字形 识别")

# Fandol ships with TeX Live/ctex; the platform fontsets cover local TeX setups.
CJK_DOCUMENT_CLASSES = (
    r"\documentclass[fontset=fandol]{ctexart}",
    r"\documentclass[fontset=windows]{ctexart}",
    r"\documentclass[fontset=mac]{ctexart}",
    r"\documentclass[fontset=ubuntu]{ctexart}",
)


def load_validator() -> types.ModuleType:
    spec = importlib.util.spec_from_file_location("validate_cjk_render_under_test", SCRIPT)
    if spec is None or spec.loader is None:  # pragma: no cover - broken checkout
        raise RuntimeError(f"cannot load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_validator(
    pdf: Path, *extra: str, env: dict[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--dpi", "150", *extra, str(pdf)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        check=False,
    )


def write_ascii_pdf(path: Path, text: str = "Synthetic page without Chinese text.") -> Path:
    """Write a minimal one-page PDF with a Helvetica text layer, no dependencies."""
    escaped = text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
    stream = f"BT /F1 18 Tf 20 100 Td ({escaped}) Tj ET".encode("latin-1")
    objects = (
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    )
    content = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(content))
        content += f"{number} 0 obj\n".encode("ascii") + body + b"\nendobj\n"
    xref_offset = len(content)
    content += f"xref\n0 {len(objects) + 1}\n".encode("ascii")
    content += b"0000000000 65535 f \n"
    for offset in offsets:
        content += f"{offset:010d} 00000 n \n".encode("ascii")
    content += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n"
    ).encode("ascii")
    path.write_bytes(bytes(content))
    return path


def compile_cjk_pdf(work_root: Path, lines: tuple[str, ...], white: bool = False) -> Path:
    """Compile a one-page Chinese PDF with XeLaTeX; skip the caller if impossible."""
    xelatex = shutil.which("xelatex")
    if not xelatex:
        raise unittest.SkipTest("xelatex is unavailable; cannot build the Chinese PDF fixture")
    body = "\n\n".join(
        rf"\textcolor{{white}}{{{line}}}" if white else line for line in lines
    )
    last_error = ""
    for document_class in CJK_DOCUMENT_CLASSES:
        work = Path(tempfile.mkdtemp(prefix="cjk-", dir=work_root))
        (work / "document.tex").write_text(
            document_class
            + "\n\\usepackage{xcolor}\n"
            "\\usepackage{geometry}\n"
            "\\geometry{paperwidth=20cm,paperheight=10cm,margin=2cm}\n"
            "\\pagestyle{empty}\n"
            "\\begin{document}\n"
            f"{body}\n"
            "\\end{document}\n",
            encoding="utf-8",
        )
        completed = subprocess.run(
            [xelatex, "-interaction=nonstopmode", "-halt-on-error", "document.tex"],
            cwd=work,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        pdf = work / "document.pdf"
        if completed.returncode == 0 and pdf.is_file() and pdf.stat().st_size > 1000:
            return pdf
        last_error = f"{document_class}: {completed.stdout[-800:]}{completed.stderr[-400:]}"
    raise unittest.SkipTest(f"no usable Chinese fontset for XeLaTeX;\n{last_error}")


@unittest.skipUnless(
    all(shutil.which(tool) for tool in PAGE_TOOLS),
    "poppler pdftotext/pdftoppm are required for the CJK render gate",
)
class CjkRenderValidatorPathTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._fixture_root = tempfile.TemporaryDirectory(prefix="cjk-gate-fixtures-")
        root = Path(cls._fixture_root.name)
        cls.cjk_pdf = compile_cjk_pdf(root, CJK_LINES)
        cls.blank_cjk_pdf = compile_cjk_pdf(root, CJK_LINES, white=True)

    @classmethod
    def tearDownClass(cls) -> None:
        cls._fixture_root.cleanup()

    def test_chinese_pdf_on_an_ascii_path_passes(self) -> None:
        with tempfile.TemporaryDirectory(prefix="cjk-gate-ascii-") as directory:
            pdf = Path(directory) / "paper.pdf"
            shutil.copyfile(self.cjk_pdf, pdf)
            completed = run_validator(pdf, "--min-cjk-words", "2")

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("PASS", completed.stdout)

    def test_chinese_pdf_and_output_directory_in_a_non_ascii_temp_dir_pass(self) -> None:
        directory = tempfile.mkdtemp(prefix="中文测试-")
        self.addCleanup(shutil.rmtree, directory, ignore_errors=True)
        non_ascii_root = Path(directory)
        self.assertFalse(str(non_ascii_root).isascii())

        # Chinese path for both the input PDF and the TemporaryDirectory that the
        # validator creates internally. The pre-fix code wrote bbox HTML here and
        # failed on Windows with "I/O Error: Couldn't open text file".
        pdf = non_ascii_root / "毕业论文-中文.pdf"
        shutil.copyfile(self.cjk_pdf, pdf)
        environment = dict(os.environ)
        for name in ("TMPDIR", "TEMP", "TMP"):
            environment[name] = str(non_ascii_root)

        completed = run_validator(pdf, "--min-cjk-words", "2", env=environment)

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("PASS", completed.stdout)

    def test_chinese_pdf_whose_glyphs_are_blank_fails(self) -> None:
        completed = run_validator(self.blank_cjk_pdf, "--min-cjk-words", "2")

        self.assertEqual(completed.returncode, 1, completed.stderr)
        self.assertIn("FAIL", completed.stderr)

    def test_pdf_without_chinese_text_does_not_pass(self) -> None:
        with tempfile.TemporaryDirectory(prefix="cjk-gate-ascii-only-") as directory:
            pdf = write_ascii_pdf(Path(directory) / "ascii-only.pdf")
            completed = run_validator(pdf)

        # Preserved gate semantics: no CJK text layer is INCONCLUSIVE (exit 2),
        # never a PASS that would let visual review continue.
        self.assertEqual(completed.returncode, 2, completed.stderr)
        self.assertIn("INCONCLUSIVE", completed.stderr)
        self.assertNotIn("PASS", completed.stdout)


class ValidatorCommandContractTests(unittest.TestCase):
    """Hermetic checks that do not need poppler or LaTeX installed."""

    def test_bbox_is_read_from_stdout_and_pages_are_rendered_with_pdftoppm(self) -> None:
        module = load_validator()
        commands: list[list[str]] = []

        def record(command: list[str], **_: object) -> types.SimpleNamespace:
            commands.append(list(command))
            return types.SimpleNamespace(
                returncode=0,
                stdout=b"<html><body><doc></doc></body></html>",
                stderr=b"",
            )

        with tempfile.TemporaryDirectory(prefix="cjk-gate-contract-") as directory:
            pdf = Path(directory) / "input.pdf"
            pdf.write_bytes(b"%PDF-1.4\n%%EOF\n")
            with (
                patch.object(sys, "argv", ["validate_cjk_render.py", "--dpi", "150", str(pdf)]),
                patch.object(module, "require_command", side_effect=lambda name: f"/usr/bin/{name}"),
                patch.object(module.subprocess, "run", side_effect=record),
                redirect_stdout(StringIO()),
                redirect_stderr(StringIO()),
            ):
                returncode = module.main()

        self.assertEqual(len(commands), 2)
        by_tool = {Path(command[0]).name: command for command in commands}
        bbox_command = by_tool["pdftotext"]
        render_command = by_tool["pdftoppm"]
        self.assertIn("-bbox-layout", bbox_command)
        self.assertEqual(bbox_command[-1], "-")
        self.assertFalse(any(argument.endswith(".html") for argument in bbox_command))
        self.assertEqual(Path(render_command[0]).name, "pdftoppm")
        self.assertIn("-r", render_command)
        self.assertIn("150", render_command)
        self.assertEqual(returncode, 2)  # empty bbox => INCONCLUSIVE, not a crash

    def test_a_build_without_bbox_layout_falls_back_instead_of_failing(self) -> None:
        """Xpdf 4.x pdftotext rejects -bbox-layout; the gate must still run."""
        module = load_validator()
        replies = {
            "-bbox-layout": b"Usage: pdftotext [options] <PDF-file> [<text-file>]\n",
        }
        calls: list[list[str]] = []

        def fake_run(command: list[str], **_: object) -> bytes:
            calls.append(list(command))
            if "-bbox-layout" in command:
                raise module.ToolFailure("pdftotext: unknown option -bbox-layout")
            return "第一页中文。\f第二页中文。\f".encode("utf-8")

        with tempfile.TemporaryDirectory(prefix="cjk-gate-fallback-") as directory:
            pdf = Path(directory) / "input.pdf"
            pdf.write_bytes(b"%PDF-1.4\n%%EOF\n")
            images = {}
            for page in (1, 2):
                page_pdf = Path(directory) / f"page-{page}.png"
                Image.new("RGB", (60, 80), "white").save(page_pdf)
                images[page] = page_pdf
            args = types.SimpleNamespace(min_ink_ratio=0.006, min_cjk_words=1)
            with patch.object(module, "run", side_effect=fake_run):
                pages = module.bbox_pages("/usr/bin/pdftotext", pdf)
                total, visible, _ = module.measure_pages(
                    "/usr/bin/pdftotext", pdf, images, args
                )

        self.assertIsNone(pages)
        self.assertEqual(total, 2)  # one contiguous CJK run per page
        self.assertEqual(visible, 0)  # blank white pages carry no ink
        self.assertTrue(any("-bbox-layout" in call for call in calls))


if __name__ == "__main__":
    unittest.main()
