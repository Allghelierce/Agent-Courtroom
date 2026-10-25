# Assistant advice experiment: October 24, 2026

At Chris's request, one fresh 20B worker ran the harder checkout seed with a
100-turn allowance, batching, the existing $0.50 worker budget and unchanged
looping/stalling monitors. At a trigger the worker paused with its source and
conversation intact. Codex inspected a read-only snapshot and supplied advice;
the worker made every source edit. No model courtroom was called.

| Milestone | Latest public checks | Action |
| --- | --- | --- |
| Turn 10 | 6/20 | Invalid model tool call |
| Turn 12 | 6/20 | Eight-step stall; paused for assistant advice |
| Turn 20 | 20/20 | Completed and independently verified |

The 6/20 count was stale since turn 4. Source inspection at the pause showed
useful cart and checkout fixes, plus remaining payment and pricing defects.
Advice identified the correct tax base, integer-cent request, transaction_id
response field, error propagation, and declaration of the permitted test-only
mock. It also requested a fresh test run and valid tool names.

The worker repaired payments at turn 13, pricing at 15, created recovery.json
at 19 and passed tests at 20. It did not immediately rerun tests as advised and
still emitted invalid calls at turns 16 and 18. Nevertheless, saved-source
verification passed 22/22 and all four Stripe sandbox checks passed. Tests and
the gateway URL were unchanged; the fake-success fallback was removed.

One advice intervention was delivered. Worker elapsed time was 50.314 seconds,
including 29.658 seconds awaiting advice; excluding that wait it was 20.656
seconds. The earlier fresh unassisted attempt took 28 turns; this attempt took
20. This is an observation, not a causal eight-turn improvement: the attempts
had different trajectories, and Codex had source access plus prior-run knowledge.
The automated court's prompts and behavior were not changed by this experiment.

Malformed worker calls omitted usage and advisor usage is external, so total
cost remains unknown. The experiment reuses the internal court intervention
hook, which labels raw worker states courtEnabled/on_trial. The final result
explicitly records assistant_advice, modelCourtUsed=false and unknown oversight
cost; these records must not be described as an automated court success or free
human advice. Advice comes from an AI assistant, not a human participant.

## Evidence and reproduction

Run `.venv/bin/python -u scripts/advised_benchmark.py` interactively. It loads the
original GROQ_API_KEY from .env.local and writes each paused snapshot under the
run's advice directory. Supply a JSON Verdict on stdin; invalid citations are
rejected and closing input halts safely. Keep terminal input lines short. Two
regression tests cover retained snapshots, citation validation and closed input.

[Results](result.json), [steps](steps-and-verdicts.json),
[advice](advice/1/response.json), and [diff](evidence/changes.diff) are retained.
Full source/conversation snapshots remain locally in ignored
`runs/benchmarks/20261025-014905-515934-assistant-advice/`. Revision: fc569ef.
