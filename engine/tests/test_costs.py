import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from courtroom_engine.brains import DEFAULT_MODELS, GroqBrain
from courtroom_engine.costs import model_rates, price_usage
from courtroom_engine.engine import RunConfig, get_task


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

    def test_invalid_brain_is_a_validation_error(self):
        with self.assertRaises(ValueError):
            RunConfig(brain=[]).validate()


if __name__ == "__main__":
    unittest.main()
