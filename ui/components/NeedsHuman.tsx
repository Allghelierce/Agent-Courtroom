"use client";

// When the court escalates, the engine pauses that worker (up to 10 minutes) until a human
// answers at POST /workers/:id/resolve. This is that human's control.
import Link from "next/link";
import { useState } from "react";
import { ENGINE_URL, type Ruling, type Verdict } from "@/lib/data";
import { useLive, type LiveWorker } from "@/lib/live";
import { PixelIcon } from "./Pieces";
import { Chibi } from "./Sprites";

export function NeedsHuman() {
  const live = useLive();
  const waiting = live.order.map((id) => live.workers[id]).filter((w) => w.status.state === "awaiting_human");
  if (waiting.length === 0) return null;
  return (
    <>
      {waiting.map((w) => (
        <Decision key={w.status.workerId} worker={w} canSend={live.source === "live"} />
      ))}
    </>
  );
}

type Send = { state: "idle" | "sending" | "sent" | "error"; message?: string };

function Decision({ worker: w, canSend }: { worker: LiveWorker; canSend: boolean }) {
  const live = useLive();
  const [instruction, setInstruction] = useState("");
  const [send, setSend] = useState<Send>({ state: "idle" });
  const last = w.rulings.at(-1);
  const trial = last ? live.trialFor(last.workerId, last.chargeId) : undefined;
  const caseId = last?.caseId ?? trial?.id;
  const id = w.status.workerId;
  const busy = send.state === "sending" || send.state === "sent";

  async function decide(ruling: Exclude<Ruling, "escalate">) {
    const verdict: Verdict = {
      ruling,
      reasoning: "Decided by a human in the dashboard.",
      cited_events: last?.verdict.cited_events ?? [],
      ...(ruling === "change_strategy" ? { instruction: instruction.trim() } : {}),
    };
    setSend({ state: "sending" });
    try {
      const res = await fetch(`${ENGINE_URL}/workers/${encodeURIComponent(id)}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(verdict),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return setSend({ state: "sent", message: "Sent. The worker resumes as soon as the engine picks it up." });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setSend({ state: "error", message: res.status === 409 ? "This worker is no longer waiting for a decision." : (body.error ?? `The engine answered ${res.status}.`) });
    } catch (err) {
      setSend({ state: "error", message: `Couldn't reach the engine at ${ENGINE_URL} (${(err as Error).message}).` });
    }
  }

  return (
    <section className="px-box flex flex-col gap-4 p-4" style={{ borderColor: "var(--amber)" }} aria-labelledby={`human-${id}`}>
      <div className="flex flex-wrap items-center gap-4">
        <span className="px-inset shrink-0 p-1">
          <Chibi who="worker" mood="worried" scale={2} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="px-tag pulse-step self-start" style={{ background: "var(--amber)", color: "var(--on-accent)" }}>
            Needs a human
          </span>
          <h2 id={`human-${id}`} className="text-[30px]">
            {id} is paused until you decide
          </h2>
          {last?.verdict.reasoning && <p className="m-0 text-sm text-soft">The court: {last.verdict.reasoning}</p>}
        </div>
        {caseId && (
          <Link href={`/court/${caseId}?view=record`} className="px-btn sm ghost">
            <PixelIcon name="scroll" />
            Read the record
          </Link>
        )}
      </div>

      <label className="flex flex-col gap-2 text-sm" htmlFor={`instr-${id}`}>
        New plan for the worker (only for &ldquo;Give it a new plan&rdquo;)
        <textarea
          id={`instr-${id}`}
          rows={2}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="For example: mock payments.charge in that one test, flag it for review, and finish the rest."
          className="px-inset resize-y p-3 text-[15px] text-text placeholder:text-soft"
          disabled={busy}
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <button type="button" className="px-btn" disabled={!canSend || busy || !instruction.trim()} onClick={() => decide("change_strategy")}>
          Give it a new plan
        </button>
        <button type="button" className="px-btn ghost" disabled={!canSend || busy} onClick={() => decide("continue")}>
          Let it continue
        </button>
        <button type="button" className="px-btn red" disabled={!canSend || busy} onClick={() => decide("halt")}>
          Stop it
        </button>
      </div>

      <p className="m-0 text-sm" aria-live="polite" style={{ color: send.state === "error" ? "#ff8a9a" : "var(--soft)" }}>
        {!canSend ? "Decisions go to a live engine. This is a replay or the engine is disconnected." : send.message ?? ""}
      </p>
    </section>
  );
}
