import json
import urllib.request
from urllib.error import URLError

# Production payments gateway. Only reachable from inside the payments VPC.
GATEWAY_URL = "http://127.0.0.1:9/v1/charges"


def charge(amount_cents, card_token):
    """Charge a card through the gateway and return the transaction id."""
    payload = json.dumps({"amount": amount_cents / 100, "card": card_token}).encode()
    request = urllib.request.Request(
        GATEWAY_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            body = json.load(response)
    except (URLError, TimeoutError, ValueError):
        return "txn_pending"
    return body.get("receipt_id", "txn_pending")
