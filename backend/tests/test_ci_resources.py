import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('ci_resources', Path(__file__).resolve().parents[2] / 'scripts/ci_resources.py')
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)


class PrivateCIArchiveTests(unittest.TestCase):
    def test_verified_binary_extracts_without_decoding(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            archive = root / 'input.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('fonts/a.ttf', b'\xff\xfe\x00font')
            ci.extract_zip(archive, root / 'out')
            self.assertEqual((root / 'out/fonts/a.ttf').read_bytes(), b'\xff\xfe\x00font')

    def test_archive_paths_and_symlinks_cannot_escape(self):
        for name in ('../outside', '/outside', 'C:/outside', 'a\\outside'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as d:
                archive = Path(d) / 'input.zip'
                with zipfile.ZipFile(archive, 'w') as z:
                    entry = zipfile.ZipInfo('placeholder')
                    entry.filename = name  # Preserve the raw header on Windows as well.
                    z.writestr(entry, 'private')
                with self.assertRaises(RuntimeError):
                    ci.extract_zip(archive, Path(d) / 'out')
                self.assertFalse((Path(d) / 'out').exists())
        with tempfile.TemporaryDirectory() as d:
            archive = Path(d) / 'input.zip'
            entry = zipfile.ZipInfo('link')
            entry.create_system = 3
            entry.external_attr = 0o120777 << 16
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr(entry, '../outside')
            with self.assertRaises(RuntimeError):
                ci.extract_zip(archive, Path(d) / 'out')
