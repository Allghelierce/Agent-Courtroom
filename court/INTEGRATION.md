# Plugging into the court

For Person A (engine) and Person C (event server and demo). The court is a small HTTP service: send it a charge with evidence, and it holds a trial and returns a verdict. Details are in [README.md](README.md). Shared types are in `shared/schema.ts`. The court's copy is `src/types.ts`.

## 1. Start the court

```bash
cd court && npm install
COURT_MOCK=1 npm run serve     # mock court: deterministic, no model calls, free
npm run serve                  # real court: Anthropic if its key is set, else Groq, else mock
```

**Provider:** the court uses Anthropic when `ANTHROPIC_API_KEY` is set, otherwise Groq when `GROQ_API_KEY` is set, otherwise the mock. `trial.mock` says whether a model ran, and `trial.judgeModel` says which one.

| Provider | Lawyers (Prosecutor, Defense) | Judge |
|---|---|---|
| Anthropic | `claude-haiku-5-5` | `claude-opus-5-5` |
| Groq | `openai/gpt-oss-20b` | `openai/gpt-oss-120b` |

| Env var | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Use Anthropic models. |
| `GROQ_API_KEY` | none | Use Groq models when there is no Anthropic key. |
| `COURT_PROVIDER` | auto | `anthropic` or `groq` forces one provider. |
| `COURT_MOCK` | unset | `1` forces the mock even when a key is set. |
| `COURT_LAWYER_MODEL` / `COURT_JUDGE_MODEL` | per provider (above) | Override the models. |
| `COURT_DEADLINE_MS` | `50000` | Time limit for a whole trial. The engine's `HttpCourt` gives up at 60s, so keep this below that. |
| `COURT_PORT` | `4100` | Port to listen on. |
| `COURT_HOST` | `127.0.0.1` | Interface to bind. Set `0.0.0.0` to accept connections from other machines. |
| `COURT_CASES_DIR` | `court/cases/` | Where trials are saved, and where precedent is read from. |

`GET /health` returns `{"ok":true}`. CORS is open. Every trial is saved to `<COURT_CASES_DIR>/<id>.json`.

## 2. Engine → court: `POST /verdict`

Run the engine with `--court http://localhost:4100/verdict`. It POSTs its `EvidencePacket` from `shared/schema.ts`:

```json
{ "charge": {...}, "events": [...], "testProgress": [{"step": 1, "testsPassing": 3, "testsTotal": 12}],
  "spend": {"costUsd": 0.31, "budgetUsd": 1.0}, "task": "Make the failing test suite pass" }
```

The response body is a bare `Verdict`. Headers:
- `X-Case-Id`: the saved trial's ID.
- `X-Precedents`: comma-separated IDs of earlier trials shown to the Judge as precedent.

A missing or mistyped field returns `400 {"error": "..."}`.

**What the engine does with the response** (`engine/courtroom_engine/court.py`, `HttpCourt`):
- It checks that the verdict only cites events in the packet.
- It fetches `GET /cases/<X-Case-Id>`, checks the trial's ID, worker, `charge.id` and cost, and adds `trial.costUsd` to `WorkerStatus.courtCostUsd`.
- If there's no usable verdict (court down, timeout, bad response), it rules `escalate`. A worker never hangs on a dead court, and a broken court never lets a stuck worker keep spending.
- If the verdict is fine but the trial fetch fails, the verdict still applies, and the court cost is marked incomplete.

**Other Python callers** can use `clients/python/court_client.py`, a standard-library-only client with the same never-raises, escalate-on-failure behavior. It returns the verdict plus `caseId`.

## 3. What each ruling means for the engine

| `ruling` | Engine does |
|---|---|
| `continue` | Resume the worker unchanged. The charge was a false alarm. |
| `change_strategy` | Resume, and put `instruction` in the worker's next prompt as a `COURT ORDER`. `instruction` is always present for this ruling. |
| `escalate` | Set the state to `awaiting_human` and wait (up to 10 minutes) for a human Verdict at `POST /workers/:workerId/resolve`. |
| `halt` | Stop the run, set the state to `halted`, and use `reasoning` as the summary. |

While the court deliberates, the worker's state is `on_trial`. If a trial hits `COURT_DEADLINE_MS`, the unfinished steps fall back safely: a lawyer who runs out of time rests, and a Judge who can't rule gives `escalate`.

**Summary judgment (no trial).** For repeat offenders and over-budget workers, the court rules in plain code before calling any model (see "Summary judgment" in [README.md](README.md)). What the engine sees:
- **The verdict comes back as usual,** but it's always `escalate` or `halt`. It's `escalate` when a worker is charged again soon after a `change_strategy` ruling, or when the court's spend or trial count on that worker hits its limit. It's `halt` when the worker is charged again after that escalation. It returns almost instantly.
- **`X-Case-Id` still points to a saved trial at `/cases/<id>`,** with `costUsd: 0`, `summary` (`repeat_offender` or `court_budget`), and `priorCaseIds`. The engine's cost check accepts it, and `courtCostUsd` doesn't change.
- **Send `workerStartedAt`** (the worker's `WorkerStatus.startedAt`) in the packet. Worker IDs repeat across `run`/`compare` invocations, so the court only counts trials from the current run. Without `workerStartedAt`, it guesses the start from the oldest event in the packet, which can miss earlier trials in the same run. The engine doesn't send it yet, and it isn't in `shared/schema.ts`'s `EvidencePacket` yet. The court already accepts it.

**The court doesn't care what the task is.** The engine runs `coding` (fix a failing repo) and `prices` (collect product prices from mock store pages) workers. Either way, progress goes in `testsPassing` / `testsTotal`: tests passing for coding, products resolved for prices. The court reasons over those numbers, so a new task type needs no court changes.

## 4. UI → court

| Route | Body / result |
|---|---|
| `POST /convene` | Body `{charge, events, budgetUsd}` (the shape of the files in `fixtures/`). Returns the full `Trial`. Good for demos and testing without an engine. |
| `GET /cases` | Every `Trial`, oldest first. Feeds the case history page. |
| `GET /cases/:id` | One `Trial`, or 404. Feeds the courtroom scene. |

`Trial` (see `examples/sample-trial.json`):

```ts
{ id, workerId, charge,
  prosecution: { side, model, argument, cited_events, costUsd, costComplete? },
  defense:     { side, model, argument, cited_events, costUsd, costComplete? },
  verdict, judgeModel, costUsd, startedAt, finishedAt, mock,
  costComplete?,          // false if any model call had no price
  pricingDate?,           // when shared/model-prices.json was last verified
  precedents?: string[] } // ids of earlier trials shown to the Judge
```

## 5. Person C: trials in the event stream and costs

- After a verdict, the stream carries `{ type: "verdict", data: { workerId, chargeId, verdict, caseId? } }`. Use `caseId` to fetch the full trial at `GET /cases/<caseId>` for the courtroom scene.
- **Pricing** comes from `shared/model-prices.json` (USD per million tokens, Anthropic and Groq models). The court and the engine read the same file.
- `trial.costUsd` is the court's own spend. The engine adds it to `WorkerStatus.courtCostUsd`, so the comparison can show worker cost, court cost and total cost separately. If `costComplete` is `false`, a model had no listed price, so show the total as unknown rather than as a low number.

## 6. Known gaps

- **The real-model path is lightly tested.** The tests use fake Anthropic and Groq clients. `npm run eval` (`scripts/eval.ts`) runs the real court on every fixture once a key is set, showing a cost estimate first.
- **`Charge.id` is optional in the court's types** but required in `shared/schema.ts`, and the engine checks it when it fetches the trial. Always send it.
- **`court/src/types.ts` is still a hand-kept copy of `shared/schema.ts`.** The shared file is on this branch now, so switching the court to import it directly is a small follow-up.
