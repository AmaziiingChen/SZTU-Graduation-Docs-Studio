from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from sztu_docs_backend import template_engine
from sztu_docs_backend.docx_privacy import (
    CUSTOM_PROPERTIES_PATH,
    PUBLIC_RELEASE_REDISTRIBUTION,
    RELEASE_DOCX_METADATA_POLICY,
    DocxPrivacyError,
    inspect_release_docx_metadata,
    scrub_release_docx_metadata,
)
from sztu_docs_backend.template_engine import TemplateEngineError


CONTENT_TYPES = b"""<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>
</Types>
"""
PACKAGE_RELATIONSHIPS = b"""<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>
</Relationships>
"""
CORE_PROPERTIES = b"""<?xml version="1.0" encoding="UTF-8"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Public template title</dc:title>
  <dc:creator>Private Author</dc:creator>
  <cp:lastModifiedBy>Private Editor</cp:lastModifiedBy>
  <cp:lastPrinted>2025-01-02T03:04:05Z</cp:lastPrinted>
  <dcterms:created xsi:type="dcterms:W3CDTF">2024-01-02T03:04:05Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-02T03:04:05Z</dcterms:modified>
  <cp:revision>7</cp:revision>
</cp:coreProperties>
"""
EXTENDED_PROPERTIES = b"""<?xml version="1.0" encoding="UTF-8"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Template>Private.dotm</Template>
  <TotalTime>42</TotalTime>
  <Application>WPS Office_PRIVATE-ID</Application>
  <AppVersion>16.0</AppVersion>
  <Company>Private Company</Company>
  <Manager>Private Manager</Manager>
  <Pages>3</Pages>
</Properties>
"""
CUSTOM_PROPERTIES = b"""<?xml version="1.0" encoding="UTF-8"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties">
  <property name="PrivateInstallId"><value>secret</value></property>
</Properties>
"""
DOCUMENT_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p w:rsidR="00112233"><w:r><w:t>Layout payload must remain byte-identical.</w:t></w:r></w:p></w:body>
</w:document>
"""
DOCUMENT_XML_WITHOUT_REVISION_ID = DOCUMENT_XML.replace(
    b' w:rsidR="00112233"', b""
)
SETTINGS_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:rsids><w:rsidRoot w:val="00112233"/><w:rsid w:val="44556677"/></w:rsids>
  <w:compat/>
</w:settings>
"""


def write_private_docx(path: Path) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", DOCUMENT_XML)
        archive.writestr("word/settings.xml", SETTINGS_XML)
        archive.writestr("docProps/custom.xml", CUSTOM_PROPERTIES)
        archive.writestr("docProps/app.xml", EXTENDED_PROPERTIES)
        archive.writestr("docProps/core.xml", CORE_PROPERTIES)
        archive.writestr("_rels/.rels", PACKAGE_RELATIONSHIPS)
        archive.writestr("[Content_Types].xml", CONTENT_TYPES)


class ReleaseDocxPrivacyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_scrub_is_deterministic_and_preserves_layout_payload(self) -> None:
        source = self.root / "private.docx"
        first = self.root / "first.docx"
        second = self.root / "second.docx"
        write_private_docx(source)
        source_digest = hashlib.sha256(source.read_bytes()).hexdigest()

        stats = scrub_release_docx_metadata(source, first)
        scrub_release_docx_metadata(source, second)

        self.assertEqual(
            hashlib.sha256(source.read_bytes()).hexdigest(), source_digest
        )
        self.assertEqual(first.read_bytes(), second.read_bytes())
        self.assertEqual(inspect_release_docx_metadata(first), ())
        self.assertGreaterEqual(stats["core_properties_removed"], 5)
        self.assertGreaterEqual(stats["extended_properties_removed"], 6)
        self.assertEqual(stats["revision_attributes_removed"], 1)
        self.assertEqual(stats["revision_elements_removed"], 1)
        with zipfile.ZipFile(first, "r") as archive:
            self.assertNotIn(CUSTOM_PROPERTIES_PATH, archive.namelist())
            self.assertEqual(
                archive.read("word/document.xml"),
                DOCUMENT_XML_WITHOUT_REVISION_ID,
            )
            settings = archive.read("word/settings.xml")
            self.assertIn(b"<w:compat/>", settings)
            self.assertNotIn(b"w:rsid", settings)
            self.assertTrue(
                all(
                    member.date_time == (1980, 1, 1, 0, 0, 0)
                    for member in archive.infolist()
                )
            )
            self.assertNotIn(b"custom-properties", archive.read("_rels/.rels"))
            self.assertNotIn(b"docProps/custom.xml", archive.read("[Content_Types].xml"))
            core = archive.read("docProps/core.xml")
            self.assertIn(b"Public template title", core)
            self.assertIn(b"revision", core)

    def test_scrub_refuses_to_overwrite_the_source(self) -> None:
        source = self.root / "private.docx"
        write_private_docx(source)
        with self.assertRaises(DocxPrivacyError):
            scrub_release_docx_metadata(source, source)

    def _write_public_bundle(self, *, scrub: bool) -> tuple[Path, str]:
        bundled_root = self.root / ("clean-bundle" if scrub else "private-bundle")
        bundled = bundled_root / "proposal"
        renderer = bundled / "word" / "render.py"
        renderer.parent.mkdir(parents=True)
        renderer.write_bytes(b"bundled proposal renderer")
        raw_template = self.root / ("clean-source.docx" if scrub else "private-source.docx")
        write_private_docx(raw_template)
        official_template = bundled / "word" / "official-template.docx"
        if scrub:
            scrub_release_docx_metadata(raw_template, official_template)
        else:
            official_template.write_bytes(raw_template.read_bytes())
        validator = bundled / "scripts" / "validate_cjk_render.py"
        validator.parent.mkdir(parents=True)
        validator.write_bytes(b"bundled validator")
        hashes = {
            "word/render.py": hashlib.sha256(renderer.read_bytes()).hexdigest(),
            "word/official-template.docx": hashlib.sha256(
                official_template.read_bytes()
            ).hexdigest(),
        }
        with patch.object(template_engine, "ENGINE_FILE_HASHES", hashes):
            source = template_engine._workspace_source(bundled, "proposal")
            pack_sha256 = template_engine._workspace_pack_sha256(source)
            template_id, version = template_engine._workspace_identity(
                "proposal", pack_sha256
            )
        (bundled_root / "bundle-manifest.json").write_text(
            json.dumps(
                {
                    "schema_version": "1.0",
                    "redistribution": PUBLIC_RELEASE_REDISTRIBUTION,
                    "docx_metadata_policy": RELEASE_DOCX_METADATA_POLICY,
                    "engines": {
                        "proposal": {
                            "template_id": template_id,
                            "version": version,
                            "pack_sha256": pack_sha256,
                            "metadata_scrubbed_files": [
                                "word/official-template.docx"
                            ],
                        }
                    },
                }
            ),
            encoding="utf-8",
        )
        return bundled_root, hashes["word/official-template.docx"]

    def test_runtime_accepts_public_bundle_only_after_metadata_scrub(self) -> None:
        bundled_root, official_hash = self._write_public_bundle(scrub=True)
        hashes = {
            "word/render.py": hashlib.sha256(
                (bundled_root / "proposal" / "word" / "render.py").read_bytes()
            ).hexdigest(),
            "word/official-template.docx": official_hash,
        }
        with patch.object(template_engine, "ENGINE_FILE_HASHES", hashes):
            resolved = template_engine._resolve_bundled_engine(
                bundled_root, "proposal"
            )
        self.assertEqual(resolved.source, "bundled")
        self.assertEqual(resolved.root, (bundled_root / "proposal").resolve())

    def test_runtime_rejects_public_bundle_with_private_metadata(self) -> None:
        bundled_root, official_hash = self._write_public_bundle(scrub=False)
        hashes = {
            "word/render.py": hashlib.sha256(
                (bundled_root / "proposal" / "word" / "render.py").read_bytes()
            ).hexdigest(),
            "word/official-template.docx": official_hash,
        }
        with patch.object(
            template_engine, "ENGINE_FILE_HASHES", hashes
        ), self.assertRaises(TemplateEngineError) as caught:
            template_engine._resolve_bundled_engine(bundled_root, "proposal")
        self.assertEqual(caught.exception.code, "TEMPLATE_BUNDLE_METADATA_INVALID")


if __name__ == "__main__":
    unittest.main()
