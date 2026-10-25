# C0mpiled: Agent Courtroom

> Agents don't need a babysitter. They need a judicial system.

An AI agent (the **worker**) works on a long task with no one watching: fixing a broken repo, or collecting prices from store pages. Cheap code checks watch every step for looping, stalling, overspending, and flailing. When one fires, a court convenes: a **Prosecutor** and a **Defense** argue from the logs, and a **Judge** rules **continue**, **change strategy**, **escalate to a human**, or **halt**. Every trial is saved so a human can see later what happened and why.

## What's in the repo

| Folder | What it is | Owner |
|---|---|---|
| `court/` | The courtroom: evidence packet, Prosecutor/Defense/Judge, precedent, HTTP server on port 4100. See [court/INTEGRATION.md](court/INTEGRATION.md). | Person B |
| `ui/` | Next.js dashboard, pixel-art courtroom scene, and case log on port 3000. See [ui/README.md](ui/README.md). | Person B |
| `engine/`, `seed_repos/`, `shared/` | Worker loop, monitors, the two tasks (broken checkout repo with a trap test, price collector with a store that's down), live-update server on port 8787, shared types. | Person A |
| `scripts/`, `docs/` | One-command demo, smoke test, paired with/without-court benchmark, cost tracking, decisions. | Person C |

Who does what: [WORK_SPLIT.md](WORK_SPLIT.md).

## Run it

Requires **Node.js 24+** and **Python 3.12+**. Keep ports 3000, 4100 and 8787 free.

### Just the website (no setup beyond npm)

```sh
cd ui && npm install && npm run dev
```

Open http://localhost:3000. With no engine running, the dashboard replays a bundled demo run in the browser (play, pause, 1x/2x/4x), and the courtroom uses bundled mock trials.

### The full demo (one command)

From the repository root:

```sh
npm ci --prefix court
npm ci --prefix ui
python3.12 scripts/demo.py
```

Open http://localhost:3000. The launcher starts the court on 4100 (mock mode, no API keys), the engine on 8787, three scripted workers across the checkout and price tasks, and the website. Ctrl-C stops everything it started.

- Events, trials, and comparison results are saved in SQLite at `runs/demo/events.sqlite`, and logs and court case files are under `runs/demo/` (ignored by Git). Restarting with the same database keeps the history. Interrupted workers are marked failed, not resumed.
- For a fresh run that keeps the old one: `python3.12 scripts/demo.py --db runs/fresh-demo.sqlite`.
- `--no-ui` runs just the backend.

### Each piece by hand

```sh
# Court (mock mode: no API key needed, no cost)
cd court && npm install && COURT_MOCK=1 npm run serve

# Engine: one worker, using the court
cd engine && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m courtroom_engine serve --workers 1 --court http://localhost:4100/verdict

# Website
cd ui && npm install && npm run dev
```

The website finds the engine at `NEXT_PUBLIC_ENGINE_URL` (default `http://localhost:8787`) and the court at `NEXT_PUBLIC_COURT_URL` (default `http://localhost:4100`). Its data-source label shows whether it's on the live engine stream or the offline demo.

### Real models

- **Court:** drop `COURT_MOCK=1` and set `ANTHROPIC_API_KEY` or `GROQ_API_KEY`. The court picks Anthropic first, then Groq. The demo launcher always uses a mock court, so run the court separately for real rulings.
- **Workers:** run the engine with `--brain groq` or `--brain claude` and that provider's key (`--model` is optional).

Live worker tools run locally in a temporary copy of the task. This is not an OS security sandbox, so run trusted tasks only. Groq costs are list-price estimates before cache discounts or free-tier credits, using the [provider's published rates](https://console.groq.com/docs/models).

## Benchmark: with vs. without the court

With the court running, from the repository root in a second terminal:

```sh
python3.12 scripts/benchmark.py --repetitions 3
```

Each task runs with and without the court, using the same worker configuration. Results go to `runs/benchmarks/`: raw runs, SQLite/JSONL events, and JSON/CSV summaries. Costs include both worker and court usage.

- Scripted costs are simulated, and "completed" is the engine's own report, not independently verified success.
- With real workers, the benchmark also needs your `--success-criteria` text from [docs/decisions.md](docs/decisions.md). It records the rule but doesn't verify it automatically.

## Stripe sandbox integration

To test a functioning payment API, follow [the Stripe sandbox guide](docs/stripe-sandbox.md).
It uses test credentials, checks successful and declined payments, verifies the
payment with Stripe, and tests connection-failure handling. It is separate from
the worker benchmark and does not move money.

## Tests

```sh
python3.12 scripts/smoke.py                                   # end-to-end smoke test
cd engine && python3.12 -m unittest discover -s tests -v      # engine
cd court && npm test && npm run typecheck                     # court
cd ui && npx next typegen && npx tsc --noEmit && npm run build   # website
```

The smoke test starts temporary local services, runs three workers at once, checks verdict-to-case links and SSE replay, restarts the engine, then exports paired coding and price benchmarks. Evidence is saved under `runs/smoke/`. See [the Person C checkpoint report](docs/person-c-checkpoint.md) for tested scope and limitations.

## Branch workflow

- Everyone works on their own branch (`Tristan`, `Amelia`, ...). Commit and push often.
- Never commit directly to `main`. Merge through a PR.
