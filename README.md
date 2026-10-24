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
`COURT_MOCK` unset and `ANTHROPIC_API_KEY` available. The demo launcher always
uses a mock court.

Live worker tools execute locally in a temporary copy of the task. This is not
an OS security sandbox. Run trusted tasks only. Groq costs are list-price
estimates before cache discounts or free-tier credits, using the
[provider's published rates](https://console.groq.com/docs/models).

## Branch workflow

- Work on your own branch. Tristan's branch is `Tristan`.
- Commit and push often.
- Never commit directly to `main`.

## Judging

The top 5 projects will be picked to demo. Projects are judged in 3 areas:

- Scalability
- Innovation
- Real-world impact
