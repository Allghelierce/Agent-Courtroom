"""Verify saved worker checkout through a local bridge to the existing Stripe adapter.

Only the parent holds credentials. This local correctness runner is not a hardened
hostile-code sandbox. Retries use verifier-owned attempt IDs, not worker-owned state.
"""

import json
import os
import subprocess
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from integrations.stripe_sandbox import PaymentError, StripeSandbox


def evaluate_stripe(source: Path, *, run_id: str, secret_key: str = "", gateway=None) -> dict:
    report = {"status": "error", "mode": "stripe_sandbox", "runId": run_id, "checks": [],
              "retryOwner": "trusted adapter and verifier", "amountCents": 3897, "currency": "usd"}
    if gateway is None:
        if not secret_key:
            return {**report, "status": "not_run", "reason": "STRIPE_TEST_SECRET_KEY is not configured"}
        try:
            gateway = StripeSandbox(secret_key)
        except ValueError:
            return {**report, "reason": "Invalid Stripe sandbox key"}
    context = {}
    endpoint = "/" + uuid.uuid4().hex + "/charges"

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            context["requests"] += 1
            if self.path != endpoint:
                self.send_error(404)
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 4096:
                    raise ValueError("Invalid request size")
                body = json.loads(self.rfile.read(size))
                if body != {"amount": 3897, "card": context["method"]}:
                    raise ValueError("Wrong amount or payment method")
            except (ValueError, TypeError):
                context["invalidRequest"] = True
                self.send_error(400)
                return
            if context["name"] == "connection_failure":
                # Close before returning any HTTP response. No Stripe call is made.
                self.close_connection = True
                return
            try:
                receipt = gateway.charge(3897, context["method"], attempt_id=context["attempt"])
                context["receipt"] = receipt
                payload = json.dumps({"transaction_id": receipt.transaction_id}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except PaymentError as exc:
                context["providerError"] = exc.code
                context["transactionId"] = exc.payment_intent_id
                self.send_error(402 if exc.code == "card_declined" else 503)

    try:
        with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            first_id = None
            try:
                for name in ("success", "idempotent_retry", "decline", "connection_failure"):
                    method = "pm_card_visa_chargeDeclined" if name == "decline" else "pm_card_visa"
                    context.clear()
                    context.update(name=name, method=method, requests=0,
                                   attempt=run_id + ("-decline" if name == "decline" else "-success"))
                    proc = subprocess.run([sys.executable, "-I", "-B", str(Path(__file__).with_name("stripe_child.py")),
                                           str(source.resolve()), f"http://127.0.0.1:{server.server_port}{endpoint}", method],
                                          cwd=source, env={k: v for k, v in os.environ.items() if k in ("PATH", "SYSTEMROOT", "TMPDIR")},
                                          capture_output=True, text=True, timeout=30)
                    result = json.loads(proc.stdout)
                    valid = proc.returncode == 0 and context["requests"] == 1 and not context.get("invalidRequest")
                    provider_error = context.get("providerError")
                    if provider_error and provider_error != "card_declined":
                        report["checks"].append({"name": name, "status": "error", "reason": provider_error})
                        break
                    payment = context.get("receipt")
                    if name in ("success", "idempotent_retry"):
                        valid &= payment is not None
                        if payment:
                            verified = gateway.verify(payment)
                            valid &= verified == payment and result.get("receipt") == {
                                "transaction_id": payment.transaction_id, "amount": 38.97}
                            if name == "success":
                                first_id = payment.transaction_id
                            else:
                                valid &= payment.transaction_id == first_id
                    elif name == "decline":
                        valid &= provider_error == "card_declined" and "raised" in result and "receipt" not in result
                    else:
                        valid &= "raised" in result and "receipt" not in result
                    report["checks"].append({"name": name, "status": "passed" if valid else "failed",
                                             "source": "locally_injected_failure" if name == "connection_failure" else "stripe_api",
                                             "requests": context["requests"],
                                             "transactionId": payment.transaction_id if payment else context.get("transactionId")})
            finally:
                server.shutdown()
                thread.join(timeout=5)
        statuses = [c["status"] for c in report["checks"]]
        report["status"] = ("error" if "error" in statuses or len(statuses) != 4
                            else "passed" if all(s == "passed" for s in statuses) else "failed")
    except (OSError, ValueError, subprocess.TimeoutExpired, PaymentError) as exc:
        report.update(status="error", reason=type(exc).__name__)
    return report
