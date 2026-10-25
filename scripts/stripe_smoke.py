"""Test the Stripe sandbox adapter without modifying the original worker benchmark."""

import argparse
import json
import os
import re
import sys
import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import URLError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from integrations.stripe_sandbox import PaymentError, StripeSandbox, checkout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env.local")
    parser.add_argument("--run-id", default="run-" + uuid.uuid4().hex,
                        help="Reuse this ID to retry an interrupted run with the same idempotency keys")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", args.run_id):
        parser.error("--run-id must contain 1–120 letters, digits, hyphens, or underscores")
    if args.env_file.is_file():
        from dotenv import load_dotenv
        load_dotenv(args.env_file, override=False)
    try:
        gateway = StripeSandbox(os.environ.get("STRIPE_TEST_SECRET_KEY", ""))
    except ValueError as exc:
        parser.error(str(exc))
    out = ROOT / "runs/stripe" / args.run_id
    out.mkdir(parents=True, exist_ok=True)
    report = {"runId": args.run_id, "startedAt": datetime.now(timezone.utc).isoformat(),
              "mode": "stripe_sandbox", "amountCents": 3897, "currency": "usd", "checks": []}

    def save():
        temp = out / "report.tmp"
        temp.write_text(json.dumps(report, indent=2) + "\n")
        temp.replace(out / "report.json")

    save()  # retain the attempt ID before contacting the provider
    print(f"Sandbox run: {args.run_id}\nTest amount: USD 38.97\nEvidence: {out / 'report.json'}", flush=True)
    receipt = None
    try:
        receipt = checkout(3897, "pm_card_visa", attempt_id=args.run_id + "-success", gateway=gateway)
        report["checks"].append({"name": "successful_payment", "passed": True,
                                 "source": "stripe_api", "receipt": asdict(receipt)})
        save()
        print("PASS: Stripe confirmed the sandbox payment.", flush=True)
        replay = checkout(3897, "pm_card_visa", attempt_id=args.run_id + "-success", gateway=gateway)
        if replay != receipt:
            raise PaymentError("idempotency_mismatch", "Retry returned a different payment; stop and inspect the sandbox.")
        report["checks"].append({"name": "idempotent_retry", "passed": True,
                                 "source": "stripe_api", "transactionId": replay.transaction_id})
        save()
        verified = gateway.verify(receipt)
        report["checks"].append({"name": "retrieve_and_verify", "passed": True,
                                 "source": "stripe_api", "receipt": asdict(verified)})
        save()
        print("PASS: Retry returned the same payment; retrieval verified its status and amount.", flush=True)
        try:
            checkout(3897, "pm_card_visa_chargeDeclined", attempt_id=args.run_id + "-decline", gateway=gateway)
        except PaymentError as exc:
            if exc.code != "card_declined":
                raise
            report["checks"].append({"name": "declined_payment_no_receipt", "passed": True,
                                     "source": "stripe_api", "transactionId": exc.payment_intent_id})
        else:
            raise PaymentError("unexpected_success", "The decline test unexpectedly returned a receipt.")
        save()
        print("PASS: Stripe declined the test payment; checkout returned no receipt.", flush=True)

        def offline(request, timeout):
            raise URLError("injected connection failure")

        offline_gateway = StripeSandbox("sk_test_offline", transport=offline)
        try:
            checkout(3897, "pm_card_visa", attempt_id=args.run_id + "-offline", gateway=offline_gateway)
        except PaymentError as exc:
            if exc.code != "connection" or not exc.outcome_unknown:
                raise
            report["checks"].append({"name": "connection_failure_no_receipt", "passed": True,
                                     "source": "locally_injected_failure", "outcomeUnknown": True})
        else:
            raise PaymentError("unexpected_success", "The connection-failure test unexpectedly returned a receipt.")
        report["passed"] = True
        print("PASS: Injected connection failure returned no receipt and marked the outcome unknown.", flush=True)
    except PaymentError as exc:
        report.update(passed=False, error={"code": exc.code, "message": str(exc),
                                          "outcomeUnknown": exc.outcome_unknown,
                                          "transactionId": exc.payment_intent_id})
        print(f"FAIL: {exc}", flush=True)
    finally:
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        save()
    if receipt:
        print(f"Find {receipt.transaction_id} in the same Stripe sandbox's Payments view.", flush=True)
    return 0 if report.get("passed") else 1


if __name__ == "__main__":
    raise SystemExit(main())
