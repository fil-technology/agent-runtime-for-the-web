"use client";

import { usePathname, useRouter } from "next/navigation";
import { AgentChat, AgentProvider } from "@agent-runtime/react";
import type { ReactNode } from "react";

export function AgentShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <AgentProvider
      page={{ route: pathname }}
      // Documentation links and the openPage action both go through the app's
      // own router, so following a source never costs a full page load.
      onNavigate={(path) => router.push(path)}
      clientActions={{
        openPage: ({ slug }: { slug: string }) => {
          router.push(`/docs/${slug}`);
          return { opened: slug };
        },
      }}
      // Navigation is offered as a card the reader clicks, never performed
      // out from under them.
      autoRunClientActions={false}
      debug
    >
      {children}
      <AgentChat
        title="Docs assistant"
        defaultOpen
        suggestions={[
          "How do permissions work?",
          "What is context for?",
          "Which page covers routing?",
          "Open the quickstart",
        ]}
      />
    </AgentProvider>
  );
}
