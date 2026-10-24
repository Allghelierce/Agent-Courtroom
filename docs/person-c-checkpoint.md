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
- One real Groq coding pair and real Groq court have now run. Both arms passed
  11/11 tests, including fresh test reruns. Independent recovery judgments remain
  pending. See the [results and review evidence](benchmarks/2026-10-24-groq/README.md).
  Claude execution remains unverified.
- Recovery and independent diff/test review are now agreed in
  [decisions.md](decisions.md). Scripted completion is integration
  evidence, not measured model quality or real cost savings. Court permission to
  override the task's restrictions is part of the comparison.
- Record the final demo after the browser walkthrough. No backup video exists yet.

## Your next three steps

1. Open the [first real comparison](benchmarks/2026-10-24-groq/README.md).
2. Together, inspect each arm's saved source, diff, fresh tests, and cost records.
   Assign recovered/blocked/failed only after review.
3. Record the working demo and publish the final checkpoint from `Chris`.

## Evidence-capture checkpoint

33 Python tests pass, including saved outputs for both arms, a fresh test rerun,
and immediate stopping on human escalation. A coding pair against the HTTP mock
court exported `REVIEW.md`, frozen seeds/prompts/decisions, source snapshots,
diffs, tests, events, and cost summaries. That rehearsal was simulated; the later
real Groq pair is documented separately above and awaits joint outcome review.
