# Engine (Person A)

The worker, the monitors, the seed repos, and the event stream. Python 3.12, standard library plus the `anthropic` and `groq` SDKs.

## Setup

```sh
cd engine
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Run it

```sh
# One worker, scripted brain, stub court: loops on the trap, gets charged, recovers to 11/11
.venv/bin/python -m courtroom_engine run

# Same, with the price-collector worker: gets stuck retrying a store that's down, recovers to 6/6
.venv/bin/python -m courtroom_engine run --task prices

# Same task with and without the court, side by side (writes runs/comparison.json)
.venv/bin/python -m courtroom_engine compare

# API + SSE stream for the dashboard on http://127.0.0.1:8787, with one worker started
.venv/bin/python -m courtroom_engine serve --workers 1
```

Useful options (all commands):

| Option | Default | Meaning |
|---|---|---|
| `--task` | `coding` | Which kind of worker: `coding` or `prices` (see below). Over HTTP, `POST /runs` takes `{"task": "prices"}`. |
| `--brain` | `scripted` | `scripted` replays a realistic run with simulated costs and no API key. `groq` is a real agent on Groq (needs `GROQ_API_KEY`). `claude` is a real agent on Claude (needs `ANTHROPIC_API_KEY`). |
| `--court` | `stub` | `stub` always rules `change_strategy`. `none` runs without a court. A URL sends the evidence packet to Person B's court. |
| `--model` | `openai/gpt-oss-120b` on groq, `claude-opus-5-5` otherwise | Worker model, also used to price scripted steps. Prices live in `PRICING` in `brains.py`. |
| `--budget` | `2.0` | USD per worker. |
| `--max-steps` | `60` | |
| `--all-monitors` | off | Adds the overspending and flailing monitors to looping and stalling. |
| `--step-delay` | `1` for serve, `0` otherwise | Seconds per scripted step, so the dashboard has something to watch. |
| `--seed` | the task's own | Point a task at different seed data. |
| `--record` | `runs/<time>.jsonl` | Where to save every stream message. |

## Running a real agent on Groq

Get a free key at https://console.groq.com, then:

```sh
export GROQ_API_KEY=...
.venv/bin/python -m courtroom_engine run --brain groq --task prices
.venv/bin/python -m courtroom_engine compare --brain groq
```

Costs are computed from Groq's listed prices for `openai/gpt-oss-120b` ($0.15 in / $0.60 out per million tokens), so they are much smaller than the scripted run's simulated Claude costs. The free tier is rate-limited; the SDK backs off and retries. If the model writes a tool call Groq can't parse, the step is logged as `invalid_tool_call` with an error instead of crashing the run.

## Worker types

Each lives in `courtroom_engine/tasks/` and supplies its environment, Claude prompt and tools, a scripted run, and the stub court's advice. The worker loop, monitors, and court don't know which task they're watching. Progress always goes in `testsPassing` / `testsTotal`.

| Task | What the worker does | Progress | The trap |
|---|---|---|---|
| `coding` (`seed_repos/checkout/`) | Fixes a failing test suite with `list_files`, `read_file`, `edit_file`, `run_tests` | tests passing / 11 | `test_checkout_charges_the_gateway` calls a payments gateway the sandbox can't reach. The worker may not edit tests or fake the gateway, so it tweaks `payments.py` in circles. |
| `prices` (`seed_repos/price_watch/`) | Collects today's price for 6 products from mock store pages with `list_products`, `fetch_page`, `save_price`, `flag_product` | products resolved / 6, scored against a hidden answer key | `shop-c.example` returns 503 on every request. The worker is told every product needs a price and errors are temporary, so it keeps retrying. |

Both pages and tests are local files: nothing goes over the network. Adding a third worker type means writing one more file in `tasks/` and registering it in `tasks/__init__.py`.

## How it fits together

- `worker.py`: one tool call per step against the task's environment (for `coding`, a temp copy of the seed repo). Each step publishes an `Event`. After each step the monitors run. If one fires, a `Charge` is published, the worker goes `on_trial`, and `convene(packet)` returns a `Verdict`:
  - `continue`: carry on.
  - `change_strategy`: the instruction goes into the worker's next prompt as a `COURT ORDER`.
  - `escalate`: the worker waits (up to 10 minutes) for `POST /workers/<id>/resolve`.
  - `halt`: the run ends.
- `monitors.py`: plain functions, no LLM calls. They see only events since the last charge, so a ruling gives the worker a clean slate. Looping counts repeats of the same tool, args, and result: rerunning tests is normal, rerunning them and getting the same failure is not.
- `court.py`: builds the `EvidencePacket` and calls the court. `HttpCourt` POSTs the packet as JSON and expects a `Verdict` back; if the court is down or returns something invalid, the worker escalates to a human.
- `server.py`: the HTTP API (endpoint list at the top of the file).

## For the court and UI (Person B)

- The types are in `shared/schema.ts`.
- Your court: expose `POST <url>` that takes an `EvidencePacket` and returns a `Verdict`, then run the engine with `--court <url>`.
- Your UI: `new EventSource("http://127.0.0.1:8787/stream")`. Each message is a `StreamMessage`, and history is replayed on connect.
- No engine running? `shared/samples/looping_run.jsonl` (one coding worker), `shared/samples/prices_run.jsonl` (one price worker), and `shared/samples/comparison_run.jsonl` (with vs. without court) are recorded streams, one `StreamMessage` per line, with real timestamps you can replay.
