# Work Split: Agent Courtroom

How the Agent Courtroom build is divided between three people. The full project plan lives in `CLAUDE.md` on the `Tristan` branch.

**Recap:** a worker agent tries to fix a failing repo. Cheap code monitors watch every step for looping, overspending, stalling, and flailing. When one fires, a court (Prosecutor, Defense, Judge) argues from the logs and rules: continue, change strategy, escalate to a human, or halt.

The split follows the data. **Person A produces events. Person B judges them and shows them. Person C carries them between A and B, scales the system up, and proves it works.**

---

## Person A: Engine (worker, monitors, seed repo)

### Owns
1. **Seed repo.** A small project with a failing test suite, including the **trap test**: one test that depends on an unreachable API (or is impossible as written), so the worker loops on it.
2. **Worker runner.** A tool loop (read file, edit file, run tests) on a sandboxed copy of the seed repo. Every step appends one **Event** to the shared log.
3. **Monitors.** Plain functions with no LLM calls. They read the event log after every step and return either nothing or a **Charge**:
   - **Looping (MVP):** the same (tool, args) hash appears 3+ times in the last 10 steps.
   - **Stalling (MVP):** the passing-test count hasn't gone up in N steps.
   - **Overspending (stretch):** cost per newly passing test is above a threshold, or the run is over X% of budget.
   - **Flailing (stretch):** K errors in a row, or the same error message repeated.
4. **Control hooks.** Pause the worker when a charge is filed, call `convene(packet)`, then act on the verdict:
   - `continue`: resume.
   - `change_strategy`: inject `instruction` into the worker's next prompt.
   - `escalate`: wait for a human.
   - `halt`: end the run and write a summary.
5. **Event publishing.** Send every event, charge, and verdict to Person C's event server.
6. **Run toggle.** A flag that runs the worker with the courtroom turned off, which Person C's benchmark harness uses.

### Can work alone by
Using Person C's stub `convene()`, which always returns a fixed `change_strategy` verdict.

### Done when
The worker loops on the trap test, the looping monitor fires, the worker pauses, the injected instruction is applied, and the worker gets the rest of the suite passing.

---

## Person B: Court and UI

### Owns
1. **Evidence packet builder.** Turns a Charge into a packet: the charge, the last N events, the test progress curve, and spend vs. budget.
2. **Courtroom.** `convene(packet) → Verdict`:
   - **Prosecutor** (cheap model): argues the worker is stuck or wasting money. Must cite event IDs.
   - **Defense** (cheap model): argues the worker is making real progress. Must cite event IDs.
   - **Judge** (stronger model): returns the structured Verdict JSON below.
   - Arguments use only logs and metrics, never the worker's own story.
3. **Dashboard.** A live grid of workers showing status, tests passing, a cost meter, and warning lights for each monitor.
4. **Courtroom scene.** A pixel-art courtroom that plays the trial transcript as dialogue and ends on the verdict. Start from the mockup at https://claude.ai/artifact/YbpiWve6SgVTkYuexMZMpV and switch it from the price watcher to the coding worker.
5. **Case log page.** Every trial (charge, arguments, verdict, cited events) listed for human audit.
6. **Comparison view.** Shows Person C's with/without numbers side by side.

### Can work alone by
Building against Person C's fake event log, which replays a scripted looping run.

### Done when
A real charge produces a full trial with a valid Verdict, and the dashboard and courtroom scene play it live.

---

## Person C: Platform, scale, and demo

### Owns
1. **Shared contracts.** Owns `shared/schema.ts` (Event, Charge, Verdict) and keeps it versioned as A and B change things.
2. **Mock data (day one, first hour).** A fake event log that replays a scripted looping run, for B, and a stub `convene()` that returns a fixed `change_strategy` verdict, for A.
3. **Event server.** Receives events, charges, and verdicts from A's workers and streams them to B's dashboard over SSE. Stores events, cases, and verdicts so the case log survives a refresh or restart.
4. **Multi-worker orchestration (scalability).** Runs 3–5 workers at once, each on its own sandboxed repo copy, with one courtroom serving all of them.
5. **More seed repos.** Extra repos with different traps (impossible test, flaky test, missing dependency) so the parallel demo isn't five copies of the same failure.
6. **Benchmark harness (real-world impact).** Runs the same tasks with and without the courtroom, using A's run toggle. Records total cost, time to completion, and success rate, and hands the numbers to B's comparison view.
7. **Cost accounting.** Keeps per-model token prices accurate and tracks the court's own spend, to show that oversight costs only a small fraction of what it saves.
8. **Demo and pitch.** A demo script that reliably hits the trap, a backup recording of the full flow, slides, the README, and deployment if we want a live URL for judges.

### Can work alone by
Starting with the schema, mocks, and event server, none of which depend on A or B.

### Done when
Several workers stream through the event server into the dashboard, the benchmark produces with/without numbers, and the backup demo video is recorded.

---

## Shared contracts (agree on these first)

Person C puts these in `shared/schema.ts` before anyone starts building.

```ts
type Event = {
  id: number;
  workerId: string;
  step: number;
  tool: "read_file" | "edit_file" | "run_tests" | string;
  args: Record<string, unknown>;
  tokens: number;
  costUsd: number;
  testsPassing: number;
  testsTotal: number;
  error?: string;
  timestamp: string;
};

type Charge = {
  workerId: string;
  kind: "looping" | "overspending" | "stalling" | "flailing";
  summary: string;
  eventIds: number[];
};

type Verdict = {
  ruling: "continue" | "change_strategy" | "escalate" | "halt";
  instruction?: string;
  reasoning: string;
  cited_events: number[];
};
```

**Interfaces between A, B, and C:**
- `convene(packet) → Verdict`: B implements it, A calls it. C provides the stub until B's version is ready.
- The event stream: A publishes to C's event server, and B's UI subscribes to it.
- Benchmark results: C produces them, and B's comparison view displays them.

---

## Decide together first (about 30 minutes)

1. **Stack:** proposed Next.js dashboard, with a Node or Python service for the worker and court streaming over SSE.
2. **Worker:** our own minimal tool loop (easier pausing and logging) or the Claude Agent SDK.
3. **Schemas:** finalize the types above.

## Integration checkpoints

0. **Hour one:** C ships the schema, mocks, and a bare event server.
1. **First:** A's real events flow through C's server and replace B's fake log.
2. **Second:** B's real `convene()` replaces the stub, and the full loop runs on the trap repo.
3. **Third:** C runs several workers in parallel and produces the benchmark numbers.
4. **Last:** demo script, backup recording, and polish.

## Stretch (after MVP works)

| Person A | Person B | Person C |
|---|---|---|
| Overspending and flailing monitors | Human-escalation button in the UI | Scale past 5 workers |
| A second worker type | Appeals (the worker contests a ruling once) | Live deployment for judges |
| | "Precedent": past verdicts fed to the Judge | Store precedent for the Judge |
