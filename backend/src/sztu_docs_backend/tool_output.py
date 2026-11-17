"""Decode external tool output that Windows may emit in a legacy code page.

Windows console tools write to a pipe in the active console code page, which is
936 (GBK) on a Simplified Chinese system. Decoding those bytes as UTF-8 replaces
every Chinese path with U+FFFD, so a diagnostic that says
`C:\\Users\\林振宇\\...` was captured as `C:\\Users\\������\\...`. Captured bytes
stay untouched; only the application-side text is decoded here.
"""


def decode_tool_output(value: bytes) -> str:
    """Return text for tool output, preferring UTF-8 and falling back to GBK."""
    if isinstance(value, str):
        return value
    try:
        return value.decode("utf-8")
    except UnicodeDecodeError:
        pass
    for encoding in ("gb18030",):
        try:
            return value.decode(encoding)
        except UnicodeDecodeError:
            continue
    return value.decode("utf-8", errors="replace")
