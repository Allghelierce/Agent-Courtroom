"""Run: python3 -m unittest  (from this folder). Set COURT_URL to also hit a live court."""

from __future__ import annotations

import json
import os
import socket
import unittest
from dataclasses import asdict, dataclass
from pathlib import Path

from court_client import convene, to_jsonable

# A real POST /verdict body from the checkout seed repo (shared/schema.ts EvidencePacket).
FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "engine-packet-checkout.json"


def unused_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def engine_packet() -> dict:
    return json.loads(FIXTURE.read_text())


@dataclass
class FakeCharge:
    id: int
    kind: str

    def to_json(self) -> dict:
        return asdict(self)


class FallbackTests(unittest.TestCase):
    def test_dead_court_escalates_instead_of_raising(self):
        verdict = convene(engine_packet(), url=f"http://127.0.0.1:{unused_port()}", timeout=2)
        self.assertEqual(verdict["ruling"], "escalate")
        self.assertTrue(verdict["reasoning"].startswith("Court unreachable:"))
        self.assertEqual(verdict["cited_events"], [])
        self.assertIsNone(verdict["caseId"])

    def test_unserializable_packet_escalates(self):
        verdict = convene({"charge": object()}, url=f"http://127.0.0.1:{unused_port()}")
        self.assertEqual(verdict["ruling"], "escalate")


class ToJsonableTests(unittest.TestCase):
    def test_converts_nested_dataclasses(self):
        packet = {"charge": FakeCharge(1, "looping"), "events": [FakeCharge(2, "x")]}
        self.assertEqual(
            to_jsonable(packet),
            {"charge": {"id": 1, "kind": "looping"}, "events": [{"id": 2, "kind": "x"}]},
        )

    def test_top_level_object_with_to_json(self):
        self.assertEqual(to_jsonable(FakeCharge(3, "stalling")), {"id": 3, "kind": "stalling"})


@unittest.skipUnless(os.environ.get("COURT_URL"), "set COURT_URL to run against a live court")
class LiveCourtTests(unittest.TestCase):
    def test_returns_verdict_and_case_id(self):
        verdict = convene(engine_packet(), url=os.environ["COURT_URL"])
        self.assertIn(verdict["ruling"], ("continue", "change_strategy", "escalate", "halt"))
        self.assertNotIn("Court unreachable", verdict["reasoning"])
        self.assertTrue(verdict["caseId"])


if __name__ == "__main__":
    unittest.main()
