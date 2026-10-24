# court

Person B's courtroom: turns a monitor's Charge into a trial and a Verdict.

```ts
import { buildPacket, convene, holdTrial } from "./src/index.ts";

const packet = buildPacket(charge, events, { budgetUsd: 1.0 }); // evidence packet
const verdict = await convene(packet);   // contract for Person A: Verdict only
const trial = await holdTrial(packet);   // full record for the UI and case log
```

- **Prosecutor and Defense:** `claude-haiku-5-5`, run in parallel. Each must cite event IDs; IDs not in the packet are dropped.
- **Judge:** `claude-opus-5-5`, returns the Verdict JSON from WORK_SPLIT.md. Server-side refusal fallbacks are on (`fallbacks: "default"`).
- **Safety defaults:** if the Judge errors or refuses, the ruling is `escalate`. A `change_strategy` with no instruction also becomes `escalate`.
- **Mock mode:** with no `ANTHROPIC_API_KEY` set (or `COURT_MOCK=1`), the court runs a deterministic mock and calls no model. `trial.mock` says which ran.
- Override models with `COURT_LAWYER_MODEL` / `COURT_JUDGE_MODEL`.

## Run

```bash
npm install
npm run trial -- fixtures/looping-run.json            # print a transcript
npm run trial -- fixtures/looping-run.json --save cases  # also write cases/<id>.json
npm run typecheck
```

`examples/sample-trial.json` is a saved mock trial (the `Trial` type in `src/types.ts`) for building the courtroom scene and case log against.
