# Person C integration checkpoint — 2026-10-24

## Delivered and verified

- Python/SQLite event persistence, unique IDs, and interrupted-worker recovery.
- SSE replay from `Last-Event-ID`, including reconnect without missing events.
- Real HTTP integration with the TypeScript court in mock mode; verdicts link to saved transcripts.
- Three concurrent workers across two tasks, with separate histories and IDs.
- Paired benchmark exports with worker/court totals, raw usage, and explicit simulated/incomplete labels.
- Groq benchmark selection and shared pricing for the team's default Groq models.
- One-command demo launcher and repeatable backend smoke test.

Validation: **22 Python tests, 65 court tests, court TypeScript, dashboard route
generation, and dashboard TypeScript passed.** `python3.12 scripts/smoke.py`
passed all five integration checks, including process restart and both benchmark
tasks. It writes logs, database, raw benchmark runs, summaries, and `report.json`
under a unique `runs/smoke/` directory.

## Still to verify

- Dashboard production build and browser walkthrough. In this agent environment,
  Turbopack fails while processing CSS because its worker cannot bind a local port
  (`Operation not permitted`). TypeScript passes; this does not establish browser behavior.
  Try `cd ui && npm run build` in your terminal and record any remaining error.
- Real Groq/Claude calls and paid court behavior have not been exercised in this checkpoint.
- Recovery is the chosen success criterion; the independent verification method
  remains to be decided in [decisions.md](decisions.md). Scripted completion is integration
  evidence, not measured model quality or real cost savings. Court permission to
  override the task's restrictions is part of the comparison.
- Record the final demo after the browser walkthrough. No backup video exists yet.

## Your next three steps

1. Finish section 1 of `docs/decisions.md`: choose the independent verification
   method for the selected recovery rule. This is evaluation design.
2. Run `python3.12 scripts/smoke.py`. Inspect its `report.json` and one raw
   court-on/off pair. Reconcile worker plus court cost yourself. This is reliability
   testing and data validation.
3. Run `python3.12 scripts/demo.py`, inspect a trial in the dashboard, and record
   the working flow. Report the UI build error if it also happens in your terminal.
