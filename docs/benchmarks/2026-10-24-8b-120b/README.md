# Llama 8B with optional 120B advice: October 24, 2026

Implemented an OpenRouter Llama 3.1 8B worker with a Groq 120B advisor triggered
by the existing looping/stalling monitors. Both arms use the same harder seed,
prompts, tools, batching and 100-turn/$0.50 worker limits. The advisor has full
rules/source, a $0.10 budget, and no prior-run answers. This is a single advisor,
not the original prosecutor/defense/judge courtroom.

The user's direct Groq account denied 8B access. OpenRouter authentication and
an actual Llama tool call succeeded via the pinned Groq endpoint. Provider
accounting uses OpenRouter's response usage.cost; unknown charges remain unknown.

All three exploratory pair attempts are retained, including integration failures:

| Attempt | With advisor enabled | Without advisor | Final checks, both |
| --- | --- | --- | --- |
| 1, af90007 | 3 turns; advisor API error, halted | 3 turns; prose stop | 5/22 |
| 2, a9c8798 | 6 turns; wrapped tool error stopped runner | 3 turns; prose stop | 5/22 |
| 3, 62bdade | 1 turn; XML-like commands in prose | 5 turns; prose stop | 5/22 |

No run reached turn 10; no ten-turn milestone could be emitted. No run qualified
for Stripe checks. The code did not execute commands merely written as text.

In attempt 1, three identical invalid list_files calls triggered a real loop
charge. The 120B request failed with BadRequestError; the original error body
was not captured, so its precise cause remains unknown. A separate replay of
that same packet succeeded and advised correct empty-object tool arguments.
That replay did not resume the worker and is not a recovery success. Its usage
is retained separately from benchmark totals. The diagnostic replay is stored
under attempt-1/withAdvisor/advice/1/diagnostic-replay.json.

After that failure, the advisor gained one recorded retry for recognized
provider output-format errors. Missing failed-call usage makes total cost unknown.
Attempt 2 exposed OpenRouter wrapping model tool-validation errors inside a
successful HTTP response. The adapter now converts that specific envelope to
an observable malformed-call step, consistent with direct Groq handling; other
upstream failures remain failures. Attempt 3 used this fix and still stopped
early because the workers returned text rather than native tool calls.

The advisor was never successfully delivered to an active worker in these
pairs. This evidence therefore does not establish advisor effectiveness or
savings. Llama 8B is currently unreliable with this tool interface; this is not
proof it cannot perform the underlying task with a different interface.

Next possible experiment: require native tool calls while checks are failing,
applied identically to both arms, then test again. That change has not been
implemented; no further benchmark was started after attempt 3.

See [all attempts](attempts.json) and each attempt's full results, source diffs,
verification and advice records. Full raw logs remain under ignored runs/.
Pricing and run instructions are in [the experiment spec](../../benchmark-small-worker.md).
