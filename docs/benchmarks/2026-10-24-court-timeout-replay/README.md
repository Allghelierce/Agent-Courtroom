# Two-minute court deadline: one live replay

Replayed the evidence from aborted case `case-77dfe9a4` once, using the same
20B lawyers and 120B judge. The court deadline is now 120 seconds, provider
requests share that limit, and the engine waits 130 seconds for the response.
Source revision: `a8311486d7e12f5cc16fa40afdf0bf658baebe67`.

The live trial completed in **56.187 seconds** and returned **change_strategy**.
That observed duration exceeds the old 50-second deadline. The judge advised
running the test suite and then editing `checkout.py` to address failures.
The response and both arguments had reported usage; total list-price cost was
**$0.000707**, not a billing receipt.

This verifies successful court completion with the longer deadline. It does not
establish why the original request was aborted or whether the returned instruction
helps: the worker was not resumed, and the suggested file was not independently
validated as the correct target. No new worker benchmark was started.

- [Replay report](report.json)
- [Full saved trial](trial.json)

Validation: 11 court deadline/environment tests and seven Python court-evidence
tests passed. The initial sandboxed environment test could not bind a localhost
port; rerunning with localhost permission passed all 11 tests. Existing dashboard
services were left running; they need a restart to load the new timeout defaults.

Raw evidence remains under `runs/court-timeout-replay/20261025-011920/` locally.
