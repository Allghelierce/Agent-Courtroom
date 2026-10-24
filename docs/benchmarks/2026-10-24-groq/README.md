# First real Groq comparison — review pending

One coding pair ran from clean revision `57f0dfd0aebb6b6bd802832f0b737adf0bd6fbb0`
on October 24, 2026. Both arms used `openai/gpt-oss-120b`, identical frozen seed
files and prompts, a 30-step limit, and a $0.50 worker budget. The court-enabled
arm ran first, using the real Groq court. There was no human intervention.

| Arm | Engine tests | Steps | Seconds | Worker USD | Court USD | Total USD |
| --- | --- | --- | --- | --- | --- | --- |
| With court | 11/11 | 15 | 189.050 | 0.006007 | 0.000713 | 0.006720 |
| Without court | 11/11 | 17 | 218.536 | 0.007843 | 0 | 0.007843 |

Costs are estimates from reported usage, not invoices. Both arms' saved code
also passed a fresh test run. **Neither outcome has been independently judged
recovered.** This single pair does not establish a general benefit or a reliable
success rate. The court can override the worker's no-mocking restriction, so the
comparison includes a permission change as well as oversight.

## Joint review starts here

1. Read the frozen [decision record](decisions.md).
2. Inspect the with-court [diff](withCourt/changes.diff),
   [test output](withCourt/tests.txt), and [verification record](withCourt/verification.json).
3. Inspect the without-court [diff](withoutCourt/changes.diff),
   [test output](withoutCourt/tests.txt), and [verification record](withoutCourt/verification.json).
4. Check for documented mocking, an explicit unresolved-integration note, and any
   deleted tests or weakened assertions before assigning recovered/blocked/failed.

[results.json](results.json) records the configuration and measurements. Complete
source snapshots, events, usage, and court transcripts remain locally under
`runs/benchmarks/20261024-234443-068442/`, which is ignored by Git. This folder
publishes selected review evidence only; API keys and service logs are excluded.
