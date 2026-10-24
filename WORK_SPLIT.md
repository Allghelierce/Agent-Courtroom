# Work Split: Agent Courtroom

How the Agent Courtroom build is divided between two people. The full project plan lives in `CLAUDE.md` on the `Tristan` branch.

**Recap:** a worker agent tries to fix a failing repo. Cheap code monitors watch every step for looping, overspending, stalling, and flailing. When one fires, a court (Prosecutor, Defense, Judge) argues from the logs and rules: continue, change strategy, escalate to a human, or halt.

The split follows the data. **Person A produces events. Person B judges them and shows them.**

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
5. **With/without comparison.** Run the same task with and without the courtroom. Record total cost, time to completion, and tests passed.
6. **Event stream.** Expose events, charges, and verdicts to the UI (SSE or WebSocket).

### Can work alone by
Stubbing `convene()` to always return a fixed `change_strategy` verdict.

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
6. **Comparison view.** Shows Person A's with/without numbers side by side.

### Can work alone by
Building against a fake event log that replays a scripted looping run.

### Done when
A real charge produces a full trial with a valid Verdict, and the dashboard and courtroom scene play it live.

---

## Shared contracts (agree on these first)

Put these in one shared file (e.g. `shared/schema.ts`) before either person starts building.

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

**Interfaces between A and B:**
- `convene(packet) → Verdict`: B implements it, A calls it.
- The event stream: A publishes it, B's UI consumes it.

---

## Decide together first (about 30 minutes)

1. **Stack:** proposed Next.js dashboard, with a Node or Python service for the worker and court streaming over SSE.
2. **Worker:** our own minimal tool loop (easier pausing and logging) or the Claude Agent SDK.
3. **Schemas:** finalize the types above.

## Integration checkpoints

1. **First:** A's real event stream replaces B's fake log.
2. **Second:** B's real `convene()` replaces A's stub, and the full loop runs on the trap repo.
3. **Last:** the comparison run and demo polish.

## Stretch (after MVP works)

| Person A | Person B |
|---|---|
| 3–5 workers in parallel | Human-escalation button in the UI |
| Overspending and flailing monitors | Appeals (the worker contests a ruling once) |
| A second worker type | "Precedent": past verdicts fed to the Judge |
