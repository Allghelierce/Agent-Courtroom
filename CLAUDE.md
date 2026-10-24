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

## Project: Agent Courtroom, powered by TokenGuard

We're merging TokenGuard and the Agent Courtroom, with the Price-Drop agent as the worker being supervised.

- **TokenGuard is the evidence.** It handles cost tracking, repeated-call detection, and the free code-based monitors.
- **The Courtroom is the decision-maker.** A Prosecutor, a Defense, and a Judge decide whether to continue, change strategy, switch to a cheaper model, escalate, or halt.
- **The Price-Drop agent is the worker** being supervised in the demo.

### Why this wins on all three criteria

- **Innovation:** the courtroom is memorable and unlike what other teams will build.
- **Scalability:** cheap code monitors plus court only on demand means it can oversee many agents. Show 3–5 workers running at once.
- **Real-world impact:** a relatable everyday worker (price tracking) makes it concrete, and the with/without cost comparison gives judges real numbers.

### Demo flow

Several price-watching agents run. One hits a broken store page and starts looping. TokenGuard flags the rising cost, court convenes, and the Judge rules "switch to backup store and a cheaper model." The agent recovers. Then show the comparison: cost, time, and success with vs. without.

### Keep it doable

The price worker can run on mock store pages we control, which keeps the build within 6 hours.
