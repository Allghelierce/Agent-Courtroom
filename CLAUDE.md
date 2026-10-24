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

### UI mockup

Pixel-art courtroom draft: https://claude.ai/artifact/YbpiWve6SgVTkYuexMZMpV (private until shared). It currently shows the price-watcher worker; update it if the coding worker sticks.
