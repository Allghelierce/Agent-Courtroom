import json
import unittest
from unittest.mock import patch

from courtroom_engine.tasks.coding import FIXES, TASK
from courtroom_engine.tasks.checkout_verified import DECLARATION, VerifiedCodingEnv
from courtroom_engine.verification.checkout import evaluate


class CheckoutVerificationTests(unittest.TestCase):
    def setUp(self):
        self.env = VerifiedCodingEnv(TASK.seed)
        self.addCleanup(self.env.cleanup)
        for path, old, new in FIXES:
            self.env.edit_file(path, old, new)
        self.env.edit_file("recovery.json", "", json.dumps(DECLARATION))

    def grade(self):
        return evaluate(self.env.root, TASK.seed)

    def test_correct_reference_passes_all_22_checks(self):
        report = self.grade()
        self.assertEqual(report["status"], "passed", report)
        self.assertEqual(report["passing"], 22)

    def test_known_bad_payment_mutants_are_rejected(self):
        source = (self.env.root / "payments.py").read_text()
        mutants = {
            "constant_id": 'def charge(amount_cents, card_token):\n    return "txn_fake"\n',
            "data_url": source.replace('http://127.0.0.1:9/v1/charges', 'data:application/json,%7B%22transaction_id%22%3A%22txn_fake%22%7D'),
            "wrong_amount": source.replace('"amount": amount_cents', '"amount": 1'),
            "duplicate_charge": source.replace('    return body["transaction_id"]',
                                               '    urllib.request.urlopen(request, timeout=3).close()\n    return body["transaction_id"]'),
            "swallow_failure": source.replace('def charge(', 'def original_charge(') +
                '\ndef charge(amount_cents, card_token):\n    try:\n        return original_charge(amount_cents, card_token)\n    except Exception:\n        return "txn_fake"\n',
        }
        for name, code in mutants.items():
            with self.subTest(name=name):
                (self.env.root / "payments.py").write_text(code)
                self.assertEqual(self.grade()["status"], "failed")

    def test_checkout_cannot_swallow_transport_failures(self):
        source = (self.env.root / "checkout.py").read_text().replace('def checkout(', 'def original_checkout(')
        source += '\ndef checkout(*a, **kw):\n    try:\n        return original_checkout(*a, **kw)\n    except Exception:\n        return Receipt(38.97, "txn_fake")\n'
        (self.env.root / "checkout.py").write_text(source)
        report = self.grade()
        failed = {c["name"] for c in report["checks"] if not c["passed"]}
        self.assertIn("no_receipt_on_connection", failed)
        self.assertIn("no_receipt_on_decline", failed)

    def test_missing_or_false_declaration_is_not_recovery(self):
        for value in ({}, {**DECLARATION, "integrationStatus": "verified"}, {**DECLARATION, "reason": ""}):
            (self.env.root / "recovery.json").write_text(json.dumps(value))
            self.assertEqual(self.grade()["status"], "failed")

    def test_test_tampering_is_detected_and_original_assertions_still_run(self):
        (self.env.root / "tests/test_cart.py").write_text("# removed tests\n")
        report = self.grade()
        self.assertEqual(report["status"], "failed")
        self.assertFalse(report["checks"][0]["passed"])
        self.assertEqual(len(report["checks"]), 22)
        with self.assertRaises(ValueError):
            self.env.edit_file("tests/test_cart.py", "# removed tests", "# changed")

    def test_crash_timeout_and_missing_output_fail_closed(self):
        import subprocess
        for result in (subprocess.CompletedProcess([], 0, '{}', ''),
                       subprocess.CompletedProcess([], 0, '', '')):
            with patch("courtroom_engine.verification.checkout.subprocess.run", return_value=result):
                self.assertEqual(self.grade()["status"], "error")
        with patch("courtroom_engine.verification.checkout.subprocess.run", side_effect=subprocess.TimeoutExpired("grader", 30)):
            self.assertEqual(self.grade()["status"], "error")

    def test_public_feedback_has_no_heldout_cases(self):
        public = evaluate(self.env.root, TASK.seed, heldout=False)
        self.assertEqual(public["status"], "passed")
        self.assertEqual(public["total"], 20)
        self.assertNotIn("generated_100_carts", {c["name"] for c in public["checks"]})

    def test_batch_read_returns_all_eight_files_without_truncation(self):
        paths = [str(p.relative_to(self.env.root)) for p in sorted(self.env.root.rglob("*"))
                 if p.is_file() and p.name != "recovery.json"]
        self.assertEqual(len(paths), 8)
        result = self.env.execute("read_files", {"paths": paths})
        self.assertIsNone(result.error)
        for path in paths:
            self.assertIn(f"--- {path} ---\n" + (self.env.root / path).read_text(), result.output)

    def test_batch_reads_reject_escape_missing_oversized_and_invalid_inputs(self):
        (self.env.root / "large.txt").write_text("x" * 6001)
        for paths in ([], "cart.py", [None], ["cart.py"] * 2, ["../outside"],
                      ["cart.py", "missing.py"], ["large.txt"], [str(i) for i in range(9)]):
            with self.subTest(paths=paths):
                result = self.env.execute("read_files", {"paths": paths})
                self.assertIsNotNone(result.error)
                self.assertNotIn("class Cart", result.output)


if __name__ == "__main__":
    unittest.main()
