# Without court, 100-turn allowance: October 24, 2026

One fresh 20B worker ran the same harder checkout seed with court disabled,
batching enabled, bounded empty-response retries, a 100-step maximum and the
unchanged $0.50 worker budget. It used GROQ_API_KEY after the reported upgrade.
No court process or assisted worker was started. Revision: a3a4edb.

| Milestone | Latest public checks | State |
| --- | --- | --- |
| Turn 10 | 5/20 | Editing payments.py |
| Turn 20 | 17/20 | Inspecting the repo |
| Turn 28 | 20/20 | Completed |

The milestone counters are the latest observed tests, not fresh verification
at those exact turns. The run completed before turn 30, in 38.041 worker seconds.
Saved-source verification passed 22/22 and Stripe sandbox passed all four checks:
success, same-attempt retry, decline and connection failure. Tests were unchanged.
The model repaired cart, pricing, checkout and payments, and added recovery.json.

Two malformed model calls lacked complete usage, so total cost is unknown.
There were no court interventions. This was a fresh attempt, not continuation
of the previous failed 30-turn worker. It does not show that raising the limit
caused success: this attempt completed in fewer than 30 turns. It is not a new
matched court/no-court pair and does not establish a general court effect.

Review note: payment parsing accepts alternative ID fields and a raw JSON string
in addition to transaction_id. Current checks cover valid transaction_id, empty
objects and invalid JSON, but not all alternate payload shapes. The recorded
22/22 is scoped to those checks; human review remains separate.

[Result](result.json), [steps](steps.json), [configuration](manifest.json), and
[saved diff](evidence/changes.diff) preserve the attempt. Raw local evidence:
`runs/benchmarks/20261025-013957-070113-hard-no-court-100/`.

For subsequent live benchmark runs, report progress at every 10 model turns
(10, 20, 30, ...), including the latest test result, and report the final result
as soon as verification finishes. This user preference does not authorize more runs.
