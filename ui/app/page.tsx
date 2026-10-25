"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MONITORS, Sparkline } from "@/components/Console";
import { FramedScene } from "@/components/CourtScene";
import { Meter, PixelIcon, RulingTag, StatusTag, WarningLights } from "@/components/Pieces";
import { NeedsHuman } from "@/components/NeedsHuman";
import { Chibi } from "@/components/Sprites";
import { CHARGE_PHRASE, KIND_LABEL, RULING_LABEL, STATE_LABEL, clock, describeEvent, isClaudeSession, usd, type Charge, type Ruling, type Trial } from "@/lib/data";
import { useLive, type FeedItem, type LiveWorker } from "@/lib/live";
import type { Mood } from "@/lib/sprites";
import { DEMO_TRIALS, runCosts, savings, type ComparisonResult, type WorkerResult, type WorkerState } from "@/lib/stream";

export default function Dashboard() {
  const live = useLive();
  const [selected, setSelected] = useState<string | null>(null);
  const isLive = live.source !== "replay";
  const workers = live.order.map((id) => live.workers[id]);
  // Live, the workers still running come first, newest first; a replay keeps the recorded run's order.
  const grid = isLive ? workers.toSorted(byActiveThenNewest) : workers;
  const connected = isLive ? grid.filter(isActive) : [];
  // Lead with the latest time the court stepped in; a "keep going" ruling only if there's nothing else.
  const latest = live.runTrials.findLast((t) => t.verdict.ruling !== "continue") ?? live.runTrials.at(-1);
  // A worker that connected since then leads instead, so you can see the court picked it up.
  const fresh = connected[0] && (!latest || startedMs(connected[0]) > Date.parse(latest.startedAt)) ? connected[0] : undefined;
  const [inSession, ...alsoInSession] = live.openCharges;

  return (
    <div className="flex flex-col gap-8">
      {/* A worker paused for a human decision outranks everything else on the page. */}
      <NeedsHuman />
      {inSession ? (
        <InSession key={`${inSession.workerId}-${inSession.id}`} charge={inSession} trial={live.trialFor(inSession.workerId, inSession.id ?? 0)} others={alsoInSession} />
      ) : fresh ? (
        <Connected worker={fresh} others={connected.slice(1)} trial={latest} />
      ) : latest ? (
        <LatestCase trial={latest} />
      ) : (
        <QuietCourt />
      )}

      <div className="flex flex-col gap-4">
        <RunStatus />
        <Impact />
      </div>

      <ComparisonPanel comparison={live.comparison} error={live.comparisonError} />

      <MonitorsPanel />

      <section aria-labelledby="workers-h" className="flex flex-col gap-4">
        <h2 id="workers-h" className="text-[30px]">Workers</h2>
        {grid.length === 0 ? (
          <p className="px-box m-0 p-6 text-soft">Waiting for the first worker to start...</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {grid.map((w) => (
              <WorkerCard key={w.status.workerId} worker={w} selected={selected === w.status.workerId} onSelect={() => setSelected(selected === w.status.workerId ? null : w.status.workerId)} />
            ))}
          </div>
        )}
      </section>

      <Interventions />

      <ActivityFeed only={selected} onClear={() => setSelected(null)} />
    </div>
  );
}

// ---------- court in session ----------

// The courtroom scene is a way in: clicking it opens the trial, like zooming into the court.
function SceneLink({ href, children }: { href?: string; children: React.ReactNode }) {
  if (!href) return <div className="self-start">{children}</div>;
  return (
    <Link href={href} className="block self-start hover:brightness-110" aria-label="Open the courtroom" title="Open the courtroom">
      {children}
    </Link>
  );
}

function evidenceLabel(ids: number[]): string {
  if (ids.length <= 3) return ids.map((n) => `#${n}`).join(", ");
  return `${ids.length} events`;
}

const TURNS = ["pros", "def", "judge"] as const;

// While the court deliberates, the courtroom itself is the headline: the lawyers and the judge take turns.
function InSession({ charge, trial, others }: { charge: Charge; trial?: Trial; others: Charge[] }) {
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTurn((n) => (n + 1) % TURNS.length), 1600);
    return () => clearInterval(timer);
  }, []);
  const looping = charge.kind === "looping";

  return (
    <section className="px-box grid grid-cols-[minmax(0,1fr)] gap-6 p-4 md:p-6 lg:grid-cols-[520px_minmax(0,1fr)]" style={{ borderColor: "var(--red)" }} aria-labelledby="session-h" aria-live="polite">
      <SceneLink href={trial && `/court/${trial.id}`}>
        <FramedScene speaker={TURNS[turn]} moods={{ pros: "angry", def: "shout", worker: looping ? "dizzy" : "worried" }} swirl={looping} workerLabel={charge.workerId} maxScale={2} />
      </SceneLink>
      <div className="flex flex-col justify-center gap-4">
        <span className="px-tag pulse-step self-start" style={{ background: "var(--red)", color: "var(--on-accent)" }}>
          Court is in session
        </span>
        <h1 id="session-h" className="text-[40px]">
          {charge.workerId} is charged with {CHARGE_PHRASE[charge.kind]}
        </h1>
        <p className="m-0 line-clamp-3">{charge.summary}</p>
        <p className="m-0 text-sm text-soft">
          The worker is paused. The prosecution and the defense argue from its log ({evidenceLabel(charge.eventIds)}), then the judge rules.
        </p>
        {trial && (
          <div className="flex flex-wrap gap-3">
            <Link href={`/court/${trial.id}`} className="px-btn red">
              <PixelIcon name="gavel" />
              Watch the trial
            </Link>
            <Link href={`/court/${trial.id}?view=record`} className="px-btn ghost">
              <PixelIcon name="scroll" />
              Read the record
            </Link>
          </div>
        )}
        {others.length > 0 && (
          <p className="m-0 text-sm text-soft">Also in session: {others.map((c) => `${c.workerId} (${KIND_LABEL[c.kind].toLowerCase()})`).join(", ")}.</p>
        )}
      </div>
    </section>
  );
}

function LatestCase({ trial }: { trial: Trial }) {
  return (
    <section className="px-box grid grid-cols-[minmax(0,1fr)] gap-6 p-4 md:p-6 lg:grid-cols-[520px_minmax(0,1fr)]" aria-labelledby="latest-h">
      <SceneLink href={`/court/${trial.id}`}>
        <FramedScene speaker="judge" moods={{ worker: trial.verdict.ruling === "halt" ? "worried" : "happy", pros: "angry", def: "neutral" }} swirl={false} workerLabel={trial.workerId} maxScale={2} />
      </SceneLink>
      <div className="flex flex-col justify-center gap-4">
        <span className="text-sm text-soft">Latest intervention</span>
        <h1 id="latest-h" className="text-[40px]">
          {trial.workerId} was charged with {CHARGE_PHRASE[trial.charge.kind]}
        </h1>
        <p className="m-0 line-clamp-3">{trial.charge.summary}</p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">The court ruled</span>
          <RulingTag ruling={trial.verdict.ruling} />
          {trial.summary && <span className="text-sm text-soft">by summary judgment, without a trial</span>}
        </div>
        {trial.verdict.instruction && (
          <div className="flex flex-col gap-1">
            <span className="text-sm text-soft">Sent to the worker&apos;s next prompt</span>
            <div className="px-inset p-3">
              <p className="m-0 line-clamp-4 text-sm">{trial.verdict.instruction}</p>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <Link href={`/court/${trial.id}`} className="px-btn red">
            <PixelIcon name="gavel" />
            {trial.summary ? "See the ruling" : "Watch the trial"}
          </Link>
          <Link href={`/court/${trial.id}?view=record`} className="px-btn ghost">
            <PixelIcon name="scroll" />
            Read the record
          </Link>
        </div>
      </div>
    </section>
  );
}

// The courtroom is always one click away: the recorded looping trial is the clearest example of what the court does.
const SAMPLE_TRIAL = DEMO_TRIALS.find((t) => t.verdict.ruling === "change_strategy") ?? DEMO_TRIALS[0];

const isActive = (w: LiveWorker) => !w.status.endedAt;
const startedMs = (w: LiveWorker) => Date.parse(w.status.startedAt) || 0;
function byActiveThenNewest(a: LiveWorker, b: LiveWorker): number {
  return Number(!isActive(a)) - Number(!isActive(b)) || startedMs(b) - startedMs(a);
}

function Connected({ worker: w, others, trial }: { worker: LiveWorker; others: LiveWorker[]; trial?: Trial }) {
  const s = w.status;
  const session = isClaudeSession(s.workerId);
  const example = trial ?? SAMPLE_TRIAL;
  return (
    <section className="px-box grid grid-cols-[minmax(0,1fr)] gap-6 p-4 md:p-6 lg:grid-cols-[520px_minmax(0,1fr)]" style={{ borderColor: "var(--green)" }} aria-labelledby="connected-h" aria-live="polite">
      <SceneLink href={example && `/court/${example.id}`}>
        <FramedScene speaker={null} moods={{ worker: "happy", judge: "happy" }} workerLabel={s.workerId} maxScale={2} />
      </SceneLink>
      <div className="flex flex-col justify-center gap-4">
        <span className="px-tag self-start" style={{ background: "var(--green)", color: "var(--on-accent)" }}>
          {session ? "Session connected" : "Worker started"}
        </span>
        <h1 id="connected-h" className="text-[40px]">
          {s.workerId} is {session ? "connected" : "running"}
        </h1>
        {s.task && <p className="m-0 line-clamp-2">{s.task}</p>}
        <p className="m-0 text-sm text-soft">
          Step {s.step} · {usd(s.costUsd)} of {usd(s.budgetUsd)} spent. The monitors check every step for free, and the court convenes only if one flags this {session ? "session" : "worker"}.
        </p>
        {others.length > 0 && <p className="m-0 text-sm text-soft">Also connected: {others.map((o) => o.status.workerId).join(", ")}.</p>}
        {example && (
          <div className="flex flex-wrap gap-3">
            <Link href={`/court/${example.id}`} className="px-btn ghost">
              <PixelIcon name="gavel" />
              {trial ? "Watch the latest trial" : "Watch a sample trial"}
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

function QuietCourt() {
  const live = useLive();
  return (
    <section className="px-box grid grid-cols-[minmax(0,1fr)] gap-6 p-4 md:p-6 lg:grid-cols-[520px_minmax(0,1fr)]" aria-labelledby="quiet-h">
      <SceneLink href={SAMPLE_TRIAL && `/court/${SAMPLE_TRIAL.id}`}>
        <FramedScene speaker={null} moods={{ worker: "happy", judge: "happy" }} workerLabel="a worker" maxScale={2} />
      </SceneLink>
      <div className="flex flex-col justify-center gap-4">
        <h1 id="quiet-h" className="text-[40px]">The court is waiting</h1>
        <p className="m-0">
          Cheap code monitors check every step each worker takes. Court only convenes when one of them flags a worker that is looping, stuck, overspending, or flailing.
        </p>
        <div className="flex flex-wrap gap-3">
          {SAMPLE_TRIAL && (
            <Link href={`/court/${SAMPLE_TRIAL.id}`} className="px-btn red">
              <PixelIcon name="gavel" />
              Watch a sample trial
            </Link>
          )}
          {(live.source === "live" || live.source === "disconnected") && (
            <button type="button" className="px-btn ghost" onClick={live.playDemo}>
              Play the recorded demo
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------- run status and headline numbers ----------

function RunStatus() {
  const live = useLive();
  const label = {
    connecting: "Connecting to the engine...",
    live: "Live from the engine",
    disconnected: "Disconnected from the engine, showing the last data received",
    replay: live.demoChosen ? "Recorded demo (the engine is running)" : "Demo replay of a recorded run",
  }[live.source];
  const dot = { connecting: "var(--soft)", live: "var(--green)", disconnected: "var(--amber)", replay: "var(--blue)" }[live.source];
  // Live, say who's connected, so a new Claude Code session visibly registers.
  const workerIds = Object.keys(live.workers);
  const active = live.order.filter((id) => isActive(live.workers[id]));
  const sessions = workerIds.length > 0 && workerIds.every(isClaudeSession);
  const plural = active.length === 1 ? "" : "s";
  const who =
    live.source !== "live"
      ? ""
      : active.length > 0
        ? `, ${active.length} ${sessions ? `Claude Code session${plural} connected` : `worker${plural} running`}`
        : sessions
          ? ", no Claude Code session connected"
          : ", waiting for a worker to start";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm text-soft">
        <span aria-hidden className={`inline-block size-2.5 ${live.source === "live" ? "pulse-step" : ""}`} style={{ background: dot }} />
        {label}
        {who}
        {live.source === "replay" ? `, ${Math.round(live.progress * 100)}%` : ""}
      </span>
      {(live.source === "live" || live.source === "disconnected") && (
        <button type="button" className="px-btn sm ghost" onClick={live.playDemo}>
          Play the recorded demo
        </button>
      )}
      {live.source === "replay" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="px-btn sm ghost" onClick={() => live.setPlaying(!live.playing)}>
            {live.playing ? "Pause" : "Play"}
          </button>
          {[1, 2, 4].map((s) => (
            <button key={s} type="button" className={`px-btn sm ${live.speed === s ? "" : "ghost"}`} aria-pressed={live.speed === s} onClick={() => live.setSpeed(s)}>
              {s}x
            </button>
          ))}
          <button type="button" className="px-btn sm ghost" onClick={live.restart}>
            Restart
          </button>
          {live.demoChosen && (
            <button type="button" className="px-btn sm" onClick={live.goLive}>
              Back to the live engine
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function countBy<T extends string>(items: T[]): [T, number][] {
  const m = new Map<T, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m.entries()];
}

// What the judges should take away: money saved, how often the court stepped in, and what oversight cost.
function Impact() {
  const live = useLive();
  const workers = Object.values(live.workers);
  const steps = workers.reduce((s, w) => s + w.events.length, 0);
  const courtSpend = live.runTrials.reduce((s, t) => s + t.costUsd, 0);
  const mock = live.runTrials.some((t) => t.mock);
  const cmp = live.comparison;
  const saved = cmp ? savings(cmp) : null;
  const rulings = countBy<Ruling>(live.runTrials.map((t) => t.verdict.ruling));
  const states = countBy<WorkerState>(workers.map((w) => w.status.state));

  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Impact">
      <Figure
        label="Saved vs. running unsupervised"
        value={saved ? usd(saved.usd) : cmp ? "Incomplete" : "–"}
        accent={saved && saved.usd > 0 ? "var(--green)" : undefined}
        detail={
          saved && cmp
            ? `${Math.round(saved.percent)}% less than the same task without the court, which ${cmp.withoutCourt.state === "succeeded" ? "also finished" : "never finished"}.`
            : cmp
              ? "Some court costs weren't reported, so the total is incomplete."
              : "Appears when the same task, run without the court, finishes."
        }
      />
      <Figure
        label="Interventions"
        value={String(live.runTrials.length)}
        detail={rulings.length ? rulings.map(([r, n]) => `${n} ${RULING_LABEL[r].toLowerCase()}`).join(" · ") : "No trials yet."}
      />
      <Figure
        label="Cost of oversight"
        value={usd(courtSpend)}
        detail={`Monitors checked ${steps} step${steps === 1 ? "" : "s"} for free.${mock ? " The court ran in mock mode." : " Only trials call a model."}`}
      />
      <Figure label="Workers" value={String(workers.length)} detail={states.map(([s, n]) => `${n} ${STATE_LABEL[s].toLowerCase()}`).join(" · ") || "None yet."} />
    </section>
  );
}

function Figure({ label, value, detail, accent }: { label: string; value: string; detail: string; accent?: string }) {
  return (
    <div className="px-box flex flex-col gap-1 p-4">
      <span className="text-sm text-soft">{label}</span>
      <span className="text-[32px] font-semibold leading-tight" style={{ color: accent }}>
        {value}
      </span>
      <span className="text-[13px] leading-snug text-soft">{detail}</span>
    </div>
  );
}

// ---------- with vs. without the court ----------

function minutes(s?: number): string {
  if (!s) return "";
  return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
}

function ComparisonPanel({ comparison, error }: { comparison?: ComparisonResult; error?: string }) {
  if (!comparison) {
    return (
      <section className="px-box flex flex-col gap-2 p-6" aria-labelledby="cmp-h">
        <h2 id="cmp-h" className="text-[30px]">With the court vs. without it</h2>
        <p className="m-0" style={{ color: error ? "var(--amber)" : "var(--soft)" }}>
          {error ? `The comparison run failed: ${error}` : "The same task also runs once with the court turned off. The comparison appears here when both runs finish."}
        </p>
      </section>
    );
  }
  const { withCourt: a, withoutCourt: b } = comparison;
  const scale = Math.max(runCosts(a).total ?? a.costUsd, runCosts(b).total ?? b.costUsd, a.budgetUsd);
  const saved = savings(comparison);
  return (
    <section className="px-box flex flex-col gap-5 p-6" aria-labelledby="cmp-h">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="cmp-h" className="text-[30px]">With the court vs. without it</h2>
          {comparison.costMode === "simulated" && <span className="px-tag" style={{ background: "var(--inset)", color: "var(--soft)" }}>Simulated costs</span>}
        </div>
        <p className="m-0 font-semibold" style={{ color: "var(--gold)" }}>
          {saved === null ? "Savings incomplete: some court costs weren't reported" : saved.usd > 0 ? `The court saved ${usd(saved.usd)} (${Math.round(saved.percent)}%)` : "Same cost either way"}
          {a.state === "succeeded" && b.state !== "succeeded" ? " and the task finished" : ""}
        </p>
      </div>
      <RunRow label="With the court" run={a} scale={scale} />
      <RunRow label="Without the court" run={b} scale={scale} />
    </section>
  );
}

function RunRow({ label, run, scale }: { label: string; run: WorkerResult; scale: number }) {
  const ok = run.state === "succeeded";
  const cost = runCosts(run);
  const cells = 24;
  const budgetCell = Math.round((run.budgetUsd / scale) * cells);
  const filled = Math.round(((cost.total ?? run.costUsd) / scale) * cells);
  return (
    <div className="grid gap-2 md:grid-cols-[150px_minmax(0,1fr)_170px] md:items-center">
      <span className="font-medium">{label}</span>
      <div className="flex flex-col gap-1">
        <div className="flex gap-1" role="meter" aria-label={`${label}: spend`} aria-valuenow={cost.total ?? run.costUsd} aria-valuemin={0} aria-valuemax={scale}>
          {Array.from({ length: cells }, (_, i) => (
            <span key={i} className="h-4 flex-1 border-2 border-edge" style={{ background: i < filled ? (i >= budgetCell ? "var(--red)" : "var(--amber)") : "var(--inset)" }} />
          ))}
        </div>
        <span className="text-[13px] text-soft">
          {cost.total === null ? "Total incomplete" : usd(cost.total)}
          {cost.court !== undefined ? ` (worker ${usd(cost.worker)} + court ${usd(cost.court)}${cost.courtComplete ? "" : " + unknown"})` : ""} of a {usd(run.budgetUsd)} budget · {run.testsPassing}/{run.testsTotal} tests · {minutes(run.seconds)}
        </span>
        {run.summary && <span className="text-[13px]">{run.summary}</span>}
      </div>
      <span className="px-tag justify-self-start md:justify-self-end" style={{ background: ok ? "var(--green)" : "var(--red)", color: "var(--on-accent)" }}>
        {ok ? "Finished" : run.summary?.startsWith("Ran out of budget") ? "Ran out of budget" : "Did not finish"}
      </span>
    </div>
  );
}

// ---------- how the watching works ----------

function MonitorsPanel() {
  return (
    <section className="flex flex-col gap-4" aria-labelledby="mon-h">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="mon-h" className="text-[30px]">Monitors</h2>
        <span className="text-sm text-soft">Plain code on every step, no model calls. Court convenes only when one fires.</span>
      </div>
      <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {MONITORS.map((m) => (
          <li key={m.kind} className="px-box flex flex-col gap-1 p-4">
            <span className="font-display text-[20px]">{KIND_LABEL[m.kind]}</span>
            <span className="text-[13px] leading-snug text-soft">{m.rule}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- workers ----------

function moodFor(w: LiveWorker): Mood {
  const open = w.charges.at(-1);
  switch (w.status.state) {
    case "running":
    case "succeeded":
      return "happy";
    case "on_trial":
      return open?.kind === "looping" ? "dizzy" : "worried";
    default:
      return "worried";
  }
}

function WorkerCard({ worker: w, selected, onSelect }: { worker: LiveWorker; selected: boolean; onSelect: () => void }) {
  const live = useLive();
  const s = w.status;
  const last = w.events.at(-1);
  const lastCharge = w.charges.at(-1);
  const lastRuling = w.rulings.at(-1);
  const trial = lastCharge ? live.trialFor(s.workerId, lastCharge.id ?? 0) : undefined;
  const open = live.openCharges.filter((c) => c.workerId === s.workerId).map((c) => c.kind);
  const lights = s.state === "halted" && lastCharge ? [lastCharge.kind] : open;
  const onTrial = s.state === "on_trial";

  return (
    <article
      className="px-box flex flex-col gap-4 p-4"
      style={{ borderColor: onTrial ? "var(--red)" : undefined, outline: selected ? "4px solid var(--gold)" : undefined, outlineOffset: 4 }}
    >
      <button type="button" onClick={onSelect} aria-pressed={selected} className="flex cursor-pointer items-start gap-3 border-0 bg-transparent p-0 text-left text-text">
        <span className="px-inset shrink-0 p-1">
          <Chibi who="worker" mood={moodFor(w)} scale={2} />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className={`font-display leading-none ${s.workerId.length > 12 ? "text-[20px]" : "text-[30px]"}`}>{s.workerId}</span>
          <span className="text-sm text-soft">Step {s.step}</span>
          <StatusTag state={s.state} />
        </span>
      </button>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>Tests</span>
          <span className="flex items-center gap-2 whitespace-nowrap">
            <span title="Tests passing over the run">
              <Sparkline events={w.events} total={s.testsTotal} width={56} height={16} />
            </span>
            {s.testsPassing}/{s.testsTotal}
          </span>
        </div>
        <Meter value={s.testsPassing} max={s.testsTotal} color="var(--green)" label={`${s.workerId} tests passing`} />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-sm">
          <span>{s.costMode === "simulated" ? "Simulated spend" : "Spend"}</span>
          <span className="whitespace-nowrap">{usd(s.costUsd)} of {usd(s.budgetUsd)}</span>
        </div>
        <Meter value={s.costUsd} max={s.budgetUsd} cells={20} color={s.costUsd / s.budgetUsd > 0.8 ? "var(--red)" : "var(--amber)"} label={`${s.workerId} spend`} />
      </div>

      <WarningLights lit={lights} />

      {lastRuling && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-soft">Ruling</span>
          <RulingTag ruling={lastRuling.verdict.ruling} />
        </div>
      )}

      <p className="m-0 line-clamp-2 text-sm text-soft">{s.summary ?? (last ? `Last step: ${describeEvent(last)}` : "Starting up...")}</p>

      {trial && (
        <Link href={`/court/${trial.id}`} className={`px-btn ${onTrial ? "red" : "ghost"} mt-auto justify-center`}>
          <PixelIcon name="gavel" />
          Watch the trial
        </Link>
      )}
    </article>
  );
}

// ---------- interventions ----------

function Interventions() {
  const live = useLive();
  const pending = live.openCharges.map((c) => ({ charge: c, trial: live.trialFor(c.workerId, c.id ?? 0), ruled: false }));
  const ruled = live.runTrials.map((t) => ({ charge: t.charge, trial: t as Trial | undefined, ruled: true }));
  const rows = [...pending, ...ruled.toReversed()];

  return (
    <section aria-labelledby="int-h" className="flex flex-col gap-4">
      <h2 id="int-h" className="text-[30px]">Interventions</h2>
      <div className="px-box overflow-x-auto">
        {rows.length === 0 ? (
          <p className="m-0 p-4 text-sm text-soft">No monitor has flagged a worker yet.</p>
        ) : (
          <table className="px-table">
            <thead>
              <tr>
                <th>Worker</th>
                <th>Charge</th>
                <th>Evidence</th>
                <th>Ruling</th>
                <th>Instruction sent to the worker</th>
                <th>Court cost</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ charge, trial, ruled }) => (
                <tr key={`${charge.workerId}-${charge.id}`}>
                  <td className="max-w-[180px] font-semibold">{charge.workerId}</td>
                  <td>{KIND_LABEL[charge.kind]}</td>
                  <td className="whitespace-nowrap text-soft">{evidenceLabel(charge.eventIds)}</td>
                  <td>
                    {ruled && trial ? (
                      <span className="flex flex-col items-start gap-1">
                        <RulingTag ruling={trial.verdict.ruling} />
                        {trial.summary && <span className="text-[12px] text-soft">Summary judgment</span>}
                      </span>
                    ) : (
                      <span className="px-tag pulse-step" style={{ background: "var(--red)", color: "var(--on-accent)" }}>
                        In session
                      </span>
                    )}
                  </td>
                  <td className="max-w-[300px]">
                    <span className="line-clamp-2 text-soft">{ruled ? (trial?.verdict.instruction ?? "None: the worker carries on as before.") : "Waiting for the Judge"}</span>
                  </td>
                  <td className="whitespace-nowrap">{trial && ruled ? `${usd(trial.costUsd)}${trial.mock ? " (mock)" : ""}` : ""}</td>
                  <td>
                    {trial && (
                      <span className="flex justify-end gap-2">
                        <Link href={`/court/${trial.id}?view=record`} className="px-btn sm ghost">Record</Link>
                        <Link href={`/court/${trial.id}`} className="px-btn sm ghost">{trial.summary ? "Ruling" : "Watch"}</Link>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

// ---------- activity ----------

const TONE_COLOR: Record<FeedItem["tone"], string> = {
  start: "var(--green)",
  event: "var(--edge)",
  fail: "var(--red)",
  charge: "var(--red)",
  verdict: "var(--gold)",
  done: "var(--green)",
};

function ActivityFeed({ only, onClear }: { only: string | null; onClear: () => void }) {
  const live = useLive();
  const rows = live.feed.filter((r) => !only || r.workerId === only).slice(0, 60);
  return (
    <section aria-labelledby="feed-h" className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <h2 id="feed-h" className="text-[30px]">Activity{only ? ` for ${only}` : ""}</h2>
        {only && (
          <button type="button" className="px-btn sm ghost" onClick={onClear}>
            Show all workers
          </button>
        )}
      </div>
      <ol className="px-box m-0 flex max-h-[420px] list-none flex-col overflow-y-auto p-0">
        {rows.length === 0 && <li className="px-4 py-3 text-sm text-soft">Nothing yet.</li>}
        {rows.map((r, i) => {
          const trial = r.charge ? live.trialFor(r.charge.workerId, r.charge.id) : undefined;
          return (
            <li key={r.seq} className="grid grid-cols-[12px_92px_120px_1fr] items-baseline gap-3 px-4 py-2 text-sm" style={{ background: i % 2 ? "var(--inset)" : undefined }}>
              <span aria-hidden className="inline-block size-2.5" style={{ background: TONE_COLOR[r.tone] }} />
              <span className="text-soft">{clock(r.at)}</span>
              <span className="truncate" title={r.workerId}>{r.workerId}</span>
              {trial ? (
                <Link href={`/court/${trial.id}`} className="min-w-0 font-semibold underline decoration-2 underline-offset-4">
                  {r.text}
                </Link>
              ) : (
                <span className="min-w-0" style={{ color: r.tone === "fail" ? "#ff8a9a" : r.tone === "done" ? "var(--green)" : undefined }}>
                  {r.text}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
