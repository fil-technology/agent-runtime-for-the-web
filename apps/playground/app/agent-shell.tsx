"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AgentChat, AgentProvider } from "@agent-runtime/react";
import type { ModelProvider } from "@agent-runtime/core";
import type { ReactNode } from "react";

/**
 * Two modes, one API.
 *
 * Server mode runs the loop on the server. Local-first mode loads a small
 * model into the browser and runs the same loop there; the server still
 * validates, authorizes and executes every action.
 */
/**
 * Our own copy of the on-device weights. Serving them ourselves means one
 * origin, a cache we control, and no dependency on the Hugging Face hub being
 * up. See docs/ON-DEVICE-MODELS.md for how the bundle is built.
 */
const WEIGHTS_HOST = "https://pub-eac503b383c4480d8c358099c8c40275.r2.dev/";

export function AgentShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [localFirst, setLocalFirst] = useState(false);
  const [providers, setProviders] = useState<ModelProvider[]>([]);

  const enableLocal = async (enabled: boolean) => {
    setLocalFirst(enabled);
    if (!enabled) {
      setProviders([]);
      return;
    }
    const [{ createLocalProvider, createBrowserAiProvider }, { createProxyProvider }] =
      await Promise.all([import("@agent-runtime/local"), import("@agent-runtime/cloud")]);

    // ?engine=download skips the browser's built-in model so you can watch a
    // real weight download; ?engine=tiny uses the 135M model (~110MB).
    const engine = new URLSearchParams(window.location.search).get("engine");
    // Weights come from our own R2 bucket. Override per-visit with
    // ?weights=<url>, or ?weights=hub to fall back to Hugging Face.
    const params = new URLSearchParams(window.location.search);
    const requested =
      params.get("weights") ?? process.env.NEXT_PUBLIC_WEIGHTS_HOST ?? WEIGHTS_HOST;
    const selfHosted = requested !== "hub" ? requested : undefined;

    const smol = createLocalProvider(
      selfHosted
        ? {
            // Flat layout in the bucket: <slug>/config.json, <slug>/onnx/…
            model: engine === "tiny" ? "smollm2-135m" : "smollm2-360m",
            weightsHost: selfHosted,
            weightsPathTemplate: "{model}/",
          }
        : {
            model:
              engine === "tiny"
                ? "HuggingFaceTB/SmolLM2-135M-Instruct"
                : "HuggingFaceTB/SmolLM2-360M-Instruct",
          }
    );

    setProviders([
      // Cheapest and closest to the user first; the router escalates only when
      // it has to.
      ...(engine === "download" || engine === "tiny" ? [] : [createBrowserAiProvider()]),
      smol,
      createProxyProvider({ endpoint: "/api/agent/model" }),
    ]);
  };

  const clientActions = useMemo(
    () => ({
      navigate: ({ destination }: { destination: "home" | "settings" }) => {
        router.push(destination === "home" ? "/" : "/settings");
        return { opened: destination };
      },
    }),
    [router]
  );

  return (
    <AgentProvider
      key={localFirst ? "local" : "server"}
      page={{ route: pathname }}
      clientActions={clientActions}
      providers={providers}
      mode={localFirst ? "local-first" : "server"}
      // These are demos: the runtime trace is part of what they demonstrate.
      // Navigation is offered as a card the reader clicks, never performed
      // out from under them.
      autoRunClientActions={false}
      debug
    >
      <main>
        <nav>
          <a href="/">Notes</a>
          <a href="/settings">Settings</a>
        </nav>
        {children}
        <div className="toggle">
          <label>
            <input
              type="checkbox"
              checked={localFirst}
              onChange={(event) => void enableLocal(event.target.checked)}
            />
            Run the reasoning loop on-device
          </label>
          <div className="muted" style={{ marginTop: 6 }}>
            Uses the browser's built-in model if it has one, otherwise downloads
            SmolLM2-360M (~280&nbsp;MB, cached afterwards). Actions still execute on the
            server. Open the trace panel in the chat to see which provider served each
            stage.
            <br />
            Add <code>?engine=download</code> to watch a real download, or{" "}
            <code>?engine=tiny</code> for the 135M model (~110&nbsp;MB).
          </div>
        </div>
      </main>
      <AgentChat
        defaultOpen
        title="Playground"
        suggestions={[
          "Show my notes",
          "Take me to settings",
          'Rename this note to "Groceries"',
          "What is the capital of France?",
        ]}
      />
    </AgentProvider>
  );
}
