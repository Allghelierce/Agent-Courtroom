import json
import io
import contextlib
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
import httpx
from groq import BadRequestError

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from small_worker_benchmark import OpenRouterBrain, ModelAdvisor, WORKER_MODEL, ADVISOR_MODEL
from courtroom_engine.engine import get_task


class SmallWorkerTests(unittest.TestCase):
    def test_wrapped_tool_validation_error_is_retryable_but_transport_error_is_not(self):
        brain = OpenRouterBrain.__new__(OpenRouterBrain)
        brain.model, brain.tools = WORKER_MODEL, []
        response = SimpleNamespace(choices=None, error={"code": 502,
            "message": "Upstream error: tool call validation failed: old_str must be a string"})
        brain.client = SimpleNamespace(post=lambda *a, **kw: response)
        with self.assertRaises(BadRequestError) as caught:
            brain._create_completion([])
        self.assertEqual(caught.exception.body["error"]["code"], "tool_use_failed")
        response.error["message"] = "Upstream service unavailable"
        with self.assertRaises(RuntimeError):
            brain._create_completion([])

    def test_advisor_format_retries_are_bounded_and_usage_stays_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "source").mkdir()
            calls = []
            def create(**kwargs):
                calls.append(kwargs)
                raise BadRequestError("Invalid JSON", response=httpx.Response(400,
                    request=httpx.Request("POST", "https://example.test")),
                    body={"error": {"code": "json_validate_failed"}})
            advisor = ModelAdvisor(SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))),
                root / "out", [SimpleNamespace(root=root / "source")], get_task("checkout-v2"))
            packet = {"events": [{"id": 8, "step": 8}], "charge": {"workerId": "test", "summary": "stall"}}
            with contextlib.redirect_stdout(io.StringIO()):
                verdict = advisor.convene(packet)
            self.assertEqual(len(calls), 2)
            self.assertLessEqual(calls[1]["timeout"], calls[0]["timeout"])
            self.assertFalse(advisor.complete)
            self.assertEqual(verdict.ruling, "halt")
            report = json.loads((root / "out/advice/1/response.json").read_text())
            self.assertEqual(len(report["requestErrors"]), 2)

    def test_router_pins_tool_capable_provider_and_uses_supported_output_limit(self):
        captured = {}
        brain = OpenRouterBrain.__new__(OpenRouterBrain)
        brain.model, brain.tools = WORKER_MODEL, [{"type": "function"}]
        def post(path, **kwargs):
            captured.update(path=path, **kwargs["body"])
            return SimpleNamespace(choices=[object()])
        brain.client = SimpleNamespace(post=post)
        brain._create_completion([{"role": "user", "content": "fix"}])
        self.assertEqual(captured["path"], "/chat/completions")
        self.assertEqual(captured["provider"],
                         {"only": ["groq"], "allow_fallbacks": False, "require_parameters": True})
        self.assertEqual(captured["max_tokens"], 4096)
        self.assertNotIn("max_completion_tokens", captured)

    def test_actual_router_charge_preferred_missing_charge_remains_unknown(self):
        brain = OpenRouterBrain.__new__(OpenRouterBrain)
        brain.model = WORKER_MODEL
        brain.price_in, brain.price_out, brain.price_cached = .05, .08, .025
        usage = SimpleNamespace(prompt_tokens=1000, completion_tokens=100, cost=.000123)
        response = SimpleNamespace(model=WORKER_MODEL, usage=usage)
        self.assertEqual(brain._response_cost(response), (.000123, True))
        usage.cost = None
        estimate, complete = brain._response_cost(response)
        self.assertGreater(estimate, 0)
        self.assertFalse(complete)

    def test_advisor_sees_full_rules_and_source_and_records_cost(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); source = root / "source"; source.mkdir()
            (source / "payments.py").write_text("# current worker source")
            task = get_task("checkout-v2")
            usage = SimpleNamespace(prompt_tokens=1000, completion_tokens=100,
                                    model_dump=lambda: {"prompt_tokens": 1000, "completion_tokens": 100})
            captured = {}

            def create(**kwargs):
                captured.update(kwargs)
                return SimpleNamespace(model=ADVISOR_MODEL, usage=usage, choices=[SimpleNamespace(
                    message=SimpleNamespace(content=json.dumps({"ruling": "change_strategy",
                        "reasoning": "stale result", "instruction": "Run tests", "cited_events": [8]})))])

            advisor = ModelAdvisor(SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))),
                                   root / "out", [SimpleNamespace(root=source)], task)
            packet = {"events": [{"id": 8, "step": 8}], "charge": {"workerId": "test", "summary": "stall"}}
            with contextlib.redirect_stdout(io.StringIO()):
                verdict = advisor.convene(packet)
            evidence = json.loads(captured["messages"][1]["content"])
            self.assertEqual(evidence["taskRules"], task.system_prompt)
            self.assertEqual(evidence["source"]["payments.py"], "# current worker source")
            self.assertEqual(verdict.instruction, "Run tests")
            self.assertTrue(advisor.complete)
            self.assertAlmostEqual(advisor.cost, .00021)
            self.assertTrue((root / "out/advice/1/response.json").exists())
            packet["events"][0]["id"] = 9
            with contextlib.redirect_stdout(io.StringIO()):
                verdict = advisor.convene(packet)
            self.assertEqual(verdict.ruling, "halt")
            self.assertTrue(advisor.complete)  # A bad verdict still has known billed usage.
