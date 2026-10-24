# court

Person B's courtroom: turns a monitor's Charge into a trial and a Verdict.

```ts
import { buildPacket, convene, holdTrial } from "./src/index.ts";

const packet = buildPacket(charge, events, { budgetUsd: 1.0 }); // evidence packet
const verdict = await convene(packet);   // contract for Person A: Verdict only
const trial = await holdTrial(packet);   // full record for the UI and case log
```

- **Prosecutor and Defense** run in parallel. Each must cite event IDs. IDs not in the packet are dropped.
- **Judge** returns the Verdict JSON from WORK_SPLIT.md.
- **Safety defaults:** if the Judge errors or refuses, the ruling is `escalate`. A `change_strategy` with no instruction also becomes `escalate`.
- **Works for any task:** the court reasons over `testsPassing` / `testsTotal`, which the engine fills with tests passing (`coding` task) or products resolved (`prices` task).

## Providers and environment

The court picks a provider automatically: **Anthropic** if `ANTHROPIC_API_KEY` is set, otherwise **Groq** if `GROQ_API_KEY` is set, otherwise the **mock** (deterministic, no model calls). `trial.mock` and `trial.judgeModel` say which ran.

| Provider | Lawyers | Judge | Notes |
|---|---|---|---|
| Anthropic | `claude-haiku-5-5` | `claude-opus-5-5` | Server-side refusal fallbacks on (`fallbacks: "default"`). |
| Groq | `openai/gpt-oss-20b` | `openai/gpt-oss-120b` | JSON-schema output, checked against the same Zod schemas. The free tier rate-limits, and the SDK retries within the deadline. |

| Env var | Default | What it does |
|---|---|---|
| `COURT_PROVIDER` | auto | `anthropic` or `groq` forces a provider. |
| `COURT_MOCK` | unset | `1` forces the mock even with a key set. |
| `COURT_LAWYER_MODEL` / `COURT_JUDGE_MODEL` | per provider | Override the models. |
| `COURT_DEADLINE_MS` | `50000` | Time limit for a whole trial. The engine's `HttpCourt` times out at 60s. A lawyer who runs out of time rests, and a Judge who can't rule gives `escalate`. |
| `COURT_PORT` | `4100` | HTTP port. |
| `COURT_HOST` | `127.0.0.1` | Interface to bind. Use `0.0.0.0` to accept other machines. |
| `COURT_CASES_DIR` | `court/cases/` | Where trials are saved and precedent is read from. |

**Cost:** prices come from `shared/model-prices.json` (USD per million tokens, shared with the engine). Each trial records `costUsd`, `costComplete` (false if a model had no listed price), and `pricingDate`. The engine fetches the trial with `GET /cases/<X-Case-Id>` and adds `costUsd` to `WorkerStatus.courtCostUsd`.

## Run

```bash
npm install
npm run trial -- fixtures/looping-run.json            # print a transcript
npm run trial -- fixtures/looping-run.json --save cases  # also write cases/<id>.json
npm run typecheck
```

`examples/sample-trial.json` is a saved mock trial (the `Trial` type in `src/types.ts`) for building the courtroom scene and case log against.

## HTTP

`npm run serve` starts a small server on `COURT_HOST:COURT_PORT` (default `127.0.0.1:4100`), so the worker and the UI can reach the court over HTTP. CORS is open. Trials are saved to `COURT_CASES_DIR` (default `court/cases/`). Point the engine at it with `--court http://localhost:4100/verdict`.

```bash
curl localhost:4100/health                                  # {"ok":true}
curl -X POST localhost:4100/convene \
  -H 'Content-Type: application/json' -d @fixtures/looping-run.json   # body {charge, events, budgetUsd} → Trial
curl localhost:4100/cases                                   # every Trial, oldest first
curl localhost:4100/cases/case-d399b1db                     # one Trial, 404 if missing
```

**Engine endpoint.** `POST /verdict` is the contract from `shared/schema.ts`. The body is the engine's `EvidencePacket`, `{charge, events, testProgress, spend: {costUsd, budgetUsd}, task}`. The response is just the `Verdict`. The saved trial's ID comes back in the `X-Case-Id` header, and the IDs of any precedents the Judge was shown come back comma-separated in `X-Precedents` (empty if none). A missing or mistyped field returns 400. To build a body from the fixture by hand:

```bash
node -e 'const r=require("./fixtures/looping-run.json"), ev=r.events; console.log(JSON.stringify({
  charge: r.charge, events: ev,
  testProgress: ev.map(e => ({step: e.step, testsPassing: e.testsPassing, testsTotal: e.testsTotal})),
  spend: {costUsd: ev.reduce((a, e) => a + e.costUsd, 0), budgetUsd: r.budgetUsd},
  task: "Make the failing test suite pass"}))' > /tmp/engine-packet.json
curl -i -X POST localhost:4100/verdict \
  -H 'Content-Type: application/json' -d @/tmp/engine-packet.json   # Verdict + X-Case-Id header
```

Run with `COURT_MOCK=1` to try it without calling a model.

**Precedent.** `/convene` and `/verdict` both pass the whole case log (`COURT_CASES_DIR`) to `holdTrial` as `past`, so the court learns from its own earlier rulings. A trial's precedent IDs are in `trial.precedents`. Recent trials from the *same* worker are skipped (see `src/precedent.ts`), so a worker's first trial and its retrial two minutes later won't cite each other. A trial from another worker will.

## Calling the court from the engine (Python)

The engine has its own client, `HttpCourt` in `engine/courtroom_engine/court.py`. `clients/python/court_client.py` is a standalone, standard-library-only client for any other Python caller.

```python
from court_client import convene

verdict = convene(packet, url="http://localhost:4100", timeout=60)
# {"ruling": "change_strategy", "instruction": "...", "reasoning": "...",
#  "cited_events": [14, 16, 18], "caseId": "case-b3b5fd0e"}
```

- `packet` is the `EvidencePacket` from `shared/schema.ts`, either as a plain dict or built from `courtroom_engine.schema` dataclasses. Anything with `.to_json()` is converted, including nested values.
- **It never raises.** If the court is down, times out, returns a non-200, or sends back an invalid verdict, you get `{"ruling": "escalate", "reasoning": "Court unreachable: <why>", "cited_events": [], "caseId": None}`. A worker never hangs on a dead court.
- Tests: `cd clients/python && python3 -m unittest`. To also run the live test, start `COURT_MOCK=1 npm run serve` and set `COURT_URL=http://localhost:4100`.
