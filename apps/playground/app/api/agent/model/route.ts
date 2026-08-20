import { createAnthropicProvider, createModelProxyRoute } from "@agent-runtime/cloud";

/**
 * Cloud escalation for a page whose reasoning runs on-device.
 *
 * The browser sends a prompt and a schema; the key stays here. Without this
 * route, local-first mode simply has no cloud tier to escalate to.
 */
export const POST = createModelProxyRoute({
  provider: createAnthropicProvider(),
  authorize: () => Boolean(process.env.ANTHROPIC_API_KEY),
});
