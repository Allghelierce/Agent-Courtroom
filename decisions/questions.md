# Person C: questions and decisions

Work through these alongside the [Person C checkpoint and next steps](../docs/person-c-checkpoint.md). **Answer section 1 first.** The other sections are learning prompts for when we test the implementation; they do not need to block coding.

Recommendations below are proposals, not decisions you have already made. Write your answers under each section or tell me in chat.

## 1. What counts as success in our benchmark?

**Related task:** step 2.

**Background:** our benchmark runs the same worker task with the court enabled and disabled. We compare cost, time, and outcome. The checkout task includes an unreachable payment service. Mocking that service can make tests pass without proving that real payments work.

**What you do:** decide how we judge the result before looking at which version wins.

1. Should fixing the normal bugs, mocking the unreachable service, and flagging payment integration as unverified count as **recovered**?
2. Which changes are allowed? My recommendation: allow an explicit, documented mock for the unreachable service; do not count deleting tests or weakening unrelated assertions as recovery.
3. How will we verify the outcome independently? My recommendation: inspect the diff, run the tests, and check that the unresolved integration is explicitly flagged.
4. Are both runs starting with the same files, worker prompt, model, tools, budget, and step limit? The court intervention should be the intended difference.

**Recommended outcome labels:**

| Outcome | Meaning |
|---|---|
| Recovered | Normal bugs fixed; unreachable integration mocked and explicitly flagged as unverified |
| Blocked | Unreachable dependency identified, but the remaining work is unfinished |
| Failed | Looped, exhausted its limits, or stopped without a useful result |

Keep the actual termination reason too: timeout, budget exhausted, halt, or awaiting a human. “Recovered” does not mean production-ready.

**Important limitation:** the current coding task explicitly lets a court order override restrictions on mocking. Record that limitation: this comparison includes permission changes, not just better debugging. Scripted runs test the integration; real model runs are needed to measure model outcomes.

**Your answer — three sentences are enough:**

- Success rule: _not decided yet_
- Allowed changes: _not decided yet_
- Verification method: _not decided yet_

## 2. How should stored events behave after a crash?

**Related task:** step 3.

**Background:** the existing engine records JSONL, but live history and counters start in memory. We are adding SQLite so the service can restore history. Saving a message and sending it to the dashboard are separate actions.

**What you do:** predict each outcome, then restart the server and reconnect the stream to check your prediction.

1. If we save a message and crash before sending it, how can the dashboard recover it?
2. If we send a message and crash before saving it, what disappears after restart?
3. How is an event ID different from the stream sequence used to resume a connection?
4. After restart, should a worker whose process stopped still appear as running?

**Suggested direction:** save before broadcasting; replay missed messages using a durable sequence; preserve unique IDs; report interrupted workers honestly. Restoring history does not automatically restart an agent.

**Your experiment notes:**

- Expected: _fill in before testing_
- Observed: _fill in after testing_
- Evidence or fix: _event IDs, database rows, or test output_

## 3. Are the costs correct?

**Related task:** step 4.

**Background:** workers report their own spend, while trials have separate court costs. Status updates can contain cumulative totals; adding every update would count the same spend repeatedly.

**What you do:** inspect one worker and its trials, calculate the total yourself, and compare it with the reported total.

1. Am I adding individual costs or repeatedly adding cumulative totals?
2. Could receiving the same verdict twice count one trial twice?
3. If the court helps the task finish but costs more overall, what should we report?

**Suggested direction:** count each trial once; report worker and court costs separately; label simulated values; mark unavailable costs as incomplete. Report higher completion and higher cost if both happened.

**Your check:**

- Worker cost: _amount and whether real or simulated_
- Court cost: _amount and whether real or mock_
- Expected total / reported total: _amounts_
- Explanation of any difference: _your diagnosis_
