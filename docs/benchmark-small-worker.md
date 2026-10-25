# Llama 8B worker with optional 120B advice

One exploratory pair uses `meta-llama/llama-3.1-8b-instruct` through OpenRouter's
Groq endpoint, with and without a single `openai/gpt-oss-120b` advisor through
the original Groq account. The direct Groq account denied Llama access; the
OpenRouter route passed a live tool-call probe. This replaces the three-role
court with one advisor, and must be labeled as a single-advisor experiment.

Both arms start fresh on the same frozen checkout_hard seed, use identical
worker prompts, tools, batching and empty-response retries, and have 100 turns
and a $0.50 worker budget. The existing looping/stalling thresholds are unchanged.
Every ten turns produces a progress message. The assisted arm runs first.

At a monitor trigger, the 120B advisor receives the full task rules, documented
tools, recent events and current source, including the original visible tests.
It sees no reference solution or prior-run advice. Advice cannot change task
permissions. All inputs, outputs, token usage and decisions are retained.
The advisor gets a 120-second request deadline, one recorded retry for recognized
provider output-format errors (failed usage stays unknown), and a separate
$0.10 budget checked between calls. A failed request halts without substituted
human/assistant guidance. Escalations halt because no human wait is configured.

Success requires all 22 saved-source checks; only then do four Stripe sandbox
checks run. Provider errors, invalid calls and unknown usage remain recorded.
OpenRouter response usage.cost is preferred for worker accounting; missing cost
marks totals unknown. Budget fallback uses the pinned Groq endpoint's rates:
$0.05 input, $0.08 output, $0.025 cached input per million tokens. Groq advisor
rates are $0.15 input, $0.60 output, $0.075 cached input per million tokens.
These exclude unrelated probe calls, credit-purchase fees and taxes.

The tools-capable route costs more than the model's lowest advertised endpoint.
Provider fallback is disabled and tool-parameter support is required.

Sources checked October 24, 2026:

- [OpenRouter endpoint metadata](https://openrouter.ai/api/v1/models/meta-llama/llama-3.1-8b-instruct/endpoints)
- [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)
- [Groq 120B pricing](https://console.groq.com/docs/model/openai/gpt-oss-120b)

Run `.venv/bin/python -u scripts/small_worker_benchmark.py` after configuring
OPENROUTER_API_KEY and GROQ_API_KEY in ignored .env.local. STRIPE_TEST_SECRET_KEY
is needed for Stripe verification. Never put keys in tracked files.

This measures an initial attempt, not proven general savings. Advisor visibility
is richer than in the earlier court run, so cross-run changes cannot isolate
model size alone. Compare the two arms within the new pair.
