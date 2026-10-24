import type { Metadata } from "next";
import { Suspense } from "react";
import { DotGothic16, IBM_Plex_Sans, Jersey_10 } from "next/font/google";
import { SiteHeader } from "@/components/SiteHeader";
import { LiveProvider } from "@/lib/live";
import "./globals.css";

// Jersey 10 is drawn on a 10px grid: use it at 20, 30, 40, 60 or 80px only, weight 400, so it stays pixel-sharp.
const jersey = Jersey_10({ variable: "--font-jersey", subsets: ["latin"], weight: "400" });
const dotgothic = DotGothic16({ variable: "--font-dotgothic", subsets: ["latin"], weight: "400" });
const plex = IBM_Plex_Sans({ variable: "--font-plex", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "Agent Courtroom",
  description: "Runtime oversight for autonomous agents. Cheap code monitors watch every step; when one flags a worker, an adversarial court decides what it should do next.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jersey.variable} ${dotgothic.variable} ${plex.variable}`}>
      <body className="min-h-screen">
        <Suspense fallback={<div className="h-[104px]" />}>
          <SiteHeader />
        </Suspense>
        <LiveProvider>
          <main className="mx-auto w-full max-w-[1064px] px-4 pb-16">{children}</main>
        </LiveProvider>
      </body>
    </html>
  );
}
