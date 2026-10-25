import { Suspense } from "react";
import demoTrials from "@/data/stream-trials.json";
import { Courtroom } from "./Courtroom";

export function generateStaticParams() {
  return demoTrials.map(({ id }) => ({ id }));
}

export default function CourtPage() {
  return (
    <Suspense fallback={<p className="px-box p-6">Calling the court to order...</p>}>
      <Courtroom />
    </Suspense>
  );
}
