from __future__ import annotations
import json
import unittest
from unittest.mock import patch
from sztu_docs_backend.protocol import ProtocolSession
from sztu_docs_backend.protocol import _diagnostic_details

class DiagnosticDetailsTests(unittest.TestCase):
    def test_arbitrary_exception_values_do_not_enter_trace(self):
        try:
            raise ValueError('/Users/private/student-name thesis text')
        except ValueError as exc:
            value = _diagnostic_details(exc)['diagnostic']
        self.assertEqual(value, {'trace': [], 'stage': 'request'})
        self.assertNotIn('private', json.dumps(value))

    def test_failure_envelope_has_code_locations_without_exception_text(self):
        session = ProtocolSession()
        with patch.object(session, '_dispatch_workspace', side_effect=ValueError('/Users/private/body')):
            response = session.dispatch({'protocol': '1.0', 'id': '11111111-1111-4111-8111-111111111111', 'method': 'workspace.open', 'params': {}})
        diagnostic = response['error']['details']['diagnostic']
        self.assertTrue(diagnostic['trace'])
        self.assertEqual(diagnostic['trace'][0]['module'], 'protocol.py')
        self.assertNotIn('private', json.dumps(response))
