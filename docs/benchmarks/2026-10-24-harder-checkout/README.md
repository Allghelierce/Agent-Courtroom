# Harder natural checkout run: October 24, 2026

One real paired run used the new checkout_hard seed with identical 20B workers,
batching, permissions, empty-response retries and existing monitor thresholds.
The original GROQ_API_KEY was used after the user reported upgrading its tier.
All 54 engine tests passed, including a valid reference repair for the harder
seed. The seed and evaluator were frozen before the run (revision 62da8f1).

| Arm | Turns | Seconds | Final recovery | Stripe | Outcome |
| --- | --- | --- | --- | --- | --- |
| Court enabled | 27 | 45.732 | 20/22 | Not run | Halted after escalation |
| Court disabled | 30 | 48.139 | 20/22 | Not run | Step limit |

## What triggered and what happened

1. The assisted worker improved from 5/20 to 18/20 public checks, then stalled
   for eight steps. Events 12–19 included malformed tool calls and failed edits.
   The unchanged stalling monitor filed a real charge at step 19.
2. A live 20B-lawyer/120B-judge trial, case-d6334ab5, returned change_strategy.
   The judge told the worker to load recovery.json in payments.py and return a
   successful mock response in test mode. This conflicts with the task's rule
   that production payment code must not fabricate successful receipts.
3. At step 21 the worker implemented that direction. Public checks fell to
   13/20 at step 22. The worker removed the short-circuit at step 24, but other
   payment defects remained. Its last public counter was stale after that edit.
4. At step 27, another eight-step stall triggered the court's recent-repeat
   policy. Case-3aa277ea escalated automatically, without another model trial.
   Benchmark human wait is zero, so the engine then halted the worker.
5. Fresh verification on saved source passed 20/22 in both arms. Both still read
   the wrong transaction-ID response field. The unassisted arm hit its 30-step
   limit. Neither qualified for Stripe sandbox checks.

There was exactly one model-backed trial and one automatic escalation record.
The live court cost estimate was $0.001091 with complete court accounting. Both
worker totals are unknown because malformed calls omitted provider usage; no
cost-saving claim is supported. The court did not time out.

**The harder task triggered court naturally with batching enabled. The court's
first instruction caused a temporary regression; this pair does not show useful
recovery guidance or a successful solution.** The earlier stop demonstrates the
escalation path, not improved task success. These two samples do not establish
that the court was the sole cause of final failure.

## Evidence and next diagnosis

[Results](result.json), [steps and verdicts](steps-and-verdicts.json), court case
files and per-arm verification/diffs are preserved. Raw local evidence:
`runs/benchmarks/20261025-013513-050268-hard/`.

The worker sees the full task system rules. Court packets currently send the
short task prompt, and the court renderer truncates that task to 300 characters.
The judge prompt also gives mocking/skipping tests as generic examples. Passing
complete task restrictions to the court is a concrete next improvement; it has
not been implemented or evaluated in this checkpoint.
