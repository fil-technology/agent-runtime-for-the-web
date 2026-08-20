import Link from "next/link";
import type { ReactNode } from "react";
import { AgentShell } from "./agent-shell";
import { listProjects } from "@/lib/data";
import "./globals.css";

export const metadata = {
  title: "Northwind Labs",
  description: "SaaS demo for the Agent Runtime for the Web",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const projects = listProjects("u_ada");
  return (
    <html lang="en">
      <body>
        <AgentShell>
          <div className="shell">
            <aside className="side">
              <div className="brand">Northwind Labs</div>
              <nav className="nav">
                <Link href="/">Overview</Link>
                <Link href="/projects">Projects</Link>
                <div className="section">Projects</div>
                {projects.map((project) => (
                  <Link key={project.id} href={`/projects/${project.id}/settings`}>
                    {project.name}
                  </Link>
                ))}
                <div className="section">Settings</div>
                <Link href="/settings/team">Team</Link>
                <Link href="/settings/billing">Billing</Link>
                <Link href="/settings/api-keys">API keys</Link>
              </nav>
            </aside>
            <main className="main">{children}</main>
          </div>
        </AgentShell>
      </body>
    </html>
  );
}
