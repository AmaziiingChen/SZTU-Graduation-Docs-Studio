"""Deterministically scrub release-only metadata from staged DOCX files."""

from __future__ import annotations

import os
import re
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Callable
from xml.etree import ElementTree


PUBLIC_RELEASE_REDISTRIBUTION = "public-release-authorized"
LEGACY_LOCAL_PREVIEW_REDISTRIBUTION = "local-preview-only"
RELEASE_DOCX_METADATA_POLICY = "public-release-scrubbed-v1"

CORE_PROPERTIES_PATH = "docProps/core.xml"
EXTENDED_PROPERTIES_PATH = "docProps/app.xml"
CUSTOM_PROPERTIES_PATH = "docProps/custom.xml"
PACKAGE_RELATIONSHIPS_PATH = "_rels/.rels"
CONTENT_TYPES_PATH = "[Content_Types].xml"

CORE_PROPERTIES_NS = (
    "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
)
DC_NS = "http://purl.org/dc/elements/1.1/"
DCTERMS_NS = "http://purl.org/dc/terms/"
XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"
EXTENDED_PROPERTIES_NS = (
    "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
)
VT_NS = "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"
RELATIONSHIPS_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
WORDPROCESSINGML_NS = (
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
)
CUSTOM_PROPERTIES_RELATIONSHIP = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
    "custom-properties"
)

CORE_PERSONAL_METADATA = frozenset(
    {
        f"{{{DC_NS}}}creator",
        f"{{{CORE_PROPERTIES_NS}}}lastModifiedBy",
        f"{{{CORE_PROPERTIES_NS}}}lastPrinted",
        f"{{{DCTERMS_NS}}}created",
        f"{{{DCTERMS_NS}}}modified",
    }
)
EXTENDED_PERSONAL_METADATA_NAMES = frozenset(
    {
        "Application",
        "AppVersion",
        "Company",
        "HyperlinkBase",
        "Manager",
        "Template",
        "TotalTime",
    }
)
FIXED_ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
WORD_REVISION_PART = re.compile(
    r"^word/(?:document|header\d+|footer\d+|footnotes|endnotes|settings)\.xml$"
)

ElementTree.register_namespace("cp", CORE_PROPERTIES_NS)
ElementTree.register_namespace("dc", DC_NS)
ElementTree.register_namespace("dcterms", DCTERMS_NS)
ElementTree.register_namespace("xsi", XSI_NS)
ElementTree.register_namespace("vt", VT_NS)


class DocxPrivacyError(ValueError):
    """Raised when a DOCX cannot be safely scrubbed or verified."""


def _safe_members(archive: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    members: dict[str, zipfile.ZipInfo] = {}
    for member in archive.infolist():
        name = member.filename
        parts = PurePosixPath(name).parts
        if (
            not name
            or name.startswith("/")
            or "\\" in name
            or ".." in parts
            or member.flag_bits & 0x1
        ):
            raise DocxPrivacyError(f"DOCX contains an unsafe package member: {name}")
        if name in members:
            raise DocxPrivacyError(f"DOCX contains a duplicate package member: {name}")
        members[name] = member
    if CONTENT_TYPES_PATH not in members:
        raise DocxPrivacyError("DOCX is missing [Content_Types].xml")
    return members


def _parse_xml(payload: bytes, path: str) -> ElementTree.Element:
    try:
        return ElementTree.fromstring(payload)
    except ElementTree.ParseError as exc:
        raise DocxPrivacyError(f"DOCX metadata XML is invalid: {path}") from exc


def _serialize_xml(
    root: ElementTree.Element, *, default_namespace: str | None = None
) -> bytes:
    if default_namespace is not None:
        ElementTree.register_namespace("", default_namespace)
    return ElementTree.tostring(
        root,
        encoding="utf-8",
        xml_declaration=True,
        short_empty_elements=True,
    )


def _remove_matching_children(
    root: ElementTree.Element,
    predicate: Callable[[ElementTree.Element], bool],
) -> int:
    removed = 0
    for parent in root.iter():
        for child in list(parent):
            if predicate(child):
                parent.remove(child)
                removed += 1
    return removed


def _scrub_core_properties(payload: bytes) -> tuple[bytes, int]:
    root = _parse_xml(payload, CORE_PROPERTIES_PATH)
    removed = _remove_matching_children(
        root,
        lambda child: child.tag in CORE_PERSONAL_METADATA,
    )
    return _serialize_xml(root), removed


def _scrub_extended_properties(payload: bytes) -> tuple[bytes, int]:
    root = _parse_xml(payload, EXTENDED_PROPERTIES_PATH)
    removed = _remove_matching_children(
        root,
        lambda child: (
            child.tag.startswith(f"{{{EXTENDED_PROPERTIES_NS}}}")
            and child.tag.rsplit("}", 1)[-1] in EXTENDED_PERSONAL_METADATA_NAMES
        ),
    )
    return _serialize_xml(root, default_namespace=EXTENDED_PROPERTIES_NS), removed


def _remove_custom_property_relationship(payload: bytes) -> tuple[bytes, int]:
    root = _parse_xml(payload, PACKAGE_RELATIONSHIPS_PATH)
    removed = _remove_matching_children(
        root,
        lambda child: (
            child.tag == f"{{{RELATIONSHIPS_NS}}}Relationship"
            and (
                child.attrib.get("Type") == CUSTOM_PROPERTIES_RELATIONSHIP
                or child.attrib.get("Target", "").lstrip("/")
                == CUSTOM_PROPERTIES_PATH
            )
        ),
    )
    return _serialize_xml(root, default_namespace=RELATIONSHIPS_NS), removed


def _remove_custom_property_content_type(payload: bytes) -> tuple[bytes, int]:
    root = _parse_xml(payload, CONTENT_TYPES_PATH)
    removed = _remove_matching_children(
        root,
        lambda child: (
            child.tag == f"{{{CONTENT_TYPES_NS}}}Override"
            and child.attrib.get("PartName", "").lstrip("/")
            == CUSTOM_PROPERTIES_PATH
        ),
    )
    return _serialize_xml(root, default_namespace=CONTENT_TYPES_NS), removed


def _word_namespace_prefixes(payload: bytes) -> tuple[bytes, ...]:
    namespace = re.escape(WORDPROCESSINGML_NS.encode("ascii"))
    pattern = re.compile(
        rb"xmlns:([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(['\"])" + namespace + rb"\2"
    )
    return tuple(sorted({match.group(1) for match in pattern.finditer(payload)}))


def _scrub_word_revision_metadata(payload: bytes) -> tuple[bytes, int, int]:
    """Remove Word revision-session IDs without reserializing document markup."""

    result = payload
    attributes_removed = 0
    elements_removed = 0
    for prefix in _word_namespace_prefixes(payload):
        qualified = re.escape(prefix)
        attribute_pattern = re.compile(
            rb"\s+"
            + qualified
            + rb":rsid[A-Za-z0-9_.-]*\s*=\s*(?:\"[^\"]*\"|'[^']*')"
        )
        result, count = attribute_pattern.subn(b"", result)
        attributes_removed += count
        container_pattern = re.compile(
            rb"<"
            + qualified
            + rb":rsids\b[^>]*(?:/>|>.*?</"
            + qualified
            + rb":rsids\s*>)",
            flags=re.DOTALL,
        )
        result, count = container_pattern.subn(b"", result)
        elements_removed += count
        element_pattern = re.compile(
            rb"<"
            + qualified
            + rb":(?:rsid|rsidRoot)\b[^>]*(?:/>|>.*?</"
            + qualified
            + rb":(?:rsid|rsidRoot)\s*>)",
            flags=re.DOTALL,
        )
        result, count = element_pattern.subn(b"", result)
        elements_removed += count
    _parse_xml(result, "Word revision metadata part")
    return result, attributes_removed, elements_removed


def _revision_metadata_findings(
    archive: zipfile.ZipFile,
    members: dict[str, zipfile.ZipInfo],
) -> list[str]:
    findings: list[str] = []
    for name in sorted(member for member in members if WORD_REVISION_PART.fullmatch(member)):
        root = _parse_xml(archive.read(name), name)
        for element in root.iter():
            if element.tag in {
                f"{{{WORDPROCESSINGML_NS}}}rsids",
                f"{{{WORDPROCESSINGML_NS}}}rsid",
                f"{{{WORDPROCESSINGML_NS}}}rsidRoot",
            }:
                findings.append(f"{name}:rsid-element")
            if any(
                attribute.startswith(f"{{{WORDPROCESSINGML_NS}}}rsid")
                for attribute in element.attrib
            ):
                findings.append(f"{name}:rsid-attribute")
    return findings


def _deterministic_zip_info(name: str, *, is_directory: bool) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, FIXED_ZIP_TIMESTAMP)
    info.create_system = 3
    info.compress_type = zipfile.ZIP_STORED if is_directory else zipfile.ZIP_DEFLATED
    mode = (stat.S_IFDIR | 0o755) if is_directory else (stat.S_IFREG | 0o600)
    info.external_attr = (mode & 0xFFFF) << 16
    if is_directory:
        info.external_attr |= 0x10
    return info


def inspect_release_docx_metadata(path: Path) -> tuple[str, ...]:
    """Return release-blocking metadata findings without changing the DOCX."""

    findings: list[str] = []
    try:
        with zipfile.ZipFile(path, "r") as archive:
            members = _safe_members(archive)
            if CUSTOM_PROPERTIES_PATH in members:
                findings.append(CUSTOM_PROPERTIES_PATH)
            if CORE_PROPERTIES_PATH in members:
                root = _parse_xml(archive.read(CORE_PROPERTIES_PATH), CORE_PROPERTIES_PATH)
                for element in root.iter():
                    if element.tag in CORE_PERSONAL_METADATA:
                        findings.append(
                            f"{CORE_PROPERTIES_PATH}:{element.tag.rsplit('}', 1)[-1]}"
                        )
            if EXTENDED_PROPERTIES_PATH in members:
                root = _parse_xml(
                    archive.read(EXTENDED_PROPERTIES_PATH), EXTENDED_PROPERTIES_PATH
                )
                for element in root.iter():
                    local_name = element.tag.rsplit("}", 1)[-1]
                    if local_name in EXTENDED_PERSONAL_METADATA_NAMES:
                        findings.append(f"{EXTENDED_PROPERTIES_PATH}:{local_name}")
            if PACKAGE_RELATIONSHIPS_PATH in members:
                root = _parse_xml(
                    archive.read(PACKAGE_RELATIONSHIPS_PATH),
                    PACKAGE_RELATIONSHIPS_PATH,
                )
                for relationship in root:
                    if (
                        relationship.attrib.get("Type")
                        == CUSTOM_PROPERTIES_RELATIONSHIP
                        or relationship.attrib.get("Target", "").lstrip("/")
                        == CUSTOM_PROPERTIES_PATH
                    ):
                        findings.append(
                            f"{PACKAGE_RELATIONSHIPS_PATH}:custom-properties"
                        )
            root = _parse_xml(archive.read(CONTENT_TYPES_PATH), CONTENT_TYPES_PATH)
            for override in root:
                if (
                    override.attrib.get("PartName", "").lstrip("/")
                    == CUSTOM_PROPERTIES_PATH
                ):
                    findings.append(f"{CONTENT_TYPES_PATH}:custom-properties")
            findings.extend(_revision_metadata_findings(archive, members))
    except (OSError, zipfile.BadZipFile) as exc:
        raise DocxPrivacyError(f"Cannot inspect DOCX metadata: {path}") from exc
    return tuple(sorted(set(findings)))


def scrub_release_docx_metadata(source: Path, target: Path) -> dict[str, int]:
    """Create a deterministic, metadata-scrubbed copy without editing ``source``."""

    source = source.resolve()
    target = target.resolve()
    if source == target:
        raise DocxPrivacyError("Release metadata scrub requires a separate staged copy")
    target.parent.mkdir(parents=True, exist_ok=True)
    stats = {
        "core_properties_removed": 0,
        "extended_properties_removed": 0,
        "custom_properties_removed": 0,
        "custom_relationships_removed": 0,
        "custom_content_types_removed": 0,
        "revision_attributes_removed": 0,
        "revision_elements_removed": 0,
    }
    temporary_path: Path | None = None
    try:
        with zipfile.ZipFile(source, "r") as archive:
            members = _safe_members(archive)
            payloads = {
                name: archive.read(name)
                for name in members
                if not name.endswith("/")
            }

        if CORE_PROPERTIES_PATH in payloads:
            payloads[CORE_PROPERTIES_PATH], stats["core_properties_removed"] = (
                _scrub_core_properties(payloads[CORE_PROPERTIES_PATH])
            )
        if EXTENDED_PROPERTIES_PATH in payloads:
            payloads[EXTENDED_PROPERTIES_PATH], stats["extended_properties_removed"] = (
                _scrub_extended_properties(payloads[EXTENDED_PROPERTIES_PATH])
            )
        if CUSTOM_PROPERTIES_PATH in payloads:
            del payloads[CUSTOM_PROPERTIES_PATH]
            stats["custom_properties_removed"] = 1
        if PACKAGE_RELATIONSHIPS_PATH in payloads:
            (
                payloads[PACKAGE_RELATIONSHIPS_PATH],
                stats["custom_relationships_removed"],
            ) = _remove_custom_property_relationship(
                payloads[PACKAGE_RELATIONSHIPS_PATH]
            )
        (
            payloads[CONTENT_TYPES_PATH],
            stats["custom_content_types_removed"],
        ) = _remove_custom_property_content_type(payloads[CONTENT_TYPES_PATH])
        for name in sorted(
            member for member in payloads if WORD_REVISION_PART.fullmatch(member)
        ):
            (
                payloads[name],
                attributes_removed,
                elements_removed,
            ) = _scrub_word_revision_metadata(payloads[name])
            stats["revision_attributes_removed"] += attributes_removed
            stats["revision_elements_removed"] += elements_removed

        with tempfile.NamedTemporaryFile(
            dir=target.parent,
            prefix=f".{target.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
        with zipfile.ZipFile(
            temporary_path,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=9,
        ) as output:
            directory_names = sorted(
                name for name in members if name.endswith("/")
            )
            for name in directory_names:
                output.writestr(
                    _deterministic_zip_info(name, is_directory=True),
                    b"",
                )
            for name in sorted(payloads):
                output.writestr(
                    _deterministic_zip_info(name, is_directory=False),
                    payloads[name],
                    compresslevel=9,
                )
        findings = inspect_release_docx_metadata(temporary_path)
        if findings:
            raise DocxPrivacyError(
                "Staged DOCX still contains release-blocking metadata: "
                + ", ".join(findings)
            )
        os.replace(temporary_path, target)
        temporary_path = None
        target.chmod(0o600)
        return stats
    except (OSError, zipfile.BadZipFile) as exc:
        raise DocxPrivacyError(f"Cannot scrub DOCX metadata: {source}") from exc
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
