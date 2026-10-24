# Work Split: Agent Courtroom

## The idea in one paragraph

We're building a babysitter for AI agents. An AI coding agent (the **worker**) tries to fix a broken project. Simple checks watch it work. If it gets stuck going in circles, a mini "court" of three AIs reviews what happened and decides what the worker should do next. A website shows all of this live, and we prove it saves money by running the same task with and without the court.

## Words we use

| Word | What it means |
|---|---|
| **Worker** | The AI agent doing the coding task. |
| **Trap** | A test we made impossible on purpose, so the worker gets stuck. This is how we show the court working. |
| **Event** | One line in a log describing one thing the worker did, e.g. "ran the tests, 7 of 10 passed, cost $0.002". |
| **Check** | Plain code (no AI) that reads the log and raises a flag when something looks wrong. |
| **Charge** | The flag a check raises, e.g. "the worker ran the same command 3 times in the last 10 steps". |
| **Court** | Three AI prompts: the **Prosecutor** says the worker is stuck, the **Defense** says it's doing fine, and the **Judge** decides. |
| **Verdict** | The Judge's decision: keep going, try something different, ask a human, or stop. |
| **Fake** | A pretend version of someone else's part, so you can build yours before theirs is ready. |

## Who does what

| | Person A: The Worker | Person B: The Court and Website (Tristan) | Person C: The Glue and Demo |
|---|---|---|---|
| **In one line** | Builds the AI that does the coding and the checks that watch it. | Builds the AI court and the website that shows everything. | Connects A and B, runs several workers at once, and gets the demo ready. |

---

## Person A: The Worker

**Your job:** make an AI agent that tries to fix a broken project, and notice when it gets stuck.

### Tasks (in order)

1. **Make the broken project.** Create a tiny project (a few functions) with tests that fail. Make one test impossible to pass, e.g. it calls a website that doesn't exist. That's the trap.
2. **Build the worker.** Write a loop that asks an AI model what to do next, lets it read files, edit files, and run the tests, and repeats until the tests pass.
3. **Log every step.** After each action, write one event to the log: what it did, how many tests pass, how much it cost, and any error.
4. **Write two checks.**
   - **Looping:** the worker did the exact same action 3 times in its last 10 steps.
   - **Stuck:** the number of passing tests hasn't gone up in the last 8 steps.

   When a check triggers, create a charge.
5. **Listen to the court.** When there's a charge, pause the worker and send the charge to the court. When the verdict comes back:
   - **Keep going:** resume.
   - **Try something different:** add the Judge's advice to the worker's next message.
   - **Ask a human:** wait.
   - **Stop:** end the run.
6. **Add an off switch** so the worker can run without the court. Person C needs this for the comparison.

**Before B's court is ready:** use C's fake court, which always says "try something different."

**You're done when:** the worker gets stuck on the trap, a check notices, the court's advice is passed in, and the worker fixes the rest of the tests.

---

## Person B: The Court and Website (Tristan)

**Your job:** build the court that decides what a stuck worker should do, and the website that shows everything.

### Tasks (in order)

1. **Gather the evidence.** When a charge comes in, bundle up the charge, the last ~10 events, how the number of passing tests changed over time, and how much money has been spent.
2. **Write the three court prompts.**
   - **Prosecutor:** argues the worker is stuck or wasting money.
   - **Defense:** argues the worker is making real progress.
   - Both must point to specific event numbers as proof, not just opinions.
   - **Judge:** reads both sides and returns a verdict in the fixed format at the bottom of this file.
   - Use a cheap model for the Prosecutor and Defense, and a stronger one for the Judge.
3. **Build the main page.** One card per worker showing its status, tests passed, money spent, and a warning light for each check.
4. **Build the courtroom scene.** A pixel-art courtroom that plays the trial like a conversation and ends on the verdict. Start from the mockup: https://claude.ai/artifact/YbpiWve6SgVTkYuexMZMpV
5. **Build the case history page.** A list of every trial: what the charge was, what each side said, and the verdict.
6. **Build the comparison chart** using C's numbers (with court vs. without court).

**Before A's worker is ready:** use C's fake log, which replays a worker getting stuck.

**You're done when:** a real charge leads to a full trial with a proper verdict, and the website shows it live.

---

## Person C: The Glue and Demo

**Your job:** connect A and B so they can work in parallel, scale it up to several workers, and prove it saves money.

### Tasks (in order)

1. **First hour: write the shared data formats** (at the bottom of this file) into `shared/schema.ts`, so everyone uses the same field names.
2. **First hour: make the two fakes.**
   - A **fake log** for B that replays a worker getting stuck.
   - A **fake court** for A that always says "try something different."
3. **Build the middle server.** It receives events from A's worker and pushes them live to B's website. It saves everything, so nothing is lost if the page reloads.
4. **Run several workers at once** (3 to 5), each on its own copy of a broken project.
5. **Make 2 or 3 more broken projects** with different traps (e.g. a test that randomly fails, or a missing library), so the workers don't all get stuck the same way.
6. **Run the comparison.** Run the same task with the court on and off. Record total cost, time, and whether it finished, and give the numbers to B.
7. **Track costs,** including how much the court itself costs, so we can show it's cheap compared to what it saves.
8. **Prepare the demo:** a step-by-step demo script, a backup video in case the live demo breaks, slides, and the README.

**You're done when:** several workers show up live on the website, the comparison numbers are ready, and the backup video is recorded.

---

## Order of work

1. **Everyone together (30 min):** pick the tech (suggested: a Next.js website, plus Node or Python for the worker and court) and agree on the data formats below.
2. **C (first hour):** shared data formats, both fakes, and a basic server. A and B start building against the fakes.
3. **Connect A to B:** the real worker's events show up on the website.
4. **Connect the court:** B's real court replaces the fake one, and a full run works on the trap.
5. **Scale up:** C runs multiple workers and the comparison.
6. **Everyone:** practice the demo, record the backup video, and polish.

## Must-have vs. nice-to-have

**Must-have for the demo:** one worker, the looping and stuck checks, one full trial, the worker recovering after the verdict, the website showing it, and the comparison numbers.

**Nice-to-have (only after the must-haves work):**

| Person A | Person B | Person C |
|---|---|---|
| Two more checks: overspending and repeated errors | A "human decides" button on the website | More than 5 workers at once |
| A second kind of worker (not coding) | The worker can appeal a verdict once | A live website judges can visit |
| | The Judge sees past verdicts for similar cases | Save past verdicts for the Judge |

---

## Shared data formats (reference)

These are the three things passed between people. Use these exact field names.

**Event:** one thing the worker did (A creates it, B displays it).

```json
{
  "id": 42,
  "workerId": "worker-1",
  "step": 42,
  "tool": "run_tests",
  "args": {},
  "tokens": 850,
  "costUsd": 0.002,
  "testsPassing": 7,
  "testsTotal": 10,
  "error": null,
  "timestamp": "2026-10-24T21:30:00Z"
}
```

**Charge:** the flag a check raises (A creates it, B's court receives it).

```json
{
  "workerId": "worker-1",
  "kind": "looping",
  "summary": "Ran the same test command 3 times in the last 10 steps",
  "eventIds": [38, 40, 42]
}
```

`kind` is one of `looping`, `stalling`, `overspending`, or `flailing`. The must-haves only use `looping` and `stalling` ("stuck").

**Verdict:** the Judge's decision (B creates it, A's worker follows it).

```json
{
  "ruling": "change_strategy",
  "instruction": "Mock the payments API in test_checkout and move on",
  "reasoning": "Events 38, 40, and 42 show the same failing call with no progress.",
  "cited_events": [38, 40, 42]
}
```

`ruling` is one of `continue` (keep going), `change_strategy` (try something different), `escalate` (ask a human), or `halt` (stop).
