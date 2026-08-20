import { createFakeProvider } from "@agent-runtime/core";
import { createAnthropicProvider } from "@agent-runtime/cloud";
import { createAgentRoute } from "@agent-runtime/next";
import { agent } from "@/lib/agent";

export const { POST, GET } = createAgentRoute({
  agent,
  providers: () => [
    createFakeProvider({ id: "local/rule-based", label: "Rule-based router (no model)" }),
    ...(process.env.ANTHROPIC_API_KEY
      ? [createAnthropicProvider({ model: "claude-opus-5" })]
      : []),
  ],
  // A public hazard site: no sign-in, so no user in the session.
  exposeKnowledge: true,
});
