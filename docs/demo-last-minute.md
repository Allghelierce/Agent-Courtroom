# Last-minute demo

The local dashboard, engine, and court returned HTTP 200 during the final check.
No model benchmark remains running. Use the existing recorded demo to avoid
depending on provider quotas.

1. Open http://localhost:3000.
2. Open the recorded checkout trial: http://localhost:3000/court/case-4b9f6022.
3. Explain the sequence: worker repeats failing tests; monitor detects the loop;
   court presents both arguments and orders a strategy change; the scripted
   worker recovers. This recorded trial is explicitly mock mode.
4. Show the [real verification results](benchmarks/2026-10-24-checkout-v2/README.md):
   one batched worker finished in eight turns, passed 22 independent checks,
   and passed four Stripe sandbox checks. It did not need court intervention.

Suggested wording:

> The courtroom is an on-demand supervisor for stuck agents. This scripted replay
> demonstrates detection, a trial, and intervention. Separately, we tested real
> 20B workers with independent correctness checks and Stripe sandbox verification.
> We have not yet established that courtroom guidance improves recovery or cost.

If the stack has been stopped, restart the existing demo from the repository:

```sh
.venv/bin/python scripts/demo.py
```

The launcher uses scripted workers and a mock court, with simulated worker costs.
The dashboard's live connection refers to engine events; it does not mean the
workers or court are making live model calls. Stripe sandbox checks move no real
money. Keep these labels clear during the presentation.

Push checkpoint summary: **Record strengthened checkout and batching results**

Description: **Preserve the two completed comparisons, Stripe evidence, provider
failures, and interrupted queue. Add an honest scripted-demo handoff; no claim of
proven courtroom savings.**
