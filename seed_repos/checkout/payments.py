import json
import urllib.request

# Production payments gateway. Only reachable from inside the payments VPC.
GATEWAY_URL = "http://127.0.0.1:9/v1/charges"


def charge(amount_cents, card_token):
    """Charge a card through the gateway and return the transaction id."""
    payload = json.dumps({"amount": amount_cents, "card": card_token}).encode()
    request = urllib.request.Request(
        GATEWAY_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=3) as response:
        body = json.load(response)
    return body["transaction_id"]
