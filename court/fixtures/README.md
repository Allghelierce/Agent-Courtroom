# court/fixtures

Recorded and scripted data for building the court and the UI without a live engine.
Field names follow `shared/schema.ts` on `origin/Amelia`.

| File | What it is |
|---|---|
| `engine-packet-checkout.json` | An `EvidencePacket` as the engine POSTs it to the court: a looping charge on the checkout seed repo's gateway trap. |
| `looping-run.json`, `stalling-run.json`, `false-alarm-run.json`, `overspend-run.json` | `{ budgetUsd, events, charge, verdict }` scenarios for court tests. Each verdict has an extra `expected` note. |
| `stream-demo-4workers.jsonl` | A ~3.5-minute dashboard demo, one `StreamMessage` per line (see below). |
| `replay.ts` | Plays a `.jsonl` stream with its original timing. |

## stream-demo-4workers.jsonl

Four workers on the checkout seed repo, in the exact conventions of the engine's recorded samples (`shared/samples/*.jsonl`): global event ids, a `worker` status after every event, `edit_file` args as `{path, old_str, new_str}`, `run_tests` with `{}` args, and test results in `result`.

- **worker-1** hits the gateway trap. A looping charge is filed, the court rules `change_strategy` (mock the gateway and flag it), and it finishes at 11/11. Its events are the engine's own `looping_run.jsonl`, respaced to 8 seconds per step.
- **worker-2** spots the unreachable gateway early, mocks it, and succeeds with no charge.
- **worker-3** reads the whole repo before running tests, so the stalling check fires. That's a false alarm: the court rules `continue`, and the worker finishes at 11/11.
- **worker-4** spends $0.55 building a stub gateway server with no new passing tests. The overspending check fires, and the court rules `halt`.
- The run ends with a `comparison`: worker-1 with the court ($1.42, succeeded) against the same run without it ($2.04, out of budget at 10/11). The without-court numbers match the engine's `comparison_run.jsonl`.

Every charge in the file is exactly what the engine's `monitors.check` returns at that event, with the window reset after each ruling.

## Replaying

```sh
npx tsx fixtures/replay.ts                          # stream-demo-4workers.jsonl in real time
npx tsx fixtures/replay.ts --speed 4 --sse          # 4x faster, as SSE `data:` frames
npx tsx fixtures/replay.ts ../shared/samples/looping_run.jsonl
```

Or import `replay(path, { speed, signal }, onMessage)`, which stops when `signal` aborts.

Only events and a worker's start or end carry a time, so every other message plays right after the line before it.

**This is a stand-in.** The engine's live `GET /stream` on port 8787 (Person C's event server) replaces it, so the UI should switch its `EventSource` over once that's running.
