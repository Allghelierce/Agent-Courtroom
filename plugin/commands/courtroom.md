---
description: Show what the Courtroom is supervising, recent trials, and the dashboard link
allowed-tools: Bash(curl:*)
---

Run these two commands (the port is `$COURTROOM_PORT`, default 4300):

- `curl -s http://127.0.0.1:${COURTROOM_PORT:-4300}/workers`
- `curl -s http://127.0.0.1:${COURTROOM_PORT:-4300}/cases`

If they fail, the Courtroom daemon isn't running yet: it starts on the first tool call of a session. Say so in one line.

Otherwise reply in at most 6 short lines: each supervised session (state, step, tests passing, cost), then the last three trials (charge kind, ruling, one-line reason). End with the dashboard: run `cd ui && NEXT_PUBLIC_ENGINE_URL=http://127.0.0.1:4300 NEXT_PUBLIC_COURT_URL=http://127.0.0.1:4300 npm run dev` in the C0mpiled repo and open http://localhost:3000.
