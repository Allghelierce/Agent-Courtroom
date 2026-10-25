"""A synchronous, sandbox-only checkout using Stripe's PaymentIntent API."""

from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener


class PaymentError(Exception):
    """A payment did not produce a verified receipt; unknown outcomes need reconciliation."""

    def __init__(self, code: str, message: str, *, payment_intent_id: str | None = None,
                 outcome_unknown: bool = False):
        super().__init__(message)
        self.code = code
        self.payment_intent_id = payment_intent_id
        self.outcome_unknown = outcome_unknown


@dataclass(frozen=True)
class Receipt:
    transaction_id: str
    amount_cents: int
    currency: str = "usd"
    sandbox: bool = True


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward the Authorization header to a redirected host.
        return None


def _intent_id(value) -> str | None:
    return value if isinstance(value, str) and re.fullmatch(r"pi_[A-Za-z0-9]+", value) else None


class StripeSandbox:
    API = "https://api.stripe.com/v1/payment_intents"
    TEST_METHODS = {"pm_card_visa", "pm_card_visa_chargeDeclined"}

    def __init__(self, secret_key: str, *, transport=None):
        # This integration deliberately cannot charge real cards or accept live keys.
        if not isinstance(secret_key, str) or not re.fullmatch(r"(?:sk|rk)_test_[A-Za-z0-9]+", secret_key):
            raise ValueError("STRIPE_TEST_SECRET_KEY must be a Stripe sandbox secret or restricted test key")
        self._authorization = "Basic " + base64.b64encode((secret_key + ":").encode()).decode()
        self._open = transport or build_opener(NoRedirects()).open

    def _request(self, method: str, url: str, fields: dict | None = None,
                 idempotency_key: str | None = None) -> dict:
        headers = {"Authorization": self._authorization, "Accept": "application/json"}
        data = None
        if fields is not None:
            data = urlencode(fields).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        request = Request(url, data=data, headers=headers, method=method)
        try:
            with self._open(request, timeout=20) as response:
                payload = json.load(response)
        except HTTPError as exc:
            try:
                body = json.loads(exc.read(65536))
                error = body.get("error", {}) if isinstance(body, dict) else {}
                if not isinstance(error, dict):
                    error = {}
            except (ValueError, OSError):
                error = {}
            finally:
                exc.close()
            intent = error.get("payment_intent")
            intent_id = _intent_id(intent.get("id")) if isinstance(intent, dict) else None
            if exc.code == 402 and error.get("code") == "card_declined":
                raise PaymentError("card_declined", "Stripe declined the test payment; no receipt issued.",
                                   payment_intent_id=intent_id) from None
            if exc.code in (401, 403):
                raise PaymentError("authentication", "Stripe rejected the sandbox key or its permissions.") from None
            raise PaymentError("stripe_http_error", f"Stripe returned HTTP {exc.code}; no receipt issued.",
                               payment_intent_id=intent_id, outcome_unknown=exc.code >= 500) from None
        except (URLError, TimeoutError, OSError):
            raise PaymentError("connection", "Stripe connection failed; payment outcome is unknown. Reconcile or retry with the same attempt ID.",
                               outcome_unknown=True) from None
        except ValueError:
            raise PaymentError("invalid_response", "Stripe returned unreadable data; no receipt issued.",
                               outcome_unknown=True) from None
        if not isinstance(payload, dict):
            raise PaymentError("invalid_response", "Stripe response is not an object; no receipt issued.",
                               outcome_unknown=True)
        return payload

    @staticmethod
    def _receipt(intent: dict, amount_cents: int) -> Receipt:
        intent_id = _intent_id(intent.get("id"))
        if (intent_id is None or intent.get("livemode") is not False
                or type(intent.get("amount")) is not int or intent["amount"] != amount_cents
                or intent.get("currency") != "usd"):
            raise PaymentError("response_mismatch", "Stripe response does not match the expected sandbox payment.",
                               payment_intent_id=intent_id, outcome_unknown=True)
        if intent.get("status") != "succeeded":
            raise PaymentError("not_succeeded", "Stripe has not confirmed payment success; no receipt issued.",
                               payment_intent_id=intent_id, outcome_unknown=True)
        if type(intent.get("amount_received")) is not int or intent["amount_received"] != amount_cents:
            raise PaymentError("amount_mismatch", "Stripe has not received the expected amount; no receipt issued.",
                               payment_intent_id=intent_id, outcome_unknown=True)
        return Receipt(intent_id, amount_cents)

    def charge(self, amount_cents: int, payment_method: str, *, attempt_id: str) -> Receipt:
        if type(amount_cents) is not int or not 50 <= amount_cents <= 10000:
            raise ValueError("Sandbox amount must be an integer between 50 and 10000 USD cents")
        if payment_method not in self.TEST_METHODS:
            raise ValueError("Use one of this integration's two built-in Stripe test PaymentMethods")
        if not isinstance(attempt_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,180}", attempt_id):
            raise ValueError("attempt_id must be a stable ID of 1–180 letters, digits, underscores, or hyphens")
        intent = self._request("POST", self.API, {
            "amount": amount_cents, "currency": "usd", "payment_method": payment_method,
            "allowed_payment_method_types[]": "card", "confirm": "true", "error_on_requires_action": "true",
            "description": "Agent Courtroom sandbox integration check",
            "metadata[integration]": "agent-courtroom-sandbox", "metadata[attempt_id]": attempt_id,
        }, idempotency_key="courtroom-" + attempt_id)
        return self._receipt(intent, amount_cents)

    def verify(self, receipt: Receipt) -> Receipt:
        if not _intent_id(receipt.transaction_id):
            raise ValueError("Expected a Stripe PaymentIntent ID")
        intent = self._request("GET", self.API + "/" + receipt.transaction_id)
        verified = self._receipt(intent, receipt.amount_cents)
        if verified.transaction_id != receipt.transaction_id:
            raise PaymentError("response_mismatch", "Stripe returned a different PaymentIntent.", outcome_unknown=True)
        return verified


def checkout(amount_cents: int, payment_method: str, *, attempt_id: str, gateway: StripeSandbox) -> Receipt:
    """Accept an already-calculated order total; propagate failures instead of faking receipts."""
    return gateway.charge(amount_cents, payment_method, attempt_id=attempt_id)
