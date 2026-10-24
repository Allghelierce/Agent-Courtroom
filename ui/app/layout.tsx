import type { Metadata } from "next";
import { Suspense } from "react";
import { DotGothic16, Pixelify_Sans } from "next/font/google";
import { SiteHeader } from "@/components/SiteHeader";
import { LiveProvider } from "@/lib/live";
import "./globals.css";

const pixelify = Pixelify_Sans({ variable: "--font-pixelify", subsets: ["latin"], weight: ["500", "700"] });
const dotgothic = DotGothic16({ variable: "--font-dotgothic", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "Agent Courtroom",
  description: "Cheap monitors watch your AI agents. When one gets stuck, a tiny court decides what it should do next.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${pixelify.variable} ${dotgothic.variable}`}>
      <body className="min-h-screen">
        <Suspense fallback={<div className="h-[104px]" />}>
          <SiteHeader />
        </Suspense>
        <LiveProvider>
          <main className="mx-auto w-full max-w-[1200px] px-4 pb-16">{children}</main>
        </LiveProvider>
      </body>
    </html>
  );
}
