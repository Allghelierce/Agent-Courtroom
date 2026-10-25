import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from courtroom_engine.brains import DEFAULT_MODELS, GroqBrain
from courtroom_engine.costs import model_rates, price_usage
from courtroom_engine.engine import RunConfig, get_task


class BadRequest(Exception):
    def __init__(self, message, body=None):
        super().__init__(message)
        self.body = body
        self.status_code = 400


class CostTests(unittest.TestCase):
    def test_cached_usage_counts_each_bucket_once(self):
        cost = price_usage("claude-opus-5-5", {
            "input_tokens": 100, "output_tokens": 50,
            "cache_creation_input_tokens": 1000, "cache_read_input_tokens": 2000,
            "cache_creation": {"ephemeral_1h_input_tokens": 400},
        })
        self.assertAlmostEqual(cost, (100 * 4 + 50 * 20 + 600 * 5 + 400 * 8 + 2000 * .2) / 1e6)

    def test_unknown_model_does_not_claim_zero_cost(self):
        self.assertIsNone(price_usage("unknown-model", {"input_tokens": 100}))

    def test_long_context_counts_cached_input_toward_threshold(self):
        self.assertAlmostEqual(price_usage("claude-haiku-5-5", {
            "input_tokens": 1, "cache_read_input_tokens": 100000,
        }), (0.5 + 100000 * .05) / 1e6)

    def test_groq_default_starts_and_records_usage_without_credentials(self):
        usage = SimpleNamespace(prompt_tokens=1000, completion_tokens=100, total_tokens=1100,
                                model_dump=lambda: {"prompt_tokens": 1000, "completion_tokens": 100})
        response = SimpleNamespace(model=DEFAULT_MODELS["groq"], usage=usage,
                                   choices=[SimpleNamespace(message=SimpleNamespace(content="done", tool_calls=[]))])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **kw: response)))
        with patch.dict(sys.modules, {"groq": SimpleNamespace(Groq=lambda **kw: client)}):
            action = GroqBrain(get_task("prices")).next_action()
        self.assertAlmostEqual(action.cost_usd, .00021)
        self.assertTrue(action.cost_complete)
        self.assertEqual(action.usage["prompt_tokens"], 1000)
        self.assertEqual(model_rates("openai/gpt-oss-20b")[:2], [.075, .30])

    def _groq(self, create):
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        fake = SimpleNamespace(Groq=lambda **kw: client, BadRequestError=BadRequest, APIStatusError=BadRequest)
        return patch.dict(sys.modules, {"groq": fake})

    def test_groq_prices_cached_prompt_tokens_at_the_discount(self):
        usage = SimpleNamespace(prompt_tokens=1000, completion_tokens=100, total_tokens=1100,
                                prompt_tokens_details=SimpleNamespace(cached_tokens=600),
                                model_dump=lambda: {})
        response = SimpleNamespace(model=DEFAULT_MODELS["groq"], usage=usage,
                                   choices=[SimpleNamespace(message=SimpleNamespace(content="done", tool_calls=[]))])
        with self._groq(lambda **kw: response):
            action = GroqBrain(get_task("prices")).next_action()
        self.assertAlmostEqual(action.cost_usd, (400 * .15 + 600 * .075 + 100 * .6) / 1e6)

    def test_malformed_groq_tool_call_keeps_estimate_but_marks_usage_incomplete(self):
        def create(**kw):
            raise BadRequest("tool_use_failed", {"error": {"code": "tool_use_failed", "failed_generation": "x" * 400}})
        with self._groq(create):
            action = GroqBrain(get_task("prices")).next_action()
        self.assertEqual(action.tool, "invalid_tool_call")
        self.assertFalse(action.cost_complete)
        self.assertGreater(action.cost_usd, 0)
        self.assertEqual(action.usage["completion_tokens"], 100)
        self.assertTrue(action.usage["estimated"])

    def test_model_must_belong_to_the_brain(self):
        with self.assertRaises(ValueError):
            RunConfig(brain="groq", model="claude-opus-5-5").validate()
        with self.assertRaises(ValueError):
            RunConfig(brain="claude", model="openai/gpt-oss-120b").validate()
        RunConfig(brain="groq", model="openai/gpt-oss-20b").validate()
        RunConfig(brain="scripted", model="claude-haiku-5-5").validate()

    def test_unparseable_model_output_is_a_failed_step_not_an_unlogged_crash(self):
        def create(**kw):
            raise BadRequest("Parsing failed", {"error": {"code": "output_parse_failed"}})
        with self._groq(create):
            brain = GroqBrain(get_task("checkout-v2"), model="openai/gpt-oss-20b")
            action = brain.next_action()
            brain.observe(action.error, True)
        self.assertEqual(action.tool, "invalid_tool_call")
        self.assertFalse(action.cost_complete)
        self.assertIn("valid tool call", brain.messages[-1]["content"])

    def test_unrelated_bad_request_still_stops_the_run(self):
        def create(**kw):
            raise BadRequest("Invalid model", {"error": {"code": "invalid_model"}})
        with self._groq(create), self.assertRaises(BadRequest):
            GroqBrain(get_task("prices")).next_action()

    def test_batched_file_output_reaches_model_intact(self):
        with self._groq(lambda **kw: None):
            brain = GroqBrain(get_task("checkout-v2"), model="openai/gpt-oss-20b")
        brain._pending = "batch-1"
        brain._pending_key = 'read_files {"paths":["cart.py","pricing.py"]}'
        output = "--- cart.py ---\n" + "x" * 4500 + "\n--- pricing.py ---\nlast line"
        brain.observe(output, False, summary="read two files")
        self.assertEqual(brain._request_messages()[-1]["content"], output)

    def test_invalid_brain_is_a_validation_error(self):
        with self.assertRaises(ValueError):
            RunConfig(brain=[]).validate()

    def _response(self, content=None, calls=None, finish_reason="stop"):
        usage = SimpleNamespace(prompt_tokens=1000, completion_tokens=6, total_tokens=1006,
                                model_dump=lambda: {"prompt_tokens": 1000, "completion_tokens": 6})
        return SimpleNamespace(model=DEFAULT_MODELS["groq"], usage=usage,
                               choices=[SimpleNamespace(finish_reason=finish_reason,
                                   message=SimpleNamespace(content=content, tool_calls=calls or []))])

    def test_empty_responses_retry_twice_and_preserve_every_calls_usage(self):
        with self._groq(lambda **kw: self._response()):
            brain = GroqBrain(get_task("prices"))
            actions = []
            for _ in range(3):
                action = brain.next_action()
                actions.append(action)
                if action.tool:
                    brain.observe(action.error, True)
        self.assertEqual([a.tool for a in actions], ["empty_model_response", "empty_model_response", None])
        self.assertIn("three consecutive empty", actions[-1].text)
        self.assertEqual(sum(a.tokens for a in actions), 3018)
        self.assertTrue(all(a.cost_complete and a.cost_usd > 0 for a in actions))
        self.assertEqual(actions[0].usage["finish_reason"], "stop")
        self.assertIn("valid tool call", brain.messages[-2]["content"])

    def test_valid_tool_call_after_empty_resets_retry_limit_and_pending_id(self):
        call = SimpleNamespace(id="read-1", function=SimpleNamespace(name="list_files", arguments="{}"))
        replies = iter([self._response(), self._response(), self._response(calls=[call]), self._response()])
        with self._groq(lambda **kw: next(replies)):
            brain = GroqBrain(get_task("prices"))
            for _ in range(2):
                action = brain.next_action()
                brain.observe(action.error, True)
            self.assertEqual(brain.next_action().tool, "list_files")
            brain.observe("files", False)
            self.assertEqual(brain.next_action().tool, "empty_model_response")
            brain.observe("retry", True)
        self.assertEqual(brain.messages[-1]["role"], "user")

    def test_visible_completion_and_filtered_responses_do_not_retry(self):
        for response in [self._response(content="Finished"), self._response(finish_reason="content_filter")]:
            with self._groq(lambda **kw: response):
                action = GroqBrain(get_task("prices")).next_action()
            self.assertIsNone(action.tool)
            self.assertTrue(action.text)


if __name__ == "__main__":
    unittest.main()
