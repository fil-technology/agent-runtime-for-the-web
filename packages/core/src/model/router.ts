import type { ModelPolicy } from "../types.js";
import { noProviderError } from "../errors.js";
import type {
  GenerateInput,
  GenerateResult,
  ModelCapabilities,
  ModelProvider,
  ModelTask,
  StructuredGenerateInput,
  StructuredResult,
} from "./types.js";

export interface RouteCandidate {
  provider: ModelProvider;
  capabilities: ModelCapabilities;
  reason: string;
}

export interface RouteAttempt {
  providerId: string;
  ok: boolean;
  confidence?: number;
  ms: number;
  reason: string;
  error?: string;
}

export interface RoutedResult<T> {
  value: T;
  providerId: string;
  confidence: number;
  attempts: RouteAttempt[];
  /** Set when the winning provider was not the first choice. */
  escalatedBecause?: string;
}

/**
 * A model the browser already ships costs no download and no bandwidth, so it
 * is preferred over one the runtime would have to fetch. Cloud is last: it is
 * a capability, not a dependency.
 */
const TIER_ORDER: Record<string, number> = { browser: 0, local: 1, cloud: 2 };

/**
 * Explicitly dumb routing. It answers one question — "who is cheapest and
 * closest to the user that can do this stage?" — and escalates only on
 * unavailability, failure, or low confidence. Every decision is recorded so it
 * can be inspected instead of guessed at.
 */
export class ModelRouter {
  /** "providerId:task" pairs that produced unusable output at runtime. */
  private readonly benched = new Map<string, string>();

  constructor(
    private readonly providers: ModelProvider[],
    private readonly policy: Required<ModelPolicy>
  ) {}

  /**
   * Stop asking a provider to do something it has demonstrably failed at.
   *
   * Static quality scores are guesses; this is evidence. One wasted round trip
   * is acceptable, the same wasted round trip on every request is not.
   */
  bench(providerId: string, task: ModelTask, reason: string): void {
    this.benched.set(`${providerId}:${task}`, reason);
  }

  benchedReason(providerId: string, task: ModelTask): string | undefined {
    return this.benched.get(`${providerId}:${task}`);
  }

  async candidates(task: ModelTask): Promise<RouteCandidate[]> {
    const resolved = await Promise.all(
      this.providers.map(async (provider) => {
        try {
          return { provider, capabilities: await provider.capabilities() };
        } catch (error) {
          return {
            provider,
            capabilities: {
              id: provider.id,
              label: provider.id,
              tier: "cloud" as const,
              structuredOutput: "none" as const,
              streaming: false,
              quality: 0,
              privacy: "third-party" as const,
              available: false,
              unavailableReason: (error as Error).message,
              tasks: [],
            },
          };
        }
      })
    );

    const candidates: RouteCandidate[] = [];
    for (const { provider, capabilities } of resolved) {
      if (!capabilities.available) continue;
      if (!capabilities.tasks.includes(task)) continue;
      if (this.benched.has(`${provider.id}:${task}`)) continue;
      if (capabilities.tier === "cloud" && !this.policy.cloudFallback) continue;
      if (this.policy.strategy === "local-only" && capabilities.tier === "cloud") continue;
      if (this.policy.strategy === "cloud-only" && capabilities.tier !== "cloud") continue;
      if (
        capabilities.tier === "local" &&
        capabilities.approxSizeMB &&
        capabilities.approxSizeMB > this.policy.localBudgetMB
      ) {
        continue;
      }
      candidates.push({
        provider,
        capabilities,
        reason: reasonFor(capabilities, task),
      });
    }

    candidates.sort((a, b) => {
      // Readiness outranks everything. A warming on-device model is still the
      // preferred destination — it just does not get to hold up this request.
      const ready = Number(b.capabilities.readyNow !== false) - Number(a.capabilities.readyNow !== false);
      if (ready !== 0) return ready;
      const tier = TIER_ORDER[a.capabilities.tier]! - TIER_ORDER[b.capabilities.tier]!;
      if (tier !== 0) return tier;
      return b.capabilities.quality - a.capabilities.quality;
    });
    return candidates;
  }

  async runStructured<T>(input: StructuredGenerateInput<T>): Promise<RoutedResult<T>> {
    const candidates = await this.candidates(input.task);
    if (!candidates.length) {
      throw noProviderError(input.task, this.providers.map((p) => p.id));
    }

    const attempts: RouteAttempt[] = [];
    let best: { result: StructuredResult<T>; reason: string } | undefined;

    for (const candidate of candidates) {
      const started = now();
      try {
        const result = await candidate.provider.generateStructured(input);
        const ms = now() - started;

        // Validation is a gate, not a score. A provider may report whatever
        // confidence it likes, but a value that does not satisfy the schema is
        // not a candidate answer at any confidence — it is a failed attempt to
        // escalate past.
        const validated = input.schema.safeParse(result.value);
        if (!validated.success) {
          attempts.push({
            providerId: candidate.provider.id,
            ok: false,
            confidence: result.confidence,
            ms,
            reason: candidate.reason,
            error: `output did not satisfy ${input.schemaName ?? "the schema"}: ${validated.error.issues
              .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
              .join("; ")}`,
          });
          continue;
        }

        attempts.push({
          providerId: candidate.provider.id,
          ok: true,
          confidence: result.confidence,
          ms,
          reason: candidate.reason,
        });
        if (!best || result.confidence > best.result.confidence) {
          best = { result: { ...result, value: validated.data }, reason: candidate.reason };
        }
        if (result.confidence >= this.policy.confidenceThreshold) {
          return {
            value: result.value,
            providerId: result.providerId,
            confidence: result.confidence,
            attempts,
            ...(attempts.length > 1
              ? { escalatedBecause: "previous-provider-below-confidence-threshold" }
              : {}),
          };
        }
      } catch (error) {
        attempts.push({
          providerId: candidate.provider.id,
          ok: false,
          ms: now() - started,
          reason: candidate.reason,
          error: (error as Error).message,
        });
      }
    }

    if (best) {
      return {
        value: best.result.value,
        providerId: best.result.providerId,
        confidence: best.result.confidence,
        attempts,
        escalatedBecause: "no-provider-met-confidence-threshold",
      };
    }

    throw noProviderError(
      input.task,
      attempts.map((a) => `${a.providerId} (${a.error ?? "failed"})`)
    );
  }

  async runText(input: GenerateInput): Promise<GenerateResult & { attempts: RouteAttempt[] }> {
    const candidates = await this.candidates(input.task);
    if (!candidates.length) {
      throw noProviderError(input.task, this.providers.map((p) => p.id));
    }
    const attempts: RouteAttempt[] = [];
    for (const candidate of candidates) {
      const started = now();
      try {
        const result = await candidate.provider.generate(input);
        attempts.push({
          providerId: candidate.provider.id,
          ok: true,
          ms: now() - started,
          reason: candidate.reason,
        });
        return { ...result, attempts };
      } catch (error) {
        attempts.push({
          providerId: candidate.provider.id,
          ok: false,
          ms: now() - started,
          reason: candidate.reason,
          error: (error as Error).message,
        });
      }
    }
    throw noProviderError(
      input.task,
      attempts.map((a) => `${a.providerId} (${a.error ?? "failed"})`)
    );
  }

  /** Streaming text for the explain stage; falls back to a single chunk. */
  async *streamText(
    input: GenerateInput
  ): AsyncGenerator<{ delta: string; providerId: string }> {
    const candidates = await this.candidates(input.task);
    const candidate = candidates[0];
    if (!candidate) throw noProviderError(input.task, this.providers.map((p) => p.id));

    if (candidate.capabilities.streaming && candidate.provider.generateStream) {
      for await (const delta of candidate.provider.generateStream(input)) {
        yield { delta, providerId: candidate.provider.id };
      }
      return;
    }
    const result = await candidate.provider.generate(input);
    yield { delta: result.text, providerId: result.providerId };
  }

  async describe(): Promise<ModelCapabilities[]> {
    return Promise.all(this.providers.map((p) => p.capabilities()));
  }
}

function reasonFor(capabilities: ModelCapabilities, task: ModelTask): string {
  const bits = [`tier=${capabilities.tier}`, `task=${task}`];
  if (capabilities.readyNow === false) {
    bits.push(
      `warming${
        capabilities.loadProgress !== undefined
          ? `=${Math.round(capabilities.loadProgress * 100)}%`
          : ""
      }`
    );
  }
  if (capabilities.privacy === "on-device") bits.push("privacy=on-device");
  if (capabilities.structuredOutput !== "none") {
    bits.push(`structured=${capabilities.structuredOutput}`);
  }
  return bits.join(" ");
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
