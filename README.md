# C0mpiled: Agent Courtroom

> Agents don't need a babysitter. They need a judicial system.

An AI agent (the **worker**) works on a long task with no one watching: fixing a broken repo, or collecting prices from store pages. Cheap code checks watch every step for looping, stalling, overspending, and flailing. When one fires, a court convenes: a **Prosecutor** and a **Defense** argue from the logs, and a **Judge** rules **continue**, **change strategy**, **escalate to a human**, or **halt**. Every trial is saved so a human can see later what happened and why.

## What's in the repo

| Folder | What it is | Owner |
|---|---|---|
| `court/` | The courtroom: evidence packet, Prosecutor/Defense/Judge, precedent, HTTP server on port 4100. See [court/INTEGRATION.md](court/INTEGRATION.md). | Person B |
| `ui/` | Next.js dashboard, pixel-art courtroom scene, and case log on port 3000. | Person B |
| `engine/`, `seed_repos/`, `shared/` | Worker loop, monitors, the two tasks (broken checkout repo with a trap test, price collector with a store that's down), live-update server on port 8787, shared types. | Person A |
| `scripts/`, `docs/` | One-command demo, smoke test, paired with/without-court benchmark, cost tracking, decisions. | Person C |

Who does what: [WORK_SPLIT.md](WORK_SPLIT.md).

## Run it

```sh
# 1. Court (mock mode: no API key needed, no cost)
cd court && npm install && COURT_MOCK=1 npm run serve

# 2. Website: http://localhost:3000 (replays a bundled demo run if the engine isn't running)
cd ui && npm install && npm run dev

# 3. Engine: one worker, using the court
cd engine && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m courtroom_engine serve --workers 1 --court http://localhost:4100/verdict
```

Real models: drop `COURT_MOCK=1` and set `ANTHROPIC_API_KEY` or `GROQ_API_KEY` (the court picks Anthropic first, then Groq); run the engine with `--brain groq` or `--brain claude`. Court tests: `cd court && npm test`. Or start everything at once with the demo launcher below.

# C0mpiled

Agent Courtroom: Python workers and monitors, a TypeScript court, and a Next.js dashboard.

## Run the integrated demo

Requires Python 3.12+ and Node.js 24+ on PATH. From the repository root:

```sh
npm ci --prefix court
npm ci --prefix ui
python3.12 scripts/demo.py
```

Open http://localhost:3000. The launcher starts the court on 4100, the engine on
8787, and three scripted workers across the checkout and price tasks. It uses
mock court responses and needs no API keys. Ctrl-C stops the services it started.
Keep those three ports free before launching.

Worker events, trial transcripts, and comparison results persist in SQLite at
`runs/demo/events.sqlite`. Restart with the same database to retain history;
interrupted workers are marked failed, not automatically resumed. Logs and court
case files are under `runs/demo/`. These generated files are ignored by Git.

For a fresh demo without deleting the old run:

```sh
python3.12 scripts/demo.py --db runs/fresh-demo.sqlite
```

Use `--no-ui` to run just the backend. The dashboard uses
`NEXT_PUBLIC_ENGINE_URL=http://127.0.0.1:8787` by default. Its data-source label
distinguishes the engine stream from offline demo fixtures.

## Verify Person C's integration

```sh
python3.12 scripts/smoke.py
cd engine
python3.12 -m unittest discover -s tests -v
cd ../court
npm test
npm run typecheck
cd ../ui
npx next typegen
npx tsc --noEmit
npm run build
```

The smoke test starts temporary local services, runs three concurrent workers,
checks verdict-to-case links and SSE replay, restarts the engine, then exports
paired coding and price benchmarks. Evidence is saved under `runs/smoke/`.
See [the checkpoint report](docs/person-c-checkpoint.md) for tested scope and limitations.

## Run a paired benchmark

With the demo's court running, use a second terminal at the repository root:

```sh
python3.12 scripts/benchmark.py --repetitions 3
```

Each task runs with and without court, with the same worker configuration.
Results include raw runs, SQLite/JSONL events, and JSON/CSV summaries under
`runs/benchmarks/`. Costs include both worker and court usage. Scripted costs are
simulated; engine completion is not independently verified success.

Real workers require `pip install -r engine/requirements.txt` in a virtual
environment and the selected provider's key: `GROQ_API_KEY` or
`ANTHROPIC_API_KEY`. Select `--brain groq` or `--brain claude`; `--model` is
optional. The benchmark also requires your `--success-criteria` text from
[decisions.md](docs/decisions.md). This records the rule; it does not
automatically verify it. To use a real court, run it separately with
`COURT_MOCK` unset and `ANTHROPIC_API_KEY` or `GROQ_API_KEY` available. The demo launcher always
uses a mock court.

Live worker tools execute locally in a temporary copy of the task. This is not
an OS security sandbox. Run trusted tasks only. Groq costs are list-price
estimates before cache discounts or free-tier credits, using the
[provider's published rates](https://console.groq.com/docs/models).

## Branch workflow

- Everyone works on their own branch (`Tristan`, `Amelia`, ...). Commit and push often.
- Never commit directly to `main`. Merge through a PR.

## Judging

The top 5 projects will be picked to demo. Projects are judged in 3 areas:

- **Scalability:** cheap code checks, plus a court only when needed, so one court can oversee many workers.
- **Innovation:** an adversarial trial instead of a single "are you stuck?" check.
- **Real-world impact:** runaway agents waste real money. We show cost with vs. without the court.
