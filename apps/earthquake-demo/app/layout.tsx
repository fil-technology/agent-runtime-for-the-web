import Link from "next/link";
import type { ReactNode } from "react";
import { AgentShell } from "./agent-shell";
import "./globals.css";

export const metadata = {
  title: "Tremor — recent earthquakes",
  description: "Hazard demo for the Agent Runtime for the Web",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AgentShell>
          <header>
            <Link href="/" className="logo">
              Tremor
            </Link>
            <nav>
              <Link href="/">Recent events</Link>
              <Link href="/map">Map</Link>
            </nav>
          </header>
          <main>{children}</main>
        </AgentShell>
      </body>
    </html>
  );
}
