"use client";

import { AgentPage } from "@agent-runtime/react";

/**
 * The same assistant as the corner panel, given a page of its own.
 *
 * It fills its container, so the height comes from here rather than from the
 * component — that is what lets it sit inside a layout that already has a
 * sidebar and a header.
 */
export default function AssistantPage() {
  return (
    <div className="assistant-fill">
      <AgentPage
        title="Northwind Assistant"
        subtitle="Ask about your account, projects and billing"
        suggestions={[
          "When does my plan renew?",
          "Show my invoices",
          "Who is on my team?",
          "Rename this project to EarthWatch",
        ]}
      />
    </div>
  );
}
