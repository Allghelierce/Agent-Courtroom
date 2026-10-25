# Agent Courtroom UI

The dashboard, courtroom and case log. Next.js. Read `ART.md` before changing anything visual.

```sh
npm install
npm run dev        # http://localhost:3000
```

## Where the data comes from

- **Workers, events, charges and verdicts:** the engine's SSE stream at `${NEXT_PUBLIC_ENGINE_URL}/stream` (`NEXT_PUBLIC_ENGINE_URL` defaults to `http://localhost:8787`). If nothing answers within 1.5 seconds, the dashboard replays the bundled demo run (`data/stream-demo.json`, from `court/fixtures/stream-demo-4workers.jsonl`) in the browser, with play, pause, 1x/2x/4x and restart controls.
- **Trials (the courtroom dialogue):** the court server at `NEXT_PUBLIC_COURT_URL` (default `http://localhost:4100`, `cd ../court && npm run serve`). A stream verdict is matched to its trial by worker and charge id. When the court server is offline, the bundled mock trials in `data/stream-trials.json` stand in.

The whole run lives in `lib/live.tsx`, mounted in the root layout, so it keeps playing while you watch a trial.

## Deploy the recorded workflow

```sh
npm ci
npm run build:demo
```

For Vercel, import this repository and set **Root Directory** to `ui`, use
**Node.js 24.x**, and enable **Include source files outside of the Root
Directory in the Build Step**. The UI imports types from `court/` and `shared/`.
`ui/vercel.json` selects `npm ci`, `npm run build:demo`, and the `out` output
directory. These settings follow Vercel's [build configuration](https://vercel.com/docs/builds/configure-a-build)
and [monorepo guidance](https://vercel.com/docs/monorepos/monorepo-faq).

The generated `out/` directory also works on other static hosts. This build starts the
bundled replay immediately and never connects to the engine or court. It includes
the dashboard, case log, all three trial URLs and their Record tabs. No API keys
are required. Worker costs and comparison savings are simulated; this demo does
not establish real courtroom savings. The normal `build`, `dev` and `start`
commands retain live-service support.

Suggested walkthrough: start on the dashboard, choose 4x, open the case log,
replay `/court/demo-worker-1-3/` (change strategy), and switch to its Record tab
to inspect the cited events. The other cases demonstrate continue and halt.
Human escalation and the newer real-model/Stripe experiments are not part of
this bundled recording; their evidence remains in the repository's `docs/`.

## Refreshing the bundled demo

When `court/fixtures/stream-demo-4workers.jsonl` or the court's mock changes:

```sh
npm run sync-data
```

It copies the stream and holds a mock trial (court code, no model calls) for each charge in it, keeping the stream's ruling.

## Gotcha

The dev server doesn't always pick up edits to `app/globals.css`. If a style change doesn't show, restart `npm run dev`.
