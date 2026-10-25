import json
import unittest

from integrations.stripe_sandbox import PaymentError, Receipt
from courtroom_engine.tasks.coding import FIXES, TASK
from courtroom_engine.tasks.checkout_verified import DECLARATION, VerifiedCodingEnv
from courtroom_engine.verification.stripe import evaluate_stripe


class FakeStripe:
    def __init__(self):
        self.calls = []
        self.verified = []

    def charge(self, amount, method, *, attempt_id):
        self.calls.append((amount, method, attempt_id))
        if method == "pm_card_visa_chargeDeclined":
            raise PaymentError("card_declined", "declined", payment_intent_id="pi_declined")
        return Receipt("pi_success", amount)

    def verify(self, receipt):
        self.verified.append(receipt)
        return receipt


class StripeVerificationTests(unittest.TestCase):
    def setUp(self):
        self.env = VerifiedCodingEnv(TASK.seed)
        self.addCleanup(self.env.cleanup)
        for path, old, new in FIXES:
            self.env.edit_file(path, old, new)
        self.env.edit_file("recovery.json", "", json.dumps(DECLARATION))

    def test_saved_checkout_reaches_bridge_and_receipt_is_read_back(self):
        gateway = FakeStripe()
        report = evaluate_stripe(self.env.root, run_id="fixture", gateway=gateway)
        self.assertEqual(report["status"], "passed", report)
        self.assertEqual(len(gateway.calls), 3)  # outage stays local
        self.assertEqual(gateway.calls[0][2], gateway.calls[1][2])
        self.assertNotEqual(gateway.calls[0][2], gateway.calls[2][2])
        self.assertEqual(len(gateway.verified), 2)
        self.assertEqual(report["checks"][-1]["source"], "locally_injected_failure")

    def test_actual_worker_fallback_fails_even_with_good_adapter(self):
        path = self.env.root / "checkout.py"
        code = path.read_text().replace("def checkout(", "def real_checkout(")
        code += '\ndef checkout(*a, **kw):\n    try:\n        return real_checkout(*a, **kw)\n    except Exception:\n        return Receipt(38.97, "txn_fake")\n'
        path.write_text(code)
        report = evaluate_stripe(self.env.root, run_id="fixture", gateway=FakeStripe())
        self.assertEqual(report["status"], "failed", report)
        self.assertEqual([c["name"] for c in report["checks"] if c["status"] == "failed"],
                         ["decline", "connection_failure"])

    def test_missing_key_does_not_pass(self):
        self.assertEqual(evaluate_stripe(self.env.root, run_id="fixture")["status"], "not_run")

    def test_provider_error_is_distinct_from_bad_code(self):
        class Unavailable(FakeStripe):
            def charge(self, *args, **kwargs):
                raise PaymentError("authentication", "bad test key")
        report = evaluate_stripe(self.env.root, run_id="fixture", gateway=Unavailable())
        self.assertEqual(report["status"], "error", report)


if __name__ == "__main__":
    unittest.main()
