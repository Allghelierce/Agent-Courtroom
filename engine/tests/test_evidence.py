import json
import tempfile
import unittest
from pathlib import Path

from courtroom_engine.bus import Bus
from courtroom_engine.engine import Engine, RunConfig
from courtroom_engine.schema import Verdict


class EvidenceTests(unittest.TestCase):
    def test_pair_retains_different_sources_and_reruns_tests(self):
        with tempfile.TemporaryDirectory() as temp:
            bus = Bus()
            try:
                result = Engine(bus).compare(RunConfig(
                    task="coding", max_steps=25, evidence_dir=Path(temp),
                    success_criteria="Review diffs and tests; never weaken assertions"))
                self.assertEqual(result["successCriteria"], "Review diffs and tests; never weaken assertions")
                for arm, code in (("withCourt", 0), ("withoutCourt", 1)):
                    run = result[arm]
                    path = Path(run["evidencePath"])
                    self.assertIsNone(run["evidenceError"])
                    self.assertFalse(run["outcomeVerified"])
                    report = json.loads((path / "verification.json").read_text())
                    self.assertEqual(report["testExitCode"], code)
                    self.assertIn("Ran 11 tests", (path / "tests.txt").read_text())
                    self.assertTrue((path / "source/cart.py").is_file())
                    self.assertIn("pricing.py", report["changedFiles"])
                patch = (Path(result["withCourt"]["evidencePath"]) / "changes.diff").read_text()
                self.assertIn("txn_mocked", patch)
                self.assertIn("flagged for a human", patch)
                self.assertNotIn("txn_mocked", (Path(result["withoutCourt"]["evidencePath"]) / "changes.diff").read_text())
            finally:
                bus.close()

    def test_price_outputs_survive_and_escalation_does_not_wait(self):
        class EscalatingCourt:
            def convene(self, packet):
                return Verdict(ruling="escalate", reasoning="Human needs to inspect the source")

        with tempfile.TemporaryDirectory() as temp:
            bus = Bus()
            try:
                worker = Engine(bus).create_worker(RunConfig(
                    task="prices", evidence_dir=Path(temp), human_wait_seconds=0))
                worker.court = EscalatingCourt()
                status = worker.run()
                self.assertEqual(status.state, "halted")
                evidence = Path(worker.result()["evidencePath"])
                prices = json.loads((evidence / "prices.json").read_text())
                self.assertEqual(len(prices["saved"]), 5)
                self.assertEqual(prices["flagged"], {})
                self.assertLess(worker.elapsed_seconds(), 5)
            finally:
                bus.close()


if __name__ == "__main__":
    unittest.main()
