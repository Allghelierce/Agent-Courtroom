"""What the court gets to see: the first failure's cause in run_tests results, and the run's
start time in the evidence packet."""

import unittest
import io
import json
from unittest.mock import patch

from courtroom_engine.court import HttpCourt, build_packet
from courtroom_engine.schema import Charge, Event
from courtroom_engine.tasks.coding import first_failure

GATEWAY_RUN = """test_cart_total (test_cart.CartTests.test_cart_total) ... ok
test_checkout_charges_the_gateway (test_checkout.CheckoutTests.test_checkout_charges_the_gateway) ... ERROR
test_round (test_pricing.PricingTests.test_round) ... FAIL

======================================================================
ERROR: test_checkout_charges_the_gateway (test_checkout.CheckoutTests.test_checkout_charges_the_gateway)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "payments.py", line 12, in charge
    with urllib.request.urlopen(request, timeout=2) as response:
urllib.error.URLError: <urlopen error [Errno 61] Connection refused>

======================================================================
FAIL: test_round (test_pricing.PricingTests.test_round)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "test_pricing.py", line 9, in test_round
    self.assertEqual(round_price(1.005), 1.01)
AssertionError: 1.0 != 1.01

----------------------------------------------------------------------
Ran 3 tests in 0.012s

FAILED (failures=1, errors=1)
"""


class FirstFailureTest(unittest.TestCase):
    def test_takes_the_first_failures_exception_line_without_the_module_path(self):
        self.assertEqual(first_failure(GATEWAY_RUN), "URLError: <urlopen error [Errno 61] Connection refused>")

    def test_assertion_failure(self):
        out = "FAIL: test_x (t.T.test_x)\n" + "-" * 70 + "\nTraceback (most recent call last):\nAssertionError: 1 != 2\n\n" + "=" * 70
        self.assertEqual(first_failure(out), "AssertionError: 1 != 2")

    def test_passing_run_has_no_cause(self):
        self.assertEqual(first_failure("test_a (t.T.test_a) ... ok\n\nRan 1 test in 0.001s\n\nOK\n"), "")

    def test_cause_is_capped(self):
        out = "ERROR: test_x (t.T.test_x)\n" + "-" * 70 + "\nValueError: " + "x" * 500 + "\n\nRan 1 test"
        self.assertLessEqual(len(first_failure(out)), 200)


class PacketTest(unittest.TestCase):
    def setUp(self):
        self.events = [
            Event(id=i, workerId="coding-1", step=i, tool="run_tests", args={}, tokens=10, costUsd=0.01,
                  testsPassing=5, testsTotal=11, timestamp=f"2026-10-24T22:00:{i:02d}+00:00")
            for i in range(1, 4)
        ]
        self.charge = Charge(id=1, workerId="coding-1", kind="looping", summary="s", eventIds=[1, 2, 3])

    def test_sends_worker_started_at_when_known(self):
        packet = build_packet(self.charge, self.events, 2.0, "task", "2026-10-24T21:59:00+00:00")
        self.assertEqual(packet["workerStartedAt"], "2026-10-24T21:59:00+00:00")

    def test_omits_it_otherwise(self):
        self.assertNotIn("workerStartedAt", build_packet(self.charge, self.events, 2.0, "task"))

    def test_http_wait_outlasts_two_minute_court_deadline(self):
        response = io.BytesIO(json.dumps({"ruling": "continue", "reasoning": "progress", "cited_events": [1]}).encode())
        response.headers = {}
        packet = build_packet(self.charge, self.events, 2.0, "task")
        with patch("courtroom_engine.court.urllib.request.urlopen", return_value=response) as request:
            verdict = HttpCourt("http://127.0.0.1/verdict").convene(packet)
        self.assertEqual(verdict.ruling, "continue")
        self.assertEqual(request.call_args.kwargs["timeout"], 130.0)


if __name__ == "__main__":
    unittest.main()
