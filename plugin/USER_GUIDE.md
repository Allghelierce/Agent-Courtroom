# Courtroom user guide

Courtroom watches your Claude Code sessions. If Claude gets stuck (repeating the same failing step, making no progress, hitting the same error, or spending too much), a court made of a Prosecutor, a Defense, and a Judge reviews what happened and tells Claude what to do next.

You keep working as usual. Courtroom only speaks up when something looks wrong.

## 1. What you need

- **Claude Code**, already installed and signed in.
- **Node.js 20 or newer:** check with `node --version`.

You don't need an API key: the court runs as a free stand-in by default. See [Use real AI lawyers](#7-use-real-ai-lawyers-optional).

## 2. Start it

Open a terminal in the project you want Claude to work on, then start Claude Code with the plugin:

```sh
claude --plugin-dir ~/C0mpiled/plugin
```

That's it. Courtroom starts on its own; there's nothing else to launch. Use the same command each time you want Courtroom on. A plain `claude` runs without it.

**Install it permanently instead** (optional). Inside Claude Code, run:

```
/plugin marketplace add Allghelierce/C0mpiled
/plugin install courtroom@c0mpiled
```

Then restart Claude Code, and every session is supervised with a plain `claude`.

## 3. Check that it's working

When the session starts, you should see:

> ⚖ Courtroom is supervising this session. Trials appear at http://localhost:3000

You can also check at any time:

- Type `/courtroom` in Claude Code to see the sessions being supervised and the latest trials.
- Or, in another terminal: `curl -s localhost:4300/health`, which should print `{"ok":true,"service":"courtroom-plugin",...}`.

## 4. See a trial (two-minute demo)

To watch the court in action on purpose, use the practice project that comes with the repo:

```sh
cp -r ~/C0mpiled/seed_repos/checkout ~/court-demo
cd ~/court-demo
claude --plugin-dir ~/C0mpiled/plugin
```

Then ask Claude:

> Run `python3 -m unittest discover -s tests` three times in a row without changing anything.

On the third identical failing run, the court convenes, and you'll see something like:

> ⚖ COURT ORDER (change strategy, looping charge): Stop editing the code for the failing test. The external API it calls is unreachable: mock that API in the test, mark the test for human review, and finish the rest of the suite.

Claude then follows the order. Delete `~/court-demo` when you're done.

## 5. What the court can decide

| Ruling | What you'll see | What you do |
|---|---|---|
| **Continue** | A short "charge dismissed" note. | Nothing. It was a false alarm. |
| **Change strategy** | ⚖ COURT ORDER with an instruction. Claude follows it. | Nothing, unless you disagree. Then just tell Claude. |
| **Ask a human** | "Courtroom needs your decision", plus a desktop notification. Claude stops and asks you. | Reply in the terminal, or click a decision in the dashboard. |
| **Halt** | "Courtroom halted this session." Claude stops. | Send a new message to carry on, if you want to. |

**What triggers a trial:**

- **Looping:** the same action with the same result, 3 times within 10 steps.
- **Stalling:** passing tests haven't gone up in 8 steps. This only applies once tests have run.
- **Flailing:** 3 tool errors in a row, or the same error 3 times.
- **Overspending:** 80% of the session budget used ($5 by default).

After each ruling, the count starts fresh.

## 6. Watch it in the dashboard (optional)

The dashboard shows each session as a card, with steps, cost, and warning lights. Each trial plays out in a pixel-art courtroom. From the C0mpiled repo, run:

```sh
cd ~/C0mpiled/ui
npm install        # first time only
NEXT_PUBLIC_ENGINE_URL=http://127.0.0.1:4300 NEXT_PUBLIC_COURT_URL=http://127.0.0.1:4300 npm run dev
```

Open http://localhost:3000. The links in Courtroom's messages open the matching trial.

## 7. Use real AI lawyers (optional)

By default the court is a free stand-in that follows fixed rules. For real AI lawyers and a real AI Judge, set a key before starting Claude Code:

```sh
export ANTHROPIC_API_KEY=sk-ant-...     # or: export GROQ_API_KEY=...
claude --plugin-dir ~/C0mpiled/plugin
```

A trial is a few short model calls, and trials only happen when a check fires.

## 8. Settings

Set any of these before starting Claude Code, for example `COURTROOM_BUDGET_USD=10 claude --plugin-dir ~/C0mpiled/plugin`.

| Setting | Default | What it does |
|---|---|---|
| `COURTROOM_BUDGET_USD` | `5` | Budget per session, for the overspending check. |
| `COURTROOM_DISABLED=1` | off | Turns Courtroom off for that session. |
| `COURTROOM_DEBUG=1` | off | Shows Courtroom's errors, if something isn't working. |
| `COURTROOM_PORT` | `4300` | Change it if port 4300 is already in use. |
| `COURTROOM_DASHBOARD_URL` | `http://localhost:3000` | Where the trial links point. |

## 9. Troubleshooting

**No "Courtroom is supervising" message.**

- Check that you started with `--plugin-dir ~/C0mpiled/plugin`, and that `node --version` is 20 or newer.
- Restart with `COURTROOM_DEBUG=1 claude --plugin-dir ~/C0mpiled/plugin` to see errors.

**`/courtroom` says it isn't running.** Courtroom starts on the first tool call. Ask Claude to do something, like read a file, and try again.

**Port 4300 is busy.** Start with `COURTROOM_PORT=4301`. If you use the dashboard, change its URLs to match.

**The dashboard shows a demo instead of my session.** The dashboard has to be started with the two `NEXT_PUBLIC_..._URL` settings from step 6.

**Something else.** Look at `~/.claude-courtroom/daemon.log`.

## 10. Your data

Everything stays on your computer, in `~/.claude-courtroom/`:

- `stream.jsonl` is the activity log.
- `cases/` holds one file per trial.

Only web pages on your own machine (localhost) can read it. To start fresh, quit Claude Code, stop the background process with `pkill -f courtroom.*daemon.mjs`, and delete that folder.

If you set an API key, the court sends the evidence for each trial to that provider: the recent steps, which include commands and file paths.
