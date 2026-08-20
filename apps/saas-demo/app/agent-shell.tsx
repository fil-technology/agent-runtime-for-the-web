"use client";

import { usePathname, useRouter } from "next/navigation";
import { AgentChat, AgentProvider } from "@agent-runtime/react";
import type { ReactNode } from "react";
import { DESTINATIONS, type Destination } from "@/lib/agent";

/**
 * Ten lines of integration: identity comes from the server, page state comes
 * from the router, navigation is handed back to Next.js.
 */
export function AgentShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <AgentProvider
      page={{ route: pathname }}
      clientActions={{
        // The browser half of the navigate action. This is the only place
        // the assistant can affect the UI, and it does so through the app's
        // own router.
        navigate: ({ destination }: { destination: Destination }) => {
          const target = DESTINATIONS[destination];
          router.push(target.path);
          return { opened: target.label };
        },
      }}
      onNavigate={(path) => router.push(path)}
      // These are demos: the runtime trace is part of what they demonstrate.
      // Navigation is offered as a card the reader clicks, never performed
      // out from under them.
      autoRunClientActions={false}
      debug
    >
      {children}
      {/* The corner panel would be a second way into the same conversation on
          the page that already is one. */}
      {!pathname.startsWith("/assistant") && (
          <AgentChat
          title="Northwind Assistant"
          suggestions={[
            "When does my plan renew?",
            "Show my invoices",
            "Where can I invite someone?",
            "Rename this project to EarthWatch",
          ]}
        />
      )}
    </AgentProvider>
  );
}
