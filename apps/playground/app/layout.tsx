import type { ReactNode } from "react";
import { AgentShell } from "./agent-shell";
import "./globals.css";

export const metadata = { title: "Agent Runtime playground" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AgentShell>{children}</AgentShell>
      </body>
    </html>
  );
}
