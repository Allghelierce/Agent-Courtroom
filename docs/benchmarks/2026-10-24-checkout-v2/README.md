# Stronger checkout checks and batching: October 24, 2026

One complete live 20B pair used independent checkout verification, followed by
one complete pair with batch file reads. Each pair used the same worker model
and permissions in both arms. The court used 20B lawyers and a 120B judge when
invoked. These are exploratory attempts, not a statistical comparison.

| Run | Arm | Worker turns | Recovery checks | Stripe checks | Court intervention |
| --- | --- | --- | --- | --- | --- |
| Before batching | Court enabled | 8 | Failed, 12/22 | Not run | Judge request aborted; escalated and halted |
| Before batching | Court disabled | 21 | Passed, 22/22 | Passed, 4/4 | None |
| With batching | Court enabled | 8 | Passed, 22/22 | Passed, 4/4 | None needed |
| With batching | Court disabled | 16 | Failed, 15/22 | Not run | None; Groq daily token quota exhausted |

The successful batched run read seven files in one call. It fixed cart/pricing
and declared a test-only mock; production payment code and original tests stayed
unchanged. Its recorded worker runtime was 90.378 seconds and complete list-price
usage estimate was $0.002384. This is not an invoice. The previous valid unassisted
run took 21 turns and 296.060 recorded seconds. Different model attempts and
provider limits prevent a causal speedup claim from these two observations.

The batched unassisted attempt used 16 model turns but recorded 15 tool steps:
its final provider request failed on the 20B daily token quota. Its final saved
code passed 15/22 checks; the last in-run 14/20 progress count was stale. Unknown
usage leaves its total cost and comparative savings unknown.

**These results establish stronger verification and a valid eight-turn batched
solution. They do not establish a benefit from courtroom intervention.**
The passing batched arm had no trial or court instruction. The failed baseline
court arm suffered a request abort, not a substantive judicial rejection.

## Evidence

- [Before batching](baseline.json), [turn counts](baseline-turns.json),
  [assisted verification](baseline/withCourt/verification.json),
  [unassisted verification](baseline/withoutCourt/verification.json).
- [Batched results](batched.json),
  [successful diff](batched/withCourt/changes.diff),
  [successful verification and Stripe records](batched/withCourt/verification.json),
  [provider-limited verification](batched/withoutCourt/verification.json).
- [Interrupted queue disclosure](interrupted-queue.json): the first launch was
  initially configured for three pairs. After the user reduced the limit to one,
  a second pair briefly started before SIGINT stopped the runner. That partial
  attempt is preserved and excluded from completed-pair counts. The batch-read
  launch used `--repetitions 1` and exited normally.

Raw sources, events, usage, and trials remain locally under ignored directories:
`runs/benchmarks/20261025-003715-921589/` (revision `60925dc`) and
`runs/benchmarks/20261025-010020-609157/` (revision `fd66246`).
The exported provider error redacts the organization identifier; the raw log is
unchanged. Automated check results remain separate from human review.

## Presentation

Use the existing scripted/mock courtroom replay to demonstrate the workflow.
Show this real checkout/Stripe evidence separately. Label scripted costs as
simulated and do not claim proven court savings or improved recovery rates.
