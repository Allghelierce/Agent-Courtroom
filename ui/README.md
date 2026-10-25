# Agent Courtroom UI

The dashboard, courtroom and case log. Next.js. Read `ART.md` before changing anything visual.

```sh
npm install
npm run dev        # http://localhost:3000
```

## Where the data comes from

- **Workers, events, charges and verdicts:** the engine's SSE stream at `${NEXT_PUBLIC_ENGINE_URL}/stream` (`NEXT_PUBLIC_ENGINE_URL` defaults to `http://localhost:8787`). If nothing answers within 1.5 seconds, the dashboard replays the bundled demo run (`data/stream-demo.json`, from `court/fixtures/stream-demo-4workers.jsonl`) in the browser, with play, pause, 1x/2x/4x and restart controls. It keeps looking for the stream every 5 seconds and switches to it as soon as it answers, since the Claude Code plugin's daemon only starts with a session.
- **Trials (the courtroom dialogue):** the court server at `NEXT_PUBLIC_COURT_URL` (default `http://localhost:4100`, `cd ../court && npm run serve`). A stream verdict is matched to its trial by worker and charge id. When the court server is offline, the bundled mock trials in `data/stream-trials.json` stand in.

The whole run lives in `lib/live.tsx`, mounted in the root layout, so it keeps playing while you watch a trial.

## Refreshing the bundled demo

When `court/fixtures/stream-demo-4workers.jsonl` or the court's mock changes:

```sh
npm run sync-data
```

It copies the stream and holds a mock trial (court code, no model calls) for each charge in it, keeping the stream's ruling.

## Gotcha

The dev server doesn't always pick up edits to `app/globals.css`. If a style change doesn't show, restart `npm run dev`.
