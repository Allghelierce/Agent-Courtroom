# Claude-rate costs and a live comparison for the demo

**Goal:** the dashboard's cost figures mean something on stage. Today "Cost of oversight" always reads $0.00 and the with/without comparison never fills in during the live demo.

## The problems

- **Mock court reports no cost.** `court/src/mock.ts` returns `costUsd: 0` for every argument and verdict, so the scripted demo shows oversight as free.
- **Groq dollars round to zero.** The real Groq benchmark (`docs/benchmarks/2026-10-24-groq/`) cost $0.0067 with the court ($0.0007 of it court) and $0.0078 without. The dashboard formats to cents (`ui/lib/data.ts`), so every figure shows $0.00, and the free tier means nobody actually pays.
- **The comparison never starts.** `scripts/demo.py` starts workers but never calls `POST /compare`, so the comparison panel and the "Saved vs. running unsupervised" figure stay empty. Only the offline replay has one baked in.

## Design

### 1. Price Groq tokens at Claude rates (`PRICE_AS=claude`)

`shared/model-prices.json` gets a mapping from each Groq model to the Claude model the court already pairs it with (`court/src/court.ts`, `DEFAULT_MODELS`):

```json
"projectAs": { "claude": { "openai/gpt-oss-120b": "claude-opus-5-5", "openai/gpt-oss-20b": "claude-haiku-5-5" } }
```

With the environment variable `PRICE_AS=claude`, the engine (`engine/courtroom_engine/costs.py`, `price_usage`) and the court (`court/src/court.ts`, `costOf`) price each call's real token usage at the mapped model's rates. Models with no mapping (Claude models, the scripted brain's model) price as before. Unset, nothing changes.

Because the existing cost fields carry the Claude-rate figure, everything downstream agrees without UI changes: the worker's budget check, the overspending monitor, the cost meters, trial costs, the comparison totals, and "Cost of oversight". The budget is effectively in Claude dollars, so an unsupervised loop exhausts it 27 to 33 times faster than at Groq prices (Opus 5.5 is $4/$20 per million tokens against gpt-oss-120b's $0.15/$0.60).

The dashboard shows no label for this. The real Groq figure is kept in the record: `usage` stream messages and trials gain `actualCostUsd`, and comparison results gain `"pricedAs": "claude"`. Both are optional fields in `shared/schema.ts` and `court/src/types.ts`.

### 2. Mock court reports a realistic cost

`mockArgument` and the mock verdict path estimate the tokens a real trial would use: input from the text the real court would send (the rendered packet plus the system prompt, and for the judge, both arguments too) at about 4 characters per token; output from the length of the mock's own reply. They price that with `costOf` at the court's Anthropic defaults: `claude-haiku-5-5` for lawyers, `claude-opus-5-5` for the judge. Expected: about $0.01 to $0.03 per trial. Trials stay `mock: true`. Summary judgments (no trial held) stay at $0.

### 3. `demo.py` starts the comparison

After starting the workers, `scripts/demo.py` calls `POST /compare` for the coding task. The comparison's two arms run one after the other, so they use a faster step delay (`--compare-step-delay`, default 0.3 s) and finish within about a minute. `--no-compare` skips it. The engine has five worker slots and the comparison takes one, so with `--workers 5` the launcher skips the comparison and says so. The launcher also sets `PRICE_AS=claude` for the services it starts. It has no effect on scripted workers, which are already priced at Claude Opus 5.5, but it means a Groq court started by hand with the same setting matches.

### Out of scope

- The existing "Simulated costs" tag on scripted comparisons and the "court ran in mock mode" note stay as they are.
- Making the trap stickier so an unsupervised real Groq worker fails. In the benchmark it still finished 11/11 in 17 steps versus 15, so repricing makes the dollars bigger but the saving stays about 14%.
- Tokenizer differences: Groq and Claude count tokens slightly differently, so the projection is approximate.

## Testing

- Engine unit test: with `PRICE_AS=claude`, a `gpt-oss-120b` usage record prices at Opus 5.5 rates and `actualCostUsd` holds the Groq figure; unset, both match Groq.
- Court unit test: the same for `costOf`, and a mock trial has a cost above $0 that equals its lawyers' and judge's estimates summed.
- `scripts/smoke.py` and the existing engine, court, and plugin suites still pass. The plugin bundles `court/src`, so `plugin/dist/` is rebuilt.
- `scripts/demo.py --no-ui --duration 90`: `/comparisons` returns a result, and the trials in `/history` have a cost above $0.
