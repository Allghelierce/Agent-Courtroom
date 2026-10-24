import type { ChargeKind, Ruling, Trial } from "@court/types";
import { CHARGE_PHRASE, RULING_LABEL } from "./data";
import type { CastKey, Mood } from "./sprites";
import type { WorkerStatus } from "./stream";

export type Line = {
  who: CastKey;
  mood: Mood;
  text: string;
  burst?: { text: string; tone: "red" | "blue" };
  cites?: number[];
  verdict?: boolean; // the ruling line: the stamp lands here
  moods: Partial<Record<"judge" | "pros" | "def" | "worker", Mood>>; // how everyone else looks during this line
};

// The UI writes only the clerk's opening and the worker's short lines. Everything else is the court's own text (ART.md, "Voice").
const WORKER_PLEA: Record<ChargeKind, string> = {
  looping: "I-I just need one more try... maybe one more retry will fix it...",
  stalling: "I'm thinking really hard, I promise! The next edit is the one!",
  overspending: "Th-those tokens were an investment!",
  flailing: "Okay, new approach. No wait, another new approach...",
};

const WORKER_REACTION: Record<Ruling, { mood: Mood; text: string }> = {
  continue: { mood: "happy", text: "Thank you, Your Honor! Back to work!" },
  change_strategy: { mood: "happy", text: "Understood! Switching strategy right now." },
  escalate: { mood: "worried", text: "Okay... I'll wait here until a human checks in." },
  halt: { mood: "worried", text: "Understood. Saving my work and shutting down..." },
};

function sentence(s: string): string {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

// The worker's last line reports how its run actually ended, when we know.
function reactionFor(ruling: Ruling, outcome?: WorkerStatus): { mood: Mood; text: string } {
  const base = WORKER_REACTION[ruling];
  if (outcome?.state !== "succeeded") return base;
  const tests = `${outcome.testsPassing} of ${outcome.testsTotal} tests passing now!`;
  if (ruling === "change_strategy") return { mood: "happy", text: `Understood! New strategy... and ${tests}` };
  if (ruling === "continue") return { mood: "happy", text: `Thank you, Your Honor! Back to work... and ${tests}` };
  return base;
}

export function buildScript(trial: Trial, outcome?: WorkerStatus): Line[] {
  const kind = trial.charge.kind;
  const stuck: Mood = kind === "looping" ? "dizzy" : "worried";
  const reaction = reactionFor(trial.verdict.ruling, outcome);
  const ruling = `The court rules: ${RULING_LABEL[trial.verdict.ruling].toLowerCase()}!${trial.verdict.instruction ? ` ${trial.verdict.instruction}` : ""}`;

  return [
    {
      who: "clerk",
      mood: "neutral",
      text: `Court is now in session. ${trial.workerId} stands charged with ${CHARGE_PHRASE[kind]}. ${sentence(trial.charge.summary)}`,
      cites: trial.charge.eventIds,
      moods: { worker: stuck },
    },
    {
      who: "pros",
      mood: "angry",
      burst: { text: "OBJECTION!", tone: "red" },
      text: trial.prosecution.argument,
      cites: trial.prosecution.cited_events,
      moods: { pros: "angry", worker: stuck, def: "worried" },
    },
    {
      who: "worker",
      mood: stuck,
      text: WORKER_PLEA[kind],
      moods: { worker: stuck, pros: "angry" },
    },
    {
      who: "def",
      mood: "shout",
      burst: { text: "HOLD IT!", tone: "blue" },
      text: trial.defense.argument,
      cites: trial.defense.cited_events,
      moods: { def: "shout", worker: "worried", pros: "worried" },
    },
    {
      who: "judge",
      mood: "neutral",
      text: trial.verdict.reasoning,
      cites: trial.verdict.cited_events,
      moods: { worker: "worried" },
    },
    {
      who: "judge",
      mood: "shout",
      text: ruling,
      verdict: true,
      moods: { judge: "shout", worker: "worried" },
    },
    {
      who: "worker",
      mood: reaction.mood,
      text: reaction.text,
      moods: { worker: reaction.mood, judge: "happy", pros: trial.verdict.ruling === "continue" ? "worried" : "happy", def: trial.verdict.ruling === "halt" ? "worried" : "happy" },
    },
  ];
}
