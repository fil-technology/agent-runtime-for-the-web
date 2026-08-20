import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeProvider, registerDocsLoader, type ModelProvider } from "@agent-runtime/core";
import { loadDocs } from "@agent-runtime/core/node";
import { createAnthropicProvider } from "@agent-runtime/cloud";
import { agent as saasAgent } from "../../../apps/saas-demo/lib/agent.ts";
import { agent as hazardAgent } from "../../../apps/earthquake-demo/lib/agent.ts";
import { cases } from "./cases.ts";
import { retrieverFor, runProfile, type Profile } from "./harness.ts";
import { printComparison, printSummary, summarize, type Summary } from "./report.ts";

registerDocsLoader(loadDocs);

/**
 * Profiles are the whole point: the same 76 cases, the same runtime, and one
 * variable — who does the thinking.
 */
const PROFILES: Record<string, Profile> = {
  rules: {
    name: "rules",
    description: "Deterministic rule-based provider. No model at all.",
    providers: () => [createFakeProvider({ id: "local/rule-based" })],
  },

  cloud: {
    name: "cloud",
    description: "Cloud model for every stage.",
    providers: () => [createAnthropicProvider({ model: "claude-opus-5" })],
  },

  hybrid: {
    name: "hybrid",
    description: "Rules route and extract; the cloud model explains.",
    providers: () => [
      restrict(createFakeProvider({ id: "local/rule-based" }), ["route", "extract"]),
      createAnthropicProvider({ model: "claude-opus-5" }),
    ],
  },

  "local-360m": {
    name: "local-360m",
    description: "SmolLM2-360M on-device (run headlessly here).",
    providers: async () => {
      const { createLocalProvider } = await import("@agent-runtime/local");
      return [
        createLocalProvider({
          model: "HuggingFaceTB/SmolLM2-360M-Instruct",
          allowNode: true,
          device: "wasm",
        }),
      ];
    },
  },

  "local-135m": {
    name: "local-135m",
    description: "SmolLM2-135M on-device (ultra-light experiment).",
    providers: async () => {
      const { createLocalProvider } = await import("@agent-runtime/local");
      return [
        createLocalProvider({
          model: "HuggingFaceTB/SmolLM2-135M-Instruct",
          allowNode: true,
          device: "wasm",
        }),
      ];
    },
  },

  "local-360m-cloud": {
    name: "local+cloud",
    description: "SmolLM2-360M first, cloud when confidence is low.",
    providers: async () => {
      const { createLocalProvider } = await import("@agent-runtime/local");
      return [
        createLocalProvider({
          model: "HuggingFaceTB/SmolLM2-360M-Instruct",
          allowNode: true,
          device: "wasm",
        }),
        createAnthropicProvider({ model: "claude-opus-5" }),
      ];
    },
  },
};

function restrict(provider: ModelProvider, tasks: string[]): ModelProvider {
  const original = provider.capabilities.bind(provider);
  provider.capabilities = async () => ({ ...(await original()), tasks: tasks as never });
  return provider;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const SAAS_DIR = resolve(HERE, "../../../apps/saas-demo");
const HAZARD_DIR = resolve(HERE, "../../../apps/earthquake-demo");

async function main() {
  const args = process.argv.slice(2);
  const requested = args.filter((a) => !a.startsWith("--"));
  const filter = value(args, "--filter");
  const suite = value(args, "--suite");

  const names = requested.length ? requested : ["rules"];
  const selected = cases
    .filter((c) => !suite || c.suite === suite)
    .filter((c) => !filter || c.id.includes(filter) || c.tags?.includes(filter));

  if (!selected.length) {
    console.error("No cases matched. Use --suite saas|hazard or --filter <tag|id>.");
    process.exit(1);
  }

  const tagsById = new Map(selected.map((c) => [c.id, c.tags ?? []]));
  const agents = {
    saas: { agent: saasAgent, retriever: await retrieverFor(saasAgent, SAAS_DIR) },
    hazard: { agent: hazardAgent, retriever: await retrieverFor(hazardAgent, HAZARD_DIR) },
  };
  const summaries: Summary[] = [];

  for (const name of names) {
    const profile = PROFILES[name];
    if (!profile) {
      console.error(
        `Unknown profile "${name}". Available: ${Object.keys(PROFILES).join(", ")}`
      );
      process.exit(1);
    }
    if (name !== "rules" && name.startsWith("local") === false && !process.env.ANTHROPIC_API_KEY) {
      console.error(
        `Profile "${name}" needs ANTHROPIC_API_KEY. Skipping.\n` +
          `Run the deterministic baseline with: pnpm eval rules`
      );
      continue;
    }

    process.stdout.write(`\nrunning ${selected.length} cases · ${profile.description}\n`);
    let done = 0;
    const results = await runProfile({
      agents,
      cases: selected,
      profile,
      onProgress: (result) => {
        done += 1;
        process.stdout.write(
          `\r  ${done}/${selected.length}  ${result.pass ? "·" : "×"} ${result.id.padEnd(16)}`
        );
      },
    });
    process.stdout.write("\n");

    const summary = summarize(profile.name, results, tagsById);
    printSummary(summary);
    summaries.push(summary);

    await mkdir("eval-results", { recursive: true });
    await writeFile(
      `eval-results/${profile.name}.json`,
      JSON.stringify({ summary, results }, null, 2)
    );
  }

  printComparison(summaries);

  const unsafe = summaries.filter((s) => s.safetyRate < 1);
  if (unsafe.length) {
    console.error(
      `\nSafety invariant violated in: ${unsafe.map((s) => s.profile).join(", ")}`
    );
    process.exit(1);
  }
}

function value(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
