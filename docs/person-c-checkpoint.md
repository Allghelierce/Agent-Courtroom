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

- Chris completed the mock-demo browser walkthrough: live connection, case list,
  trial replay, comparison table, and restart recovery. Before/after screenshots
  retained 14 workers, 308 steps, and 10 trials with no visible duplicates.
  This verifies that tested version; the latest merged UI changes have not been
  rechecked in the browser. The production build remains unverified here.
- Real Groq/Claude calls and paid court behavior have not been exercised in this checkpoint.
- Recovery and independent diff/test review are now agreed in
  [decisions.md](decisions.md). Scripted completion is integration
  evidence, not measured model quality or real cost savings. Court permission to
  override the task's restrictions is part of the comparison.
- Record the final demo after the browser walkthrough. No backup video exists yet.

## Your next three steps

1. Configure the real provider credential locally, then run the comparison in
   [benchmark-review.md](benchmark-review.md).
2. Together, inspect each arm's saved source, diff, fresh tests, and cost records.
   Assign recovered/blocked/failed only after review.
3. Record the working demo and publish the final checkpoint from `Chris`.

## Evidence-capture checkpoint

33 Python tests pass, including saved outputs for both arms, a fresh test rerun,
and immediate stopping on human escalation. A coding pair against the HTTP mock
court exported `REVIEW.md`, frozen seeds/prompts/decisions, source snapshots,
diffs, tests, events, and cost summaries. Real API calls are pending credentials;
no real-model result is claimed by this rehearsal.
