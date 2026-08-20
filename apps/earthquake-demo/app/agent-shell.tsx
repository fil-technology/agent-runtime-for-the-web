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
      clientActions={{
        showOnMap: ({ eventId, region }: { eventId?: string; region?: string }) => {
          const query = eventId
            ? `?focus=${encodeURIComponent(eventId)}`
            : region
              ? `?region=${encodeURIComponent(region)}`
              : "";
          router.push(`/map${query}`);
          return { focused: eventId ?? region ?? "all events" };
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
      <AgentChat
        title="Tremor"
        suggestions={[
          "Tell me about this earthquake",
          "Is there an official tsunami warning?",
          "Why was it felt so far away?",
          "Show earthquakes near Japan",
        ]}
      />
    </AgentProvider>
  );
}
