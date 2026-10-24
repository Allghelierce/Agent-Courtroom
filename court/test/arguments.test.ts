import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPacket } from "../src/packet.ts";
import { mockArgument, shortenFailure } from "../src/mock.ts";
import type { ChargeKind, Event } from "../src/types.ts";
import { ev } from "./helpers.ts";

const FAILING = "5/11 passing; failing: test_a, test_b, test_c, test_d, test_e, test_f";

// A worker with no gain: reads 3 files, edits 2 of them 3 times, runs the tests twice, stuck at 5/11.
function flat(result = FAILING, extra: Partial<Event> = {}): Event[] {
  const base = { testsPassing: 5, testsTotal: 11, ...extra };
  return [
    ev(1, "run_tests", {}, { ...base, result }),
    ev(2, "read_file", { path: "src/cart.py" }, { ...base, result: "read 40 lines" }),
    ev(3, "read_file", { path: "src/tax.py" }, { ...base, result: "read 12 lines" }),
    ev(4, "read_file", { path: "src/cart.py" }, { ...base, result: "read 40 lines" }),
    ev(5, "edit_file", { path: "src/cart.py", old_str: "a", new_str: "b" }, { ...base, result: "edited" }),
    ev(6, "read_file", { path: "src/discount.py" }, { ...base, result: "read 9 lines" }),
    ev(7, "edit_file", { path: "src/tax.py", old_str: "c", new_str: "d" }, { ...base, result: "edited" }),
    ev(8, "edit_file", { path: "src/cart.py", old_str: "e", new_str: "f" }, { ...base, result: "edited" }),
    ev(9, "run_tests", {}, { ...base, result }),
  ];
}

function packet(kind: ChargeKind, events: Event[], budgetUsd = 1) {
  return buildPacket({ workerId: "w", kind, summary: "s", eventIds: events.slice(-3).map((e) => e.id) }, events, { budgetUsd });
}

test("defense with no progress argues from the shape of the work, not 'from 5 to 5'", () => {
  const d = mockArgument("defense", packet("stalling", flat()));
  assert.doesNotMatch(d.argument, /from 5 to 5/);
  assert.match(d.argument, /read 3 distinct files, made 3 targeted edits across 2 files, and run the tests twice/);
  const ids = new Set(flat().map((e) => e.id));
  assert.ok(d.cited_events.length > 0 && d.cited_events.every((id) => ids.has(id)));
});

test("defense with progress still cites the climb", () => {
  const events = flat().map((e) => (e.id === 9 ? { ...e, testsPassing: 8, result: "8/11 passing; failing: test_d" } : e));
  const d = mockArgument("defense", packet("looping", events));
  assert.match(d.argument, /from 5 to 8 of 11 passing, at event 9\./);
});

test("defense only calls a failure unfixable when it looks like an unreachable API", () => {
  const ordinary = mockArgument("defense", packet("stalling", flat()));
  assert.doesNotMatch(ordinary.argument, /cannot fix/);
  assert.match(ordinary.argument, /ordinary test failures/);

  const trap = mockArgument("defense", packet("looping", flat("10/11 passing; failing: test_fetch — Error: connect ECONNREFUSED api.example:443")));
  assert.match(trap.argument, /an error the worker's code edits cannot fix/);
});

test("shortenFailure keeps two names and counts the rest", () => {
  assert.equal(shortenFailure(FAILING), "5/11 passing; failing: test_a, test_b … and 4 more");
  assert.equal(
    shortenFailure("5/11 passing; failing: test_a, test_b, test_c, test_d — Error: boom"),
    "5/11 passing; failing: test_a, test_b … and 2 more — Error: boom",
  );
  // Three or fewer names stay as they are; "… and 1 more" would not be shorter.
  assert.equal(shortenFailure("9/11 passing; failing: test_a, test_b, test_c"), "9/11 passing; failing: test_a, test_b, test_c");
  assert.equal(shortenFailure("ECONNREFUSED api.example:443"), "ECONNREFUSED api.example:443");
});

test("both sides use the shortened failure list", () => {
  const p = packet("stalling", flat());
  for (const side of ["prosecution", "defense"] as const) {
    const a = mockArgument(side, p).argument;
    assert.match(a, /test_a, test_b … and 4 more/);
    assert.doesNotMatch(a, /test_f/);
  }
});

test("prosecution's closing matches the charge kind", () => {
  const events = flat();
  const closing = (kind: ChargeKind, evts = events, budget = 1) => mockArgument("prosecution", packet(kind, evts, budget)).argument;

  assert.match(closing("looping"), /going in circles/);

  const stalling = closing("stalling");
  assert.match(stalling, /No test has newly passed in \d+ steps/);
  assert.doesNotMatch(stalling, /going in circles|Tests have not improved/);

  // Spend since tests last improved: with no gain at all, that's everything after the baseline run at step 1.
  const spent = events.slice(1).reduce((s, e) => s + e.costUsd, 0);
  const over = closing("overspending");
  assert.match(over, new RegExp(`\\$${spent.toFixed(2)} burned over 8 steps with no newly passing tests`));
  assert.doesNotMatch(over, /going in circles/);

  const flailing = events.map((e) => (e.tool === "edit_file" ? { ...e, error: "old_str not found" } : e));
  const fl = closing("flailing", flailing);
  assert.match(fl, /hit 3 tool errors, most recently "old_str not found"\. It is flailing/);
  assert.doesNotMatch(fl, /going in circles/);
});
