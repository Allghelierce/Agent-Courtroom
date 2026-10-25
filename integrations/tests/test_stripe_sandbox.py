import io
import json
import unittest
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs

from integrations.stripe_sandbox import PaymentError, Receipt, StripeSandbox, checkout


def success(**overrides):
    return {"id": "pi_test123", "livemode": False, "amount": 3897, "amount_received": 3897,
            "currency": "usd", "status": "succeeded", **overrides}


class StripeSandboxTests(unittest.TestCase):
    def gateway(self, payload=None):
        requests = []

        def send(req, timeout):
            requests.append(req)
            self.assertEqual(timeout, 20)
            return io.BytesIO(json.dumps(success() if payload is None else payload).encode())

        return StripeSandbox("sk_test_localtest", transport=send), requests

    def test_success_receipt_and_request_are_for_confirmed_sandbox_usd_amount(self):
        gateway, requests = self.gateway()
        receipt = checkout(3897, "pm_card_visa", attempt_id="order-1", gateway=gateway)
        self.assertEqual(receipt, Receipt("pi_test123", 3897))
        request = requests[0]
        self.assertEqual(request.full_url, "https://api.stripe.com/v1/payment_intents")
        fields = parse_qs(request.data.decode())
        self.assertEqual(fields["amount"], ["3897"])
        self.assertEqual(fields["currency"], ["usd"])
        self.assertEqual(fields["confirm"], ["true"])
        self.assertEqual(fields["allowed_payment_method_types[]"], ["card"])
        self.assertNotIn("payment_method_types[]", fields)

    def test_retry_reuses_idempotency_key_and_retrieval_checks_provider(self):
        gateway, requests = self.gateway()
        first = gateway.charge(3897, "pm_card_visa", attempt_id="same-order")
        second = gateway.charge(3897, "pm_card_visa", attempt_id="same-order")
        self.assertEqual(first, second)
        self.assertEqual(requests[0].get_header("Idempotency-key"), "courtroom-same-order")
        self.assertEqual(requests[0].get_header("Idempotency-key"), requests[1].get_header("Idempotency-key"))
        self.assertEqual(gateway.verify(first), first)
        self.assertEqual(requests[-1].get_method(), "GET")
        self.assertTrue(requests[-1].full_url.endswith("/pi_test123"))

    def test_live_publishable_and_non_stripe_keys_are_rejected_before_network(self):
        for key in ("sk_live_fake", "rk_live_fake", "pk_test_fake", "gsk_fake", "", "sk_test_abc\n"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                StripeSandbox(key)

    def test_non_success_or_mismatched_response_never_becomes_receipt(self):
        for override in ({"status": "requires_action"}, {"status": "processing"}, {"status": "requires_payment_method"},
                         {"livemode": True}, {"livemode": None}, {"amount": 123}, {"currency": "eur"},
                         {"amount_received": 0}, {"id": "txn_invented"}):
            with self.subTest(override=override):
                gateway, _ = self.gateway(success(**override))
                with self.assertRaises(PaymentError):
                    checkout(3897, "pm_card_visa", attempt_id="order", gateway=gateway)

    def test_decline_is_not_reported_as_success(self):
        def decline(req, timeout):
            body = {"error": {"code": "card_declined", "payment_intent": {"id": "pi_declined"}}}
            raise HTTPError(req.full_url, 402, "declined", {}, io.BytesIO(json.dumps(body).encode()))

        gateway = StripeSandbox("sk_test_localtest", transport=decline)
        with self.assertRaises(PaymentError) as caught:
            checkout(3897, "pm_card_visa_chargeDeclined", attempt_id="order", gateway=gateway)
        self.assertEqual(caught.exception.code, "card_declined")
        self.assertEqual(caught.exception.payment_intent_id, "pi_declined")

    def test_connection_and_timeout_leave_payment_outcome_unknown(self):
        for error in (URLError("offline"), TimeoutError("timed out")):
            def fail(req, timeout):
                raise error

            with self.subTest(error=type(error).__name__):
                gateway = StripeSandbox("sk_test_localtest", transport=fail)
                with self.assertRaises(PaymentError) as caught:
                    checkout(3897, "pm_card_visa", attempt_id="order", gateway=gateway)
                self.assertEqual(caught.exception.code, "connection")
                self.assertTrue(caught.exception.outcome_unknown)

    def test_authentication_and_server_failures_are_not_mistaken_for_declines(self):
        for status in (401, 403, 429, 500):
            def fail(req, timeout):
                raise HTTPError(req.full_url, status, "failure", {}, io.BytesIO(b'{"error":{"message":"secret-value"}}'))

            with self.subTest(status=status):
                gateway = StripeSandbox("sk_test_localtest", transport=fail)
                with self.assertRaises(PaymentError) as caught:
                    gateway.charge(3897, "pm_card_visa", attempt_id="order")
                self.assertNotEqual(caught.exception.code, "card_declined")
                self.assertNotIn("secret-value", str(caught.exception))
                self.assertEqual(caught.exception.outcome_unknown, status >= 500)

    def test_invalid_input_is_rejected_without_a_request(self):
        gateway, requests = self.gateway()
        for amount, method, attempt in ((True, "pm_card_visa", "order"), (0, "pm_card_visa", "order"),
                                         (10001, "pm_card_visa", "order"), (3897, "tok_visa", "order"),
                                         (3897, "pm_card_visa", "")):
            with self.subTest(amount=amount, method=method, attempt=attempt), self.assertRaises(ValueError):
                gateway.charge(amount, method, attempt_id=attempt)
        self.assertEqual(requests, [])

    def test_unreadable_response_does_not_produce_receipt(self):
        gateway = StripeSandbox("sk_test_localtest", transport=lambda *args, **kwargs: io.BytesIO(b"not json"))
        with self.assertRaises(PaymentError) as caught:
            gateway.charge(3897, "pm_card_visa", attempt_id="order")
        self.assertTrue(caught.exception.outcome_unknown)

    def test_retrieve_cannot_silently_return_another_payment(self):
        gateway, _ = self.gateway()
        with self.assertRaises(PaymentError):
            gateway.verify(Receipt("pi_another", 3897))


if __name__ == "__main__":
    unittest.main()
