import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from advised_benchmark import AssistantAdvice


class AdviceTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        source = self.root / "source"
        source.mkdir()
        (source / "cart.py").write_text("# snapshot\n")
        self.adapter = AssistantAdvice(self.root, [SimpleNamespace(root=source)],
                                       SimpleNamespace(messages=[{"role": "user", "content": "fix"}]))
        self.packet = {"events": [{"id": 8}], "charge": {"kind": "stalling"}}

    def test_advice_snapshots_state_and_rejects_unknown_citations(self):
        invalid = {"ruling": "change_strategy", "instruction": "Run tests", "cited_events": [99]}
        valid = {**invalid, "cited_events": [8]}
        stream = io.StringIO(json.dumps(invalid) + "\n" + json.dumps(valid) + "\n")
        output = io.StringIO()
        with patch("sys.stdin", stream), contextlib.redirect_stdout(output):
            result = self.adapter.convene(self.packet)
        self.assertEqual(result.instruction, "Run tests")
        self.assertIn("INVALID_ADVICE", output.getvalue())
        self.assertEqual((self.root / "advice/1/source/cart.py").read_text(), "# snapshot\n")
        self.assertEqual(json.loads((self.root / "advice/1/response.json").read_text())["verdict"], result.to_json())

    def test_closed_input_halts_instead_of_inventing_advice(self):
        with patch("sys.stdin", io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            result = self.adapter.convene(self.packet)
        self.assertEqual(result.ruling, "halt")
        self.assertIsNone(result.instruction)


if __name__ == "__main__":
    unittest.main()
