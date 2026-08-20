import { createFakeProvider } from "@agent-runtime/core";
import { createAnthropicProvider } from "@agent-runtime/cloud";
import { createAgentRoute } from "@agent-runtime/next";
import { agent } from "@/lib/agent";

export const { POST, GET } = createAgentRoute({
  agent,
  providers: () => [
    createFakeProvider({ id: "local/rule-based" }),
    ...(process.env.ANTHROPIC_API_KEY ? [createAnthropicProvider()] : []),
  ],
  exposeKnowledge: true,
});
