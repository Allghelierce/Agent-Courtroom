# Courtroom plugin for Claude Code

**Goal:** anyone can install the courtroom into Claude Code and have it supervise their own sessions, with the existing dashboard showing each session as a worker.

## Install

```
/plugin marketplace add Allghelierce/C0mpiled
/plugin install courtroom@c0mpiled
```

For local development: `claude --plugin-dir ./plugin`. No `npm install` is needed at install time, because the plugin ships prebuilt bundles in `plugin/dist/`. It needs Node 20+ and nothing else. The court runs as the mock (free) unless `ANTHROPIC_API_KEY` or `GROQ_API_KEY` is set, the same as `court/`.

## Pieces

| Unit | What it does |
|---|---|
| `plugin/hooks/hooks.json` | Registers `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, and `SessionEnd`. Each one runs `node dist/hook.mjs <event>`. |
| `src/hook.ts` | Reads the hook JSON from stdin, starts the daemon if it isn't running, forwards the input to `POST /hook`, and prints the hook output it gets back. Any failure exits 0 silently, so the plugin can never break a session. |
| `src/daemon.ts` | Local server on `127.0.0.1:4300` (`COURTROOM_PORT`). Holds one worker per Claude Code session, runs the monitors after every tool call, holds trials, and serves the UI's endpoints: `/stream`, `/history`, `/workers`, `/cases`, `/cases/:id`, and `POST /workers/:id/resolve`. History and cases persist under `~/.claude-courtroom/` (`COURTROOM_HOME`). |
| `src/map.ts` | Turns a Claude Code tool call into an `Event` from `shared/schema.ts`: compact `args`, a normalized `result`, and `error` only for real tool failures. A failing test run is not an error. |
| `src/progress.ts` | Reads test counts from tool output (pytest, unittest, jest, vitest, node:test, cargo) to fill `testsPassing` and `testsTotal`. |
| `src/cost.ts` | Prices the session's model usage from its transcript, deduplicated by message id, using `shared/model-prices.json`. |
| `src/monitors.ts` | A port of `engine/courtroom_engine/monitors.py`, with a parity test against the Python version. Two guards for open-ended sessions: stalling and the per-test spend rule only apply once test counts have been seen. |

## When a check fires

The charge is filed, the worker shows `on_trial`, and the court runs: `holdTrial(fromEnginePacket(packet), { past })`, then `saveTrial`. The packet is built the way `court.build_packet` builds it. The worker's monitor window resets after every ruling. The hook waits for the verdict, with a 120 s timeout, then:

| Ruling | Claude Code sees | Session state |
|---|---|---|
| `continue` | A one-line note for the user | running |
| `change_strategy` | `COURT ORDER` with the instruction and reasoning, as `additionalContext` | running |
| `escalate` | The tool result is blocked with "stop and ask the user", plus a desktop notification | awaiting_human: tools are denied until the user answers in the terminal or in the dashboard |
| `halt` | `continue: false` with a stop reason | halted: tools are denied until the user sends a new prompt |

A decision made in the dashboard (`/resolve`) is delivered to Claude as `additionalContext` on the user's next prompt.

## UI

Run it unchanged, with `NEXT_PUBLIC_ENGINE_URL` and `NEXT_PUBLIC_COURT_URL` set to `http://127.0.0.1:4300`. Each session is a worker card named `claude-code:<folder>`.

## Out of scope for now

- Serving a prebuilt UI from the daemon.
- A hosted dashboard.
- Any monitors beyond the engine's four.

## Testing

- Monitor parity with the Python monitors on every court fixture.
- Unit tests for the mapper, progress parsing, and cost.
- An end-to-end test that pipes scripted hook inputs through `dist/hook.mjs` against a mock-court daemon, and checks for the looping charge, the `COURT ORDER` output, the stream messages, and a saved case.
