# CLAUDE.md

## Git workflow

- Work only on the `Tristan` branch (tracks `origin/Tristan`). Never commit to or push to `main`.
- Commit and push often: after every meaningful change, not just at the end.
- Pull with `git pull --rebase` before pushing, since multiple Claude sessions share this branch.
- Don't switch branches or stash without asking. Other sessions may share the working tree.

## Judging criteria

The top 5 projects will be picked to demo. Projects are judged in 3 areas, so make decisions with these in mind:

- **Scalability**
- **Innovation**
- **Real-world impact**

## Project: Agent Courtroom

> Status: brainstorming. Nothing here is locked in yet.

**Pitch:** "Agents don't need a babysitter. They need a judicial system."

Hackathon prompt (c0mpiled-16, Unsupervised): build agents that run for hours without constant supervision. The system should know when it is stuck, overspending, looping, or needs to stop.

### How it works

A worker agent runs a long task in the background. Cheap monitors check every step for four warning signs:

- **Looping:** repeating the same action or tool call.
- **Overspending:** cost climbing faster than progress.
- **Stalling:** no new progress (passing tests, files, facts) in N steps.
- **Flailing:** repeated errors or "let me try another approach" retries.

The monitors are plain code with no LLM calls, so watching is nearly free. When one fires, court convenes:

- **Prosecutor** argues the worker is stuck or wasting money.
- **Defense** argues it's making real progress and should continue.
- **Judge** rules: **continue**, **change strategy** (with a specific new instruction), **pause and escalate to a human**, or **halt**.

Every case and verdict is saved to a readable log, so someone coming back hours later can see exactly what happened and why.

### Key design choices

- Court only convenes when a monitor fires, so the oversight layer doesn't overspend either.
- Prosecutor and Defense argue from logs and metrics (action history, spend vs. budget, progress, error counts), not from the worker's own story. That stops the debate from collapsing into the agents agreeing with each other.
- Cheap models for Prosecutor and Defense, a stronger model for the Judge.

### The worker: a coding agent fixing a failing repo (proposed)

The worker gets a small repo with a failing test suite and tries to make it pass.

- **Progress is easy to measure:** tests passing out of total. That gives the monitors and the lawyers hard evidence.
- **Looping happens naturally:** coding agents really do edit the same file and rerun the same tests over and over.
- **Judges get it right away:** they're developers who have watched an AI coding tool burn tokens going in circles.
- **The trap:** one test depends on an unreachable API (or is impossible as written). The worker loops on it, court convenes, and the Judge rules "change strategy: mock the API / skip that test and flag it for a human." The worker finishes the rest.

Other workers we considered: a price-drop tracker on mock store pages, a research-report compiler, and a messy-data scraper. The courtroom should stay worker-agnostic so any of these can plug in later.

### Why this wins on the judging criteria

- **Innovation:** the courtroom is memorable and unlike what other teams will build.
- **Scalability:** cheap code monitors plus court only on demand means one courtroom can oversee many agents. Show 3–5 workers running at once.
- **Real-world impact:** runaway agents waste real money. A with/without comparison gives judges real numbers.

### Demo flow

1. Several workers run, each on its own repo. The screen shows a live activity feed, a cost meter, and warning lights.
2. One worker hits the trap and starts looping. The monitor fires and the courtroom transcript pops up.
3. Prosecutor, Defense, and Judge argue from the logs. The Judge rules "change strategy." The worker recovers.
4. Show the same run with and without the courtroom: total cost, time to completion, and whether the task succeeded.

### What we're building, piece by piece (draft)

Four parts, each one small enough for one person to own:

1. **Worker runner.** Starts a coding agent on a sandboxed copy of a seed repo and lets it loop: read files, edit, run tests. Every step writes one event to a shared log: the tool call, its arguments, token cost, test results, and any error.
2. **Monitors.** Plain functions that read the event log after every step and return either nothing or a *charge*:
   - Looping: the same (tool, arguments) hash shows up 3+ times in the last 10 steps.
   - Overspending: spend per newly passing test is above a threshold, or the run is over X% of budget.
   - Stalling: the passing-test count hasn't gone up in N steps.
   - Flailing: K errors in a row, or the same error message over and over.
3. **Courtroom.** When a charge is filed, the worker pauses and the court gets an *evidence packet*: the charge, the last N events, the test progress curve, and spend vs. budget. Prosecutor and Defense each make one argument that must cite event IDs from the packet. The Judge then returns a structured verdict:
   ```json
   { "ruling": "continue | change_strategy | escalate | halt",
     "instruction": "Mock the payments API in test_checkout and move on",
     "reasoning": "...", "cited_events": [41, 44, 47] }
   ```
   On `change_strategy`, the instruction is injected into the worker's next prompt. On `escalate`, the worker waits for a human. On `halt`, the run ends with a summary.
4. **Dashboard.** A live grid of workers (status, tests passing, cost meter, warning lights). Clicking into a case opens the pixel-art courtroom, which plays the transcript as dialogue and ends on the verdict. A case log page lists every trial so a human can audit what happened.

### Why a trial and not just one supervisor call

- **Adversarial on purpose:** a single "are you stuck?" check tends to rubber-stamp. Two sides arguing opposite positions bring up the strongest case for each before anyone rules.
- **Grounded:** arguments have to cite real events, so the court judges evidence, not vibes.
- **Auditable:** every intervention leaves a short, human-readable record of why it happened.
- **Cheap:** most steps cost nothing to monitor. Only the rare trial spends tokens, and only a few calls' worth.

### MVP vs. stretch

- **MVP (must work for the demo):** one seed repo with the trap test, one worker, the looping and stalling monitors, a full trial with a structured verdict, `change_strategy` injected and the worker recovering, a dashboard showing the run plus one courtroom scene, and the with/without cost comparison.
- **Stretch:** 3–5 workers running in parallel, all four monitors, a human-escalation button in the UI, appeals (the worker can contest a ruling once), "precedent" (past verdicts fed to the Judge for similar charges), and plugging in a second worker type.

### Open questions

- What should the worker be: a real agent SDK (for example Claude Agent SDK) or our own minimal tool loop? A minimal loop gives us full control over logging and pausing.
- What's the stack? Proposed: TypeScript/Next.js for the dashboard, with the worker and court as a Node or Python service that streams events to the UI over SSE/WebSocket.
- Should the with/without comparison run live or be pre-recorded? Live is riskier but more convincing.
- Do we name the agents (a judge character, etc.) for the courtroom scene, or keep them generic?

### Team split

**Person A: the engine (worker, monitors, seed repo)**

- **Seed repo:** a small project with a failing test suite plus the trap test that depends on an unreachable API.
- **Worker runner:** the tool loop (read, edit, run tests) on a sandboxed copy of the seed repo. Writes one event per step: tool call, arguments, token cost, tests passing, and any error.
- **Monitors:** looping and stalling for the MVP; overspending and flailing are stretch goals. Each returns a charge when it fires.
- **Control hooks:** pause the worker when a charge is filed, then act on the verdict: inject the instruction into the next prompt on `change_strategy`, wait for a human on `escalate`, end the run on `halt`.
- **With/without comparison:** the same run with and without the courtroom, measuring cost, time, and whether the tests passed.

**Person B: the court and the UI (Tristan)**

- **Courtroom:** builds the evidence packet from a charge, runs the Prosecutor and Defense prompts (each must cite event IDs), then the Judge prompt, which returns the structured verdict.
- **Dashboard:** the worker grid, with status, tests passing, cost meter, and warning lights.
- **Courtroom scene:** plays the trial transcript as dialogue. Adapt the existing pixel-art mockup, which still shows the price watcher.
- **Case log:** a page listing every trial so someone can audit what happened.

**The contract between A and B** is the event log, the charge, and the verdict JSON above. Agree on those shapes first so both sides can build against mocks.

### UI mockup

Pixel-art courtroom draft: https://claude.ai/artifact/YbpiWve6SgVTkYuexMZMpV (private until shared). It currently shows the price-watcher worker; update it if the coding worker sticks.
