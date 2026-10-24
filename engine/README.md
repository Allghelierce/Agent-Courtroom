# Engine (Person A)

The worker, the monitors, the seed repo, and the event stream. Python 3.12, standard library plus the `anthropic` SDK.

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

# Same task with and without the court, side by side (writes runs/comparison.json)
.venv/bin/python -m courtroom_engine compare

# API + SSE stream for the dashboard on http://127.0.0.1:8787, with one worker started
.venv/bin/python -m courtroom_engine serve --workers 1
```

Useful options (all commands):

| Option | Default | Meaning |
|---|---|---|
| `--brain` | `scripted` | `scripted` replays a realistic run with simulated costs and no API key. `claude` is the real agent (needs `ANTHROPIC_API_KEY`). |
| `--court` | `stub` | `stub` always rules `change_strategy`. `none` runs without a court. A URL sends the evidence packet to Person B's court. |
| `--model` | `claude-opus-5-5` | Worker model, also used to price scripted steps. |
| `--budget` | `2.0` | USD per worker. |
| `--max-steps` | `60` | |
| `--all-monitors` | off | Adds the overspending and flailing monitors to looping and stalling. |
| `--step-delay` | `1` for serve, `0` otherwise | Seconds per scripted step, so the dashboard has something to watch. |
| `--record` | `runs/<time>.jsonl` | Where to save every stream message. |

## How it fits together

- `seed_repos/checkout/`: the task. Five real bugs plus `test_checkout_charges_the_gateway`, which calls a payments gateway the sandbox can't reach. The worker's rules forbid editing tests or faking the gateway, so it goes in circles until the court tells it otherwise.
- `worker.py`: one tool call per step on a temp copy of the seed repo. Each step publishes an `Event`. After each step the monitors run. If one fires, a `Charge` is published, the worker goes `on_trial`, and `convene(packet)` returns a `Verdict`:
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
- No engine running? `shared/samples/looping_run.jsonl` (one worker) and `shared/samples/comparison_run.jsonl` (with vs. without court) are recorded streams, one `StreamMessage` per line, with real timestamps you can replay.
