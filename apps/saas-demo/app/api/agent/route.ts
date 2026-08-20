import { createFakeProvider } from "@agent-runtime/core";
import { createAnthropicProvider } from "@agent-runtime/cloud";
import { createAgentRoute } from "@agent-runtime/next";
import { agent } from "@/lib/agent";
import { currentUser, getAccount } from "@/lib/data";

/**
 * The entire server-side integration.
 *
 * With no API key the app still works: the deterministic provider routes and
 * extracts, and answers are assembled from retrieved documentation and action
 * results. Adding a key upgrades the explanation stage without any other code
 * change — which is the point of the provider abstraction.
 */
export const { POST, GET } = createAgentRoute({
  agent,

  providers: () => {
    const hasCloud = Boolean(process.env.ANTHROPIC_API_KEY);
    return [
      // When a capable model is available, keep the cheap deterministic
      // provider on the stages it is actually good at, and let the cloud
      // model write the prose.
      hasCloud
        ? restrictToRoutingStages(createFakeProvider({ id: "local/rule-based" }))
        : createFakeProvider({ id: "local/rule-based" }),
      ...(hasCloud ? [createAnthropicProvider({ model: "claude-opus-5" })] : []),
    ];
  },

  /**
   * Identity is resolved here, on the server, from the application's own
   * session. Nothing the browser sends can influence who the agent thinks
   * you are.
   */
  session: async () => {
    const user = currentUser();
    const account = getAccount();
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        plan: account.plan,
        accountName: account.name,
      },
    };
  },

  // The docs in this demo are public, so on-device retrieval is allowed.
  exposeKnowledge: true,
});

/** Narrows a provider to the stages a rule-based router is genuinely good at. */
function restrictToRoutingStages<T extends { capabilities: () => Promise<any> }>(
  provider: T
): T {
  const original = provider.capabilities.bind(provider);
  provider.capabilities = async () => ({
    ...(await original()),
    tasks: ["route", "extract"],
  });
  return provider;
}
