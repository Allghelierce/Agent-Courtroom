"""Invoke the saved worker code; only configure its gateway endpoint for this test."""

import json
import sys

sys.path.insert(0, sys.argv[1])
try:
    import cart
    import checkout
    import payments
    payments.GATEWAY_URL = sys.argv[2]
    order = cart.Cart()
    order.add_item("book", 20.0, 2)
    receipt = checkout.checkout(order, sys.argv[3], discount_percent=10)
    result = {"receipt": {"transaction_id": receipt.transaction_id, "amount": receipt.amount}}
except Exception as exc:
    result = {"raised": type(exc).__name__}
print(json.dumps(result))
