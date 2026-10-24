# C0mpiled: Agent Courtroom

> Agents don't need a babysitter. They need a judicial system.

An AI coding agent (the **worker**) tries to fix a broken repo with no one watching. Cheap code checks watch every step for looping, stalling, overspending, and flailing. When one fires, a court convenes: a **Prosecutor** and a **Defense** argue from the logs, and a **Judge** rules **continue**, **change strategy**, **escalate to a human**, or **halt**. Every trial is saved so a human can see later what happened and why.

## What's in the repo

| Folder | What it is | Owner |
|---|---|---|
| `court/` | The courtroom: evidence packet, Prosecutor/Defense/Judge, precedent, HTTP server on port 4100. See [court/INTEGRATION.md](court/INTEGRATION.md). | Person B |
| `ui/` | Next.js dashboard, pixel-art courtroom scene, and case log on port 3000. | Person B |
| `engine/`, `seed_repos/`, `shared/` | Worker loop, monitors, broken checkout repo with the trap test, live-update server on port 8787, shared types. **Currently on the `Amelia` branch.** | Person A |

Who does what: [WORK_SPLIT.md](WORK_SPLIT.md).

## Run it

```sh
# 1. Court (mock mode: no API key needed, no cost)
cd court && npm install && COURT_MOCK=1 npm run serve

# 2. Website: http://localhost:3000 (replays a bundled demo run if the engine isn't running)
cd ui && npm install && npm run dev

# 3. Engine (from the Amelia branch): one worker, using the real court
cd engine && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m courtroom_engine serve --workers 1 --court http://localhost:4100/verdict
```

Real models: set `ANTHROPIC_API_KEY` and drop `COURT_MOCK=1`. Court tests: `cd court && npm test`.

## Branch workflow

- Everyone works on their own branch (`Tristan`, `Amelia`, ...). Commit and push often.
- Never commit directly to `main`. Merge through a PR.

## Judging

The top 5 projects will be picked to demo. Projects are judged in 3 areas:

- **Scalability:** cheap code checks, plus a court only when needed, so one court can oversee many workers.
- **Innovation:** an adversarial trial instead of a single "are you stuck?" check.
- **Real-world impact:** runaway agents waste real money. We show cost with vs. without the court.
