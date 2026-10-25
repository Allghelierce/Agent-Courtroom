# Courtroom for Claude Code

**New here? Start with the [user guide](USER_GUIDE.md).**

Supervises your Claude Code sessions. After every tool call, cheap code checks (the engine's monitors, with no model calls) look for **looping**, **stalling**, **flailing**, and **overspending**. When one fires, a Prosecutor, a Defense, and a Judge review the evidence, and the ruling goes straight back to Claude:

| Ruling | What happens |
|---|---|
| continue | You see a one-line note, and Claude carries on. |
| change strategy | Claude gets a `COURT ORDER` with the Judge's instruction, before its next step. |
| escalate | Claude stops and asks you what to do. Answer in the terminal, or in the dashboard. You also get a desktop notification. |
| halt | The session stops. Send a new prompt to carry on. |

Every trial is saved, and you can watch it in the dashboard's pixel courtroom.

## Install

```
/plugin marketplace add Allghelierce/C0mpiled
/plugin install courtroom@c0mpiled
```

Then restart Claude Code. To try it without installing, run `claude --plugin-dir path/to/C0mpiled/plugin`.

The plugin needs Node 20 or later and nothing else, because the bundles in `dist/` include the court. By default the court is the free mock. Set `ANTHROPIC_API_KEY` (or `GROQ_API_KEY`) to get a real Prosecutor, Defense, and Judge.

Type `/courtroom` in a session to see what's being supervised and the latest trials.

## The dashboard

Each session shows up as a worker card. From the C0mpiled repo, run:

```sh
cd ui && npm install
NEXT_PUBLIC_ENGINE_URL=http://127.0.0.1:4300 NEXT_PUBLIC_COURT_URL=http://127.0.0.1:4300 npm run dev
```

Then open http://localhost:3000.

## How it works

- `hooks/hooks.json` runs `dist/hook.mjs` on six events: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, and SessionEnd.
- The hook starts a local daemon on `127.0.0.1:4300` the first time it runs, then forwards each event to it.
- The daemon turns each tool call into an engine `Event`:
  - Claude Code's tools map to the engine's names: `Read` becomes `read_file`, `Edit` and `Write` become `edit_file`, and a test-running `Bash` becomes `run_tests`.
  - Test counts are read from the output of pytest, unittest, jest, vitest, node:test, or cargo.
  - Cost comes from the session transcript.
- The daemon then runs the monitors on the events since the last ruling.
- Stalling and the per-test spend rule only apply once a test run has been seen, so a session with no tests is judged only on looping, flailing, and the budget.
- Sessions use stricter rules than the engine (`SESSION_CONFIG` in `src/monitors.ts`):
  - **Looping** only counts failed repeats (a tool error, or tests still failing), and compares shell commands without `cd x &&`, `2>&1`, `| tail`/`| head`, or `-v`/`-q`.
  - **Stalling** needs at least two runs of one suite in the window, with tests still failing and the same total throughout.
  - **Why:** replaying 689 real sessions (38,000 tool calls) with `npm run replay`, the engine rules charged 147 times, almost all on healthy work. The session rules charged 7 times.
- If the hook or the daemon fails, the hook exits quietly, so the courtroom never breaks your session.

**Privacy:** the daemon listens only on localhost.
- **Browsers:** only pages served from localhost can read it. Add other origins with `COURTROOM_ALLOWED_ORIGINS`.
- **Hook calls:** tool calls are accepted only with a token that the daemon keeps in its data folder.
- **Data:** everything stays in `~/.claude-courtroom/`: `stream.jsonl`, `cases/`, and `daemon.log`.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `COURTROOM_BUDGET_USD` | `5` | The budget per session. The overspending check charges at 80% of it, counted since the last ruling. |
| `COURTROOM_PORT` | `4300` | The daemon's port. |
| `COURTROOM_HOME` | `~/.claude-courtroom` | Where history and trials are kept. |
| `COURTROOM_DASHBOARD_URL` | `http://localhost:3000` | The base of the trial links. |
| `COURTROOM_ALLOWED_ORIGINS` | none | Extra browser origins that may read the daemon, comma-separated. |
| `COURTROOM_DISABLED` | unset | `1` turns the plugin off. |
| `COURTROOM_DEBUG` | unset | `1` prints hook errors to stderr. |
| `ANTHROPIC_API_KEY` / `GROQ_API_KEY` / `COURT_MOCK` | | The same as `court/`: real models when a key is set, otherwise the mock. |

## Development

```sh
cd court && npm install    # the plugin builds and tests with court/'s dev dependencies
cd ../plugin
npm run build              # writes dist/ (commit it: installs don't build)
npm test                   # monitor parity with the Python engine, mapping, cost, end to end, dist freshness
npm run typecheck
npm run replay             # replay your saved Claude Code sessions through the checks: how often would the court convene?
```

`dist/daemon.mjs` bundles `court/src`, so **run `npm run build` here after any change to `court/` or `plugin/src`, and commit `dist/`**. The `dist/ matches a fresh build` test fails until you do.
