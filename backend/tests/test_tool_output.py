from __future__ import annotations

import unittest

from sztu_docs_backend.tool_output import decode_tool_output


class ToolOutputDecodeTests(unittest.TestCase):
    def test_utf8_output_is_decoded_as_utf8(self):
        self.assertEqual(decode_tool_output("路径 C:\\Users\\林振宇".encode("utf-8")), "路径 C:\\Users\\林振宇")

    def test_a_chinese_windows_code_page_is_not_replaced_with_fffd(self):
        raw = "C:\\Users\\林振宇\\AppData".encode("gb18030")

        self.assertEqual(decode_tool_output(raw), "C:\\Users\\林振宇\\AppData")
        self.assertNotIn("\ufffd", decode_tool_output(raw))

    def test_undecodable_bytes_still_produce_text(self):
        decoded = decode_tool_output(b"\xff\xfe\x00broken")

        self.assertIsInstance(decoded, str)
        self.assertIn("broken", decoded)
