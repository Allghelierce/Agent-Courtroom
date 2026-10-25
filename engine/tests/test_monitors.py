import unittest

from courtroom_engine import monitors
from courtroom_engine.schema import Event
from courtroom_engine.tasks import TASKS

CODING = monitors.MonitorConfig(read_only_tools=TASKS["coding"].read_only_tools)


def events(*tools, passing=5):
    return [
        Event(id=i, workerId="w", step=i, tool=tool, args={"path": f"f{i}.py"}, tokens=0, costUsd=0.0,
              testsPassing=passing, testsTotal=11, timestamp="", result=f"result {i}")
        for i, tool in enumerate(tools, start=1)
    ]


class StallingTests(unittest.TestCase):
    def test_reading_before_the_first_change_is_not_a_stall(self):
        # The real Groq coding worker read every file for 8 steps before its first edit.
        run = events("list_files", "run_tests", *["read_file"] * 6)
        self.assertIsNone(monitors.stalling(run, CODING, 1.0))

    def test_stall_clock_starts_at_the_first_change(self):
        run = events(*["read_file"] * 6, "edit_file", *["read_file"] * 6)
        self.assertIsNone(monitors.stalling(run, CODING, 1.0))
        finding = monitors.stalling(run + events("edit_file"), CODING, 1.0)
        self.assertEqual(finding.kind, "stalling")
        self.assertIn("stuck at 5/11 for 8 steps", finding.summary)

    def test_only_reading_forever_still_gets_charged(self):
        self.assertIsNone(monitors.stalling(events(*["read_file"] * 15), CODING, 1.0))
        finding = monitors.stalling(events(*["read_file"] * 16), CODING, 1.0)
        self.assertEqual(finding.kind, "stalling")
        self.assertIn("16 steps of only reading", finding.summary)

    def test_without_read_only_tools_every_step_counts(self):
        # External agents or tasks that don't list their read-only tools keep the old rule.
        finding = monitors.stalling(events(*["read_file"] * 8), monitors.MonitorConfig(), 1.0)
        self.assertEqual(finding.kind, "stalling")

    def test_progress_after_the_change_is_not_a_stall(self):
        run = events("edit_file", *["read_file"] * 6) + events("run_tests", passing=6)
        self.assertIsNone(monitors.stalling(run, CODING, 1.0))


if __name__ == "__main__":
    unittest.main()
