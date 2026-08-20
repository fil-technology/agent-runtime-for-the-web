import Link from "next/link";
import type { ReactNode } from "react";
import { AgentShell } from "./agent-shell";
import "./globals.css";

export const metadata = {
  title: "Agent Runtime for the Web",
  description: "Make an existing web application operable through language.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AgentShell>
          <header>
            <Link href="/" className="brand">
              Agent Runtime
            </Link>
            <nav>
              <Link href="/">Demos</Link>
              <Link href="/docs/quickstart">Docs</Link>
            </nav>
          </header>
          {children}
        </AgentShell>
      </body>
    </html>
  );
}
