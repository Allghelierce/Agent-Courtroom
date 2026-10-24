import json
import queue
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from courtroom_engine.bus import Bus
from courtroom_engine.court import HttpCourt
from courtroom_engine.engine import Engine, RunConfig
from courtroom_engine.schema import Verdict
from courtroom_engine.server import make_handler


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name) / "events.sqlite"
        self.bus = Bus(db_path=self.db)

    def tearDown(self):
        self.bus.close()
        self.temp.cleanup()

    def test_restart_restores_history_cursors_and_reserved_ids(self):
        event_id = self.bus.next_event_id()
        self.bus.publish("event", {"id": event_id, "workerId": "worker-1"})
        reserved = self.bus.next_event_id()  # even an allocated but unpublished ID must not be reused
        worker_id = self.bus.next_worker_id()
        charge_id = self.bus.next_charge_id()
        self.bus.close()
        self.bus = Bus(db_path=self.db)
        self.assertEqual(self.bus.history()[0]["sequence"], 1)
        self.assertEqual(self.bus.next_event_id(), reserved + 1)
        self.assertEqual(self.bus.next_worker_id(), worker_id + 1)
        self.assertEqual(self.bus.next_charge_id(), charge_id + 1)

    def test_duplicate_event_is_idempotent_but_conflict_is_rejected(self):
        _, q = self.bus.subscribe()
        first = self.bus.publish("event", {"id": 42, "workerId": "worker-1", "costUsd": 1})
        self.assertEqual(first, self.bus.publish("event", {"id": 42, "workerId": "worker-1", "costUsd": 1}))
        self.assertEqual(q.qsize(), 1)
        self.assertEqual(len(self.bus.history()), 1)
        self.assertEqual(self.bus.next_event_id(), 43)
        with self.assertRaises(ValueError):
            self.bus.publish("event", {"id": 42, "workerId": "worker-2", "costUsd": 2})

    def test_second_process_owner_cannot_open_same_database(self):
        with self.assertRaisesRegex(ValueError, "already in use"):
            Bus(db_path=self.db)

    def test_replay_and_live_subscription_have_no_gap(self):
        for i in range(10):
            self.bus.publish("event", {"id": i + 1})
        replay, q = self.bus.subscribe(after=4)
        with ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(lambda i: self.bus.publish("event", {"id": i}), range(11, 61)))
        received = replay + [q.get_nowait() for _ in range(q.qsize())]
        self.assertEqual([m["sequence"] for m in received], list(range(5, 61)))

    def test_slow_subscriber_disconnects_and_can_replay(self):
        _, q = self.bus.subscribe()
        for i in range(1001):
            self.bus.publish("event", {"id": i + 1})
        self.assertIsNone(q.get_nowait())
        replay, _ = self.bus.subscribe(after=1000)
        self.assertEqual([m["sequence"] for m in replay], [1001])

    def test_published_data_is_a_snapshot(self):
        status = {"workerId": "one", "state": "running"}
        self.bus.publish("worker", status)
        status["state"] = "succeeded"
        self.assertEqual(self.bus.snapshots()[0]["state"], "running")

    def test_restart_marks_interrupted_worker(self):
        self.bus.publish("worker", {"workerId": "one", "state": "on_trial"})
        self.bus.publish("worker", {"workerId": "two", "state": "succeeded"})
        Engine(self.bus)
        workers = {w["workerId"]: w for w in self.bus.snapshots()}
        self.assertEqual(workers["one"]["state"], "failed")
        self.assertIn("Interrupted", workers["one"]["summary"])
        self.assertEqual(workers["two"]["state"], "succeeded")


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.bus = Bus()
        self.engine = Engine(self.bus)

    def tearDown(self):
        self.bus.close()

    def test_three_workers_have_unique_events_and_independent_outcomes(self):
        cfg = RunConfig(task="prices", max_steps=24)
        workers = [self.engine.create_worker(cfg) for _ in range(3)]
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(lambda w: w.run(), workers))
        self.assertTrue(all(r.state == "succeeded" for r in results))
        events = [m["data"] for m in self.bus.history() if m["type"] == "event"]
        self.assertEqual(len(events), len({e["id"] for e in events}))
        self.assertEqual(len({r.workerId for r in results}), 3)
        self.assertTrue(all(len(w.events) == 19 for w in workers))

    def test_comparison_is_labeled_and_has_frozen_durations(self):
        result = self.engine.compare(RunConfig(task="prices", max_steps=24))
        self.assertEqual(result["costMode"], "simulated")
        self.assertFalse(result["withCourt"]["outcomeVerified"])
        self.assertEqual(result["withCourt"]["state"], "succeeded")
        self.assertEqual(result["withoutCourt"]["state"], "failed")
        worker = self.engine.workers[result["withCourt"]["workerId"]]
        worker.started = 100
        worker.stopped = 102
        self.assertEqual(worker.elapsed_seconds(), 2)
        self.assertEqual(result["withCourt"]["totalCostUsd"], result["withCourt"]["workerCostUsd"])

    def test_cancelled_worker_stops(self):
        worker = self.engine.create_worker(RunConfig(task="prices"))
        worker.cancel()
        self.assertEqual(worker.run().state, "halted")

    def test_invalid_limits_rejected(self):
        for cfg in (RunConfig(budget_usd=float("nan")), RunConfig(max_steps=True), RunConfig(step_delay=-1), RunConfig(all_monitors="yes")):
            with self.assertRaises(ValueError):
                cfg.validate()

    def test_invalid_verdict_rejected(self):
        for data in ([], {"ruling": "change_strategy", "instruction": " "}, {"ruling": "continue", "cited_events": ["1"]}):
            with self.assertRaises(ValueError):
                Verdict.from_json(data)


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.bus = Bus()
        self.engine = Engine(self.bus)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.engine, RunConfig(task="prices")))
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.bus.close()

    def test_sse_reconnect_uses_last_event_id(self):
        for i in range(3):
            self.bus.publish("event", {"id": i + 1})
        req = Request(self.url + "/stream", headers={"Last-Event-ID": "2"})
        with urlopen(req, timeout=2) as response:
            self.assertEqual(response.readline(), b"id: 3\n")
            message = json.loads(response.readline().decode().removeprefix("data: "))
            self.assertEqual(message["data"]["id"], 3)

    def test_worker_snapshots_and_history_available(self):
        self.bus.publish("worker", {"workerId": "old-worker", "state": "succeeded"})
        with urlopen(self.url + "/workers") as response:
            self.assertEqual(json.load(response)[0]["workerId"], "old-worker")
        with urlopen(self.url + "/history?after=1") as response:
            self.assertEqual(json.load(response), [])

    def test_malformed_body_and_cursor_are_400(self):
        requests = [Request(self.url + "/runs", data=b"[]", method="POST"),
                    Request(self.url + "/runs", data=b'{"budgetUsd": -1}', method="POST"),
                    Request(self.url + "/stream", headers={"Last-Event-ID": "bad"})]
        for req in requests:
            with self.assertRaises(HTTPError) as raised:
                urlopen(req)
            self.assertEqual(raised.exception.code, 400)


class CourtClientTests(unittest.TestCase):
    def test_trial_link_and_cost_round_trip(self):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                self.rfile.read(int(self.headers["Content-Length"]))
                self.send_response(200)
                self.send_header("X-Case-Id", "case-123")
                self.end_headers()
                self.wfile.write(b'{"ruling":"continue","reasoning":"ok","cited_events":[1]}')

            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"id":"case-123","workerId":"worker-1","charge":{"id":2},"costUsd":0.125,"mock":false}')

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            court = HttpCourt(f"http://127.0.0.1:{server.server_port}/verdict")
            verdict = court.convene({"charge": {"id": 2, "workerId": "worker-1", "eventIds": [1]}, "events": [{"id": 1}]})
            self.assertEqual(verdict.ruling, "continue")
            self.assertEqual(court.last_case_id, "case-123")
            self.assertEqual(court.last_trial["costUsd"], 0.125)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_unreachable_court_escalates(self):
        court = HttpCourt("http://127.0.0.1:1/verdict", timeout=0.1)
        verdict = court.convene({"charge": {"eventIds": [1]}, "events": [{"id": 1}]})
        self.assertEqual(verdict.ruling, "escalate")
        self.assertIsNone(court.last_trial)


if __name__ == "__main__":
    unittest.main()
