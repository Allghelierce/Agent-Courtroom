# Test a functioning payment API with Stripe

## Verified October 24, 2026

10 offline regression tests and all five sandbox smoke checks passed. The success,
idempotent retry, retrieval, and decline checks contacted Stripe's actual sandbox
API. The connection-failure check was injected locally. No real funds moved.

The successful USD 38.97 test payment is `pi_3UUEzjDnIxnKMIkS48sKOoK4`.
Find it in the same sandbox's Payments view. See the saved
[verification report](stripe-sandbox-result.json) for the payment references and checks.

The initial request was rejected because `payment_method_types` is no longer
supported by this account's API. The adapter now uses the documented
`allowed_payment_method_types` field. Offline request tests cover that field.

## Scope

This optional integration calls Stripe's actual sandbox API. It tests payment
confirmation and failure handling without moving money. It accepts a precomputed
USD order total; it does not test cart arithmetic or approve the worker-generated
benchmark repairs. The original benchmark seed and results remain unchanged.

## Setup

1. In your Stripe sandbox, obtain a **secret test key** (`sk_test_...`) or a
   restricted test key (`rk_test_...`) with PaymentIntent read/write permissions.
   A publishable `pk_test_...` key cannot make these server requests.
2. Add it to the repository's ignored `.env.local`, alongside the existing Groq key:

   ```dotenv
   STRIPE_TEST_SECRET_KEY=your_stripe_test_secret_key
   ```

3. From the repository root, run:

   ```sh
   .venv/bin/python scripts/stripe_smoke.py
   ```

The script makes sandbox requests only. Live keys are rejected before any
request, and only two built-in Stripe test PaymentMethods are accepted. No real
card details are needed. The test amount is **3897 cents (USD 38.97)**.

## What passes

1. Create and confirm a payment using `pm_card_visa`. Issue a receipt only if the
   response says `succeeded`, `livemode=false`, and the expected amount/currency
   was received. The receipt uses Stripe's actual `pi_...` identifier.
2. Repeat the request with the same idempotency key; require the same payment ID.
3. Retrieve that payment from Stripe independently and verify its ID, status,
   amount, and sandbox mode.
4. Use `pm_card_visa_chargeDeclined`; require a Stripe decline and no receipt.
5. Inject a connection failure locally; require no receipt and an **unknown**
   payment outcome. This fifth check simulates an outage—it does not disrupt Stripe.

`runs/stripe/<run-id>/report.json` records each check and its source, the payment
references, and any failure. It excludes API keys and PaymentIntent client secrets.
Find the printed `pi_...` ID in the **same sandbox's Payments view** and compare
the USD 38.97 amount and success status.

If a run is interrupted, its run ID is printed and saved before requests begin.
For a prompt retry, reuse it rather than creating a new payment attempt:

```sh
.venv/bin/python scripts/stripe_smoke.py --run-id run-your-saved-id
```

Stripe may prune idempotency keys after 24 hours. Inspect the sandbox payment
records before retrying an older run. A network failure does not prove that a
payment failed: reconcile the existing attempt instead of inventing a receipt.

## Offline regression tests

```sh
.venv/bin/python -m unittest discover -s integrations/tests -v
```

These tests use injected responses and make no external API requests. Passing
them alone does not verify the Stripe account or connection. The API runner is
the separate provider check. This is a synchronous sandbox exercise, not a full
production integration with browser authentication flows, webhooks, refunds, or
fulfillment.

Sources: [Stripe sandbox testing](https://docs.stripe.com/testing),
[create PaymentIntent](https://docs.stripe.com/api/payment_intents/create),
[retrieve PaymentIntent](https://docs.stripe.com/api/payment_intents/retrieve),
[idempotent requests](https://docs.stripe.com/api/idempotent_requests), and
[authentication](https://docs.stripe.com/api/authentication).
