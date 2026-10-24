import { Suspense } from "react";
import { Courtroom } from "./Courtroom";

export default function CourtPage() {
  return (
    <Suspense fallback={<p className="px-box p-6">Calling the court to order...</p>}>
      <Courtroom />
    </Suspense>
  );
}
