from __future__ import annotations

import io
import json
import unittest
import uuid

from sztu_docs_backend.server import MAX_LINE_BYTES, serve


def request_line(
    method: str,
    *,
    request_id: str | None = None,
    params: dict[str, object] | None = None,
) -> str:
    payload: dict[str, object] = {
        "protocol": "1.0",
        "id": request_id or str(uuid.uuid4()),
        "method": method,
    }
    if params is not None:
        payload["params"] = params
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"


class ServerTests(unittest.TestCase):
    def run_server(self, data: str) -> list[dict[str, object]]:
        output = io.StringIO()
        serve(io.StringIO(data), output)
        return [json.loads(line) for line in output.getvalue().splitlines()]

    def test_one_response_per_line_and_clean_eof(self) -> None:
        first_id = str(uuid.uuid4())
        second_id = str(uuid.uuid4())
        responses = self.run_server(
            request_line("system.ping", request_id=first_id)
            + request_line("system.version", request_id=second_id)
        )
        self.assertEqual(len(responses), 2)
        self.assertEqual([item["id"] for item in responses], [first_id, second_id])
        self.assertTrue(all(item["ok"] for item in responses))

    def test_malformed_json_does_not_stop_later_requests(self) -> None:
        next_id = str(uuid.uuid4())
        responses = self.run_server("{not json}\n" + request_line(
            "system.ping", request_id=next_id
        ))
        self.assertEqual(responses[0]["error"]["code"], "INVALID_JSON")
        self.assertEqual(responses[1]["id"], next_id)
        self.assertTrue(responses[1]["ok"])

    def test_empty_line_is_a_protocol_error(self) -> None:
        responses = self.run_server("\n")
        self.assertEqual(len(responses), 1)
        self.assertEqual(responses[0]["error"]["code"], "INVALID_JSON")

    def test_non_object_json_is_invalid_request(self) -> None:
        responses = self.run_server("[]\n")
        self.assertEqual(responses[0]["error"]["code"], "INVALID_REQUEST")

    def test_unicode_params_round_trip_without_ascii_escaping(self) -> None:
        request_id = str(uuid.uuid4())
        output = io.StringIO()
        serve(
            io.StringIO(
                request_line(
                    "unknown.method",
                    request_id=request_id,
                    params={"synthetic": "开题报告"},
                )
            ),
            output,
        )
        self.assertIn(f'"id":"{request_id}"', output.getvalue())
        self.assertNotIn("\\u5f00", output.getvalue())

    def test_oversized_line_is_discarded_and_next_line_is_processed(self) -> None:
        next_id = str(uuid.uuid4())
        oversized = "x" * (MAX_LINE_BYTES + 1) + "\n"
        responses = self.run_server(
            oversized + request_line("system.ping", request_id=next_id)
        )
        self.assertEqual(len(responses), 2)
        self.assertIsNone(responses[0]["id"])
        self.assertEqual(responses[0]["error"]["code"], "MESSAGE_TOO_LARGE")
        self.assertEqual(responses[0]["error"]["details"]["maximum_bytes"], MAX_LINE_BYTES)
        self.assertTrue(responses[1]["ok"])
        self.assertEqual(responses[1]["id"], next_id)

    def test_line_at_exact_byte_limit_is_accepted(self) -> None:
        request_id = str(uuid.uuid4())
        prefix = (
            f'{{"protocol":"1.0","id":"{request_id}",'
            '"method":"unknown.method","params":{"padding":"'
        )
        suffix = '"}}\n'
        padding_length = MAX_LINE_BYTES - len((prefix + suffix).encode("utf-8"))
        line = prefix + ("x" * padding_length) + suffix
        self.assertEqual(len(line.encode("utf-8")), MAX_LINE_BYTES)
        response = self.run_server(line)[0]
        self.assertEqual(response["error"]["code"], "METHOD_NOT_FOUND")

    def test_multibyte_line_limit_is_measured_in_utf8_bytes(self) -> None:
        oversized = "汉" * (MAX_LINE_BYTES // 3 + 1) + "\n"
        response = self.run_server(oversized)[0]
        self.assertEqual(response["error"]["code"], "MESSAGE_TOO_LARGE")

    def test_duplicate_uuid_is_rejected_case_insensitively(self) -> None:
        request_id = "123e4567-e89b-42d3-a456-426614174000"
        responses = self.run_server(
            request_line("system.ping", request_id=request_id)
            + request_line("system.version", request_id=request_id.upper())
        )
        self.assertTrue(responses[0]["ok"])
        self.assertFalse(responses[1]["ok"])
        self.assertEqual(responses[1]["id"], request_id.upper())
        self.assertEqual(
            responses[1]["error"]["code"], "DUPLICATE_REQUEST_ID"
        )

    def test_invalid_id_is_not_added_to_duplicate_tracking(self) -> None:
        invalid = "not-a-uuid"
        responses = self.run_server(
            json.dumps({"protocol": "1.0", "id": invalid, "method": "system.ping"})
            + "\n"
            + json.dumps(
                {"protocol": "1.0", "id": invalid, "method": "system.ping"}
            )
            + "\n"
        )
        self.assertEqual(
            [item["error"]["code"] for item in responses],
            ["INVALID_REQUEST", "INVALID_REQUEST"],
        )


if __name__ == "__main__":
    unittest.main()
