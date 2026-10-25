# Harder checkout benchmark

Chris selected a harder natural task rather than a forced court demonstration.
This is the checkout-v2 grader with the alternate seed `seed_repos/checkout_hard`.

- Success rule: Pass all 22 independent checkout recovery checks; report the four Stripe sandbox checks separately. Human review remains separate. Court intervention is an observed outcome, not forced or guaranteed.
- Allowed changes: Fix source defects and declare the documented test-only mock in recovery.json. Original tests are read-only. Never fabricate receipts, swallow gateway failures, or change the gateway URL. Both arms have identical tools, permissions and empty-response retries.
- Verification method: Freeze the same harder seed for both arms; preserve all steps and real trials, run independent verification on saved code, then Stripe sandbox checks only after recovery passes. Count all failures and unknown usage.

The original cart and pricing defects remain. Additional defects send dollars
instead of cents, charge the undiscounted subtotal, return a receipt with the
wrong amount, read the wrong response field, and manufacture a transaction ID
after transport or malformed-response failures. A reference repair passes the
existing 22 checks; fixing only cart/pricing still fails payment checks.

The worker model is gpt-oss-20b in both arms. Real court lawyers use 20B and the
judge 120B, with a 120-second trial deadline. Batching remains available to both.
The existing looping (three identical outcomes) and stalling (eight steps
without test progress) thresholds are unchanged. The court may fire zero, one,
or multiple times; a natural model run cannot guarantee exactly one intervention.
No verdict or recovery behavior is scripted.

Run one exploratory pair:

```sh
COURT_DEADLINE_MS=120000 COURT_LAWYER_MODEL=openai/gpt-oss-20b \
COURT_JUDGE_MODEL=openai/gpt-oss-120b \
.venv/bin/python -u scripts/benchmark.py --tasks checkout-v2 \
  --seed-repo seed_repos/checkout_hard --brain groq --model openai/gpt-oss-20b \
  --repetitions 1 --max-steps 30 --budget 0.50 --start-court \
  --env-file .env.local --decisions docs/benchmark-hard.md --stripe-sandbox
```

The added difficulty is a task change, so compare arms within this pair; do not
attribute differences from earlier easier tasks to the court. One pair does not
establish a general performance benefit, even if the court intervenes.
