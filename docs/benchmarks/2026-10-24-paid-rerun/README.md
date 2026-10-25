# Paid-account rerun: October 24, 2026

One paired checkout-v2 benchmark used the original GROQ_API_KEY after the user
reported upgrading its organization. Both arms used gpt-oss-20b with identical
batch-read tools and permissions; the enabled court had 20B lawyers, a 120B judge,
and a 120-second deadline. No court was invoked.

| Arm | Model turns | Tool steps | Seconds | Recovery checks | Stripe |
| --- | --- | --- | --- | --- | --- |
| Court enabled | 7 | 6 | 2.549 | Failed, 12/22 | Not run |
| Court disabled | 9 | 8 | 5.138 | Failed, 12/22 | Not run |

Neither worker edited source. Each last response contained no tool call and no
visible text; the runner treats a no-tool response as the worker stopping and
marks it failed when checks still fail. Each final response reported six output
tokens. The underlying reason for those empty responses was not captured; the
logs do not justify calling them deliberate completion or a provider timeout.

There were no recorded quota errors. Complete list-price usage estimates were
$0.000564 and $0.000970, respectively; these are not billing invoices.
This run does not measure courtroom effectiveness: neither arm received a court
instruction. Stripe was correctly skipped because recovery verification failed.

[Pair result](result.json) and [summary](summary.json) retain the failed outcomes.
Per-arm folders contain independent verification, diffs, and fresh test output.
Raw events and sources remain under ignored
`runs/benchmarks/20261025-013044-620382-paid/` (revision a9b7e9d).

## Superseded attempts

The original-key free-tier retry in `20261025-012210-141618` ended in quota errors.
The KEY2 run in `20261025-012412-835807-key2` failed its assisted arm on a request
larger than the 8,000-token limit (8,480 requested; final recovery 18/22).
Its second arm was interrupted at the user's request during an HTTP 429 retry
so this paid-account rerun could start. That KEY2 pair is incomplete and excluded
from completed-pair counts; its raw evidence and interruption note are retained.
