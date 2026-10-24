# Plugging into the court

For Person A (engine) and Person C (event server and demo). The court is a small HTTP service: send it a charge with evidence, and it holds a trial and returns a verdict. Details are in [README.md](README.md). Types are in `src/types.ts`, which mirrors `shared/schema.ts`.

## 1. Start the court

```bash
cd court && npm install
COURT_MOCK=1 npm run serve     # mock court: deterministic, no model calls, free
npm run serve                  # real court: needs ANTHROPIC_API_KEY
```

| Env var | Default | What it does |
|---|---|---|
| `COURT_PORT` | `4100` | Port to listen on. |
| `ANTHROPIC_API_KEY` | none | Without it, the court runs the mock. |
| `COURT_MOCK` | unset | `1` forces the mock even when a key is set. |
| `COURT_LAWYER_MODEL` | `claude-haiku-5-5` | Model for the Prosecutor and Defense. |
| `COURT_JUDGE_MODEL` | `claude-opus-5-5` | Model for the Judge. |

`GET /health` returns `{"ok":true}`. CORS is open. Every trial is saved to `court/cases/<id>.json`. `trial.mock` says whether the mock or the real models ran.

## 2. Engine → court: `POST /verdict`

Send the engine's `EvidencePacket` from `shared/schema.ts`:

```json
{ "charge": {...}, "events": [...], "testProgress": [{"step": 1, "testsPassing": 3, "testsTotal": 12}],
  "spend": {"costUsd": 0.31, "budgetUsd": 1.0}, "task": "Make the failing test suite pass" }
```

The response body is a bare `Verdict`. The saved trial's ID comes back in the `X-Case-Id` header. A missing or mistyped field returns `400 {"error": "..."}`.

**From Python,** copy `clients/python/court_client.py` into the engine. It uses only the standard library.

```python
from court_client import convene
verdict = convene(packet, url="http://localhost:4100", timeout=60)  # dict, or dataclasses with .to_json()
verdict["ruling"], verdict.get("instruction"), verdict["caseId"]
```

**`convene()` never raises.** If the court is down, times out, returns a non-200, or sends back an invalid verdict (including `change_strategy` with no instruction), it returns `escalate` with `reasoning: "Court unreachable: <why>"` and `caseId: None`. A worker never hangs on a dead court, and a broken court never lets a stuck worker keep spending.

## 3. What each ruling means for the engine

| `ruling` | Engine does |
|---|---|
| `continue` | Resume the worker unchanged. The charge was a false alarm. |
| `change_strategy` | Resume, and add `instruction` to the worker's **next** prompt, e.g. `Court ruling: <instruction>`. `instruction` is always present for this ruling. |
| `escalate` | Pause and set the worker's state to `awaiting_human`. Resume when a human posts a Verdict to `POST /workers/:workerId/resolve` (Person C's server). |
| `halt` | Stop the run, set the state to `halted`, and use `reasoning` as the summary. |

While the court deliberates, the worker's state is `on_trial`. With the real models, a trial takes several seconds, so keep `timeout` at 60.

## 4. UI → court

| Route | Body / result |
|---|---|
| `POST /convene` | Body `{charge, events, budgetUsd}` (the shape of the files in `fixtures/`). Returns the full `Trial`. Good for demos and testing without an engine. |
| `GET /cases` | Every `Trial`, oldest first. Feeds the case history page. |
| `GET /cases/:id` | One `Trial`, or 404. Feeds the courtroom scene. |

`Trial` (see `examples/sample-trial.json`):

```ts
{ id, workerId, charge,
  prosecution: { side, model, argument, cited_events, costUsd },
  defense:     { side, model, argument, cited_events, costUsd },
  verdict, judgeModel, costUsd, startedAt, finishedAt, mock,
  precedents?: string[] }   // ids of earlier trials shown to the Judge
```

## 5. Person C: getting trials into the event stream

- After `POST /verdict` returns, the engine (or your server) publishes the existing stream message: `{ type: "verdict", data: { workerId, chargeId, verdict } }`.
- The full trial (both arguments, models, and cost) is at `GET /cases/<X-Case-Id>`. The Python client returns it as `verdict["caseId"]`.
- Suggestion: add an optional `caseId` to the `verdict` stream message, so the UI can open the courtroom scene without matching on `chargeId`.
- `trial.costUsd` is the court's own spend. Use it for the "the court is cheap" number in the comparison.

## 6. Known gaps

- **The real-model path is untested end to end** without an API key. The tests cover it with a fake client, and `npm run eval` (`scripts/eval.ts`) runs the real court on every fixture once a key is set.
- **`Charge.id` is optional here** but required in `shared/schema.ts`. Send it anyway, because the `verdict` stream message needs `chargeId`.
- **`court/src/types.ts` mirrors `shared/schema.ts`** until that file lands on the `Tristan` branch. Then the court will import it directly.
- **Precedent:** `holdTrial(packet, { past })` shows the Judge similar earlier trials. The committed HTTP routes don't pass `past` yet, so trials over HTTP get no precedent until the server is updated.
