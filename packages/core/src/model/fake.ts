import type { ZodTypeAny } from "zod";
import { tokenize } from "../knowledge/bm25.js";
import { objectFields, isOptional, schemaShape, schemaTypeName } from "../schema.js";
import type {
  GenerateInput,
  GenerateResult,
  ModelCapabilities,
  ModelProvider,
  StructuredGenerateInput,
  StructuredResult,
} from "./types.js";

export interface FakeProviderOptions {
  id?: string;
  label?: string;
  /** Lets tests simulate an unavailable or low-quality tier. */
  tier?: "local" | "browser" | "cloud";
  quality?: number;
  available?: boolean;
  /** Multiplies reported confidence, to exercise escalation paths. */
  confidenceScale?: number;
  latencyMs?: number;
}

/**
 * A deterministic, dependency-free provider.
 *
 * It exists so the runtime architecture can be built, tested and demoed
 * before any model is involved, and so evaluations have a stable baseline to
 * compare small models against. It is rule-based, not a language model.
 */
export function createFakeProvider(options: FakeProviderOptions = {}): ModelProvider {
  const id = options.id ?? "fake/rule-based";
  const scale = options.confidenceScale ?? 1;
  const capabilities: ModelCapabilities = {
    id,
    label: options.label ?? "Rule-based (deterministic)",
    tier: options.tier ?? "local",
    structuredOutput: "native",
    streaming: true,
    quality: options.quality ?? 0.3,
    privacy: options.tier === "cloud" ? "third-party" : "on-device",
    available: options.available ?? true,
    approxSizeMB: 0,
    tasks: ["route", "extract", "explain", "answer"],
  };

  const delay = async () => {
    if (options.latencyMs) await new Promise((r) => setTimeout(r, options.latencyMs));
  };

  return {
    id,
    async capabilities() {
      return capabilities;
    },

    async generate(input: GenerateInput): Promise<GenerateResult> {
      await delay();
      return { text: explain(input), providerId: id, confidence: 1 };
    },

    async *generateStream(input: GenerateInput) {
      await delay();
      for (const word of explain(input).split(/(\s+)/)) {
        yield word;
      }
    },

    async generateStructured<T>(
      input: StructuredGenerateInput<T>
    ): Promise<StructuredResult<T>> {
      await delay();
      const stage = input.stage ?? {};
      let value: unknown;
      let confidence = 0.9;

      if (input.task === "route") {
        const message = stage.message ?? "";
        // A keyword matcher cannot reason about what is still missing, but it
        // can be told where it has already looked.
        const attempted = new Set(stage.attempted ?? []);
        const remaining = (stage.actions ?? []).filter((a) => !attempted.has(a.name));
        const routed =
          attempted.size && !stage.retrying
            ? continueRoute(message, remaining)
            : route(message, remaining, stage.hasKnowledge ?? false);
        confidence = routed.confidence;
        value = routed.action
          ? { type: "action", action: routed.action }
          : // A specific question with no matching action still deserves a real
            // answer attempt: the runtime's grounding rule will refuse honestly
            // if there is nothing to answer from. Vague input gets a
            // clarification even when retrieval happened to match something —
            // a stray keyword hit is not the same as understanding the request.
            isAnswerable(message, stage.hasKnowledge)
            ? { type: "answer" }
            : { type: "clarification", question: whatDoYouMean(message) };
      } else {
        const extracted = extract(
          input.schema as ZodTypeAny,
          stage.message ?? "",
          stage.context ?? {},
          stage.prefilled ?? {},
          stage.actionName,
          stage.actionPhrases
        );
        value = extracted.value;
        confidence = extracted.confidence;
      }

      const parsed = input.schema.safeParse(value);
      if (!parsed.success) {
        // Report honestly rather than guessing; the router escalates.
        return {
          value: value as T,
          providerId: id,
          confidence: 0,
          raw: JSON.stringify(value),
        };
      }
      return {
        value: parsed.data,
        providerId: id,
        confidence: Math.max(0, Math.min(1, confidence * scale)),
        raw: JSON.stringify(parsed.data),
      };
    },
  };
}

/**
 * "How do I X" asks for instructions; "X this" asks for X to happen. "Why …"
 * asks for an explanation. Neither is a request to act.
 */
const EXPLANATORY =
  /\b(how (do|does|can|could|would|should)\b|where (do|can) (i|we)|what happens (if|when)|is it possible to|^why|\bwhy (was|is|are|did|does|do)\b|what (does|do) .* mean|what should (i|we) do|what .* (exist|exists|are there|is there)|what (kind|type|types|sort) of)\b/i;

/**
 * Questions about the future are never action requests. Answering them from
 * documentation — and refusing when the documentation does not cover it — is
 * the only safe behaviour for a product that reports hazards.
 */
const PREDICTIVE =
  /\b(will there|is there going to|are there going to|predict|forecast|next (week|month|year)|in the future|expected to happen)\b/i;

function route(
  message: string,
  actions: Array<{ name: string; description: string; examples?: string[] }>,
  hasKnowledge: boolean
): { action?: string; confidence: number } {
  const queryTokens = new Set(tokenize(message));
  if (!queryTokens.size || !actions.length) return { confidence: 0.3 };

  // A question about how the product works, or about the future, is answered
  // from documentation even when it names an action's subject matter.
  if (PREDICTIVE.test(message)) return { confidence: 0.65 };
  if (hasKnowledge && EXPLANATORY.test(message)) return { confidence: 0.7 };

  let best: { name: string; score: number } | undefined;
  for (const action of actions) {
    const surface = [
      splitCamel(action.name),
      splitCamel(action.name),
      action.description,
      ...(action.examples ?? []),
    ].join(" ");
    const actionTokens = tokenize(surface);
    if (!actionTokens.length) continue;
    let overlap = 0;
    const seen = new Set<string>();
    for (const token of actionTokens) {
      if (queryTokens.has(token) && !seen.has(token)) {
        seen.add(token);
        overlap += 1;
      }
    }
    const score = overlap / Math.max(2, queryTokens.size);
    if (!best || score > best.score) best = { name: action.name, score };
  }

  if (!best || best.score < 0.2) return { confidence: 0.35 };
  return { action: best.name, confidence: Math.min(0.95, 0.5 + best.score) };
}

/** Compound requests are the only ones worth a second lookup. */
const COMPOUND = /\b(and|also|plus|as well as|too|both)\b/i;

/**
 * Deciding whether to fetch *more*.
 *
 * A keyword matcher has no idea whether the question has been answered, so it
 * only continues on evidence that the request had more than one part, and then
 * only on a clearly stronger match than the first step needed. Guessing here
 * means running actions nobody asked for.
 */
function continueRoute(
  message: string,
  remaining: Array<{ name: string; description: string; examples?: string[] }>
): { action?: string; confidence: number } {
  if (!COMPOUND.test(message) || !remaining.length) return { confidence: 0.8 };
  const next = route(message, remaining, false);
  return next.action && next.confidence >= 0.6 ? next : { confidence: 0.8 };
}

function extract(
  schema: ZodTypeAny,
  message: string,
  context: Record<string, unknown>,
  prefilled: Record<string, unknown>,
  actionName?: string,
  actionPhrases?: string[]
): { value: Record<string, unknown>; confidence: number } {
  const value: Record<string, unknown> = { ...prefilled };
  const fields = objectFields(schema);
  const shape: Record<string, ZodTypeAny> = schemaShape(schema);
  const quoted = [...message.matchAll(/["“”']([^"“”']{2,80})["“”']/g)].map((m) => m[1]!);
  const toWords = message.match(/\b(?:to|as|named|called)\s+(.{2,60})$/i)?.[1]?.trim();

  let filled = 0;
  let required = 0;
  for (const field of fields) {
    const fieldSchema = shape[field];
    const optional = fieldSchema ? isOptional(fieldSchema) : true;
    if (!optional) required += 1;
    if (value[field] !== undefined) {
      if (!optional) filled += 1;
      continue;
    }
    // Only the `current*` convention, never a bare same-name match. An
    // application's context says `role` meaning *the signed-in user's* role;
    // an invite action's `role` field means the invitee's. Matching those by
    // name alone silently invites someone as an admin. Anything else an
    // action wants from context it declares through `fillFromContext`.
    const fromContext = context[`current${capitalize(field)}`];
    if (fromContext !== undefined) {
      value[field] = fromContext;
      if (!optional) filled += 1;
      continue;
    }
    const enumValues = fieldSchema ? enumOptions(fieldSchema) : undefined;
    if (enumValues?.length) {
      const picked = pickEnum(message, enumValues, actionPhrases);
      if (picked) {
        value[field] = picked;
        if (!optional) filled += 1;
        continue;
      }
    }
    if (/email/i.test(field)) {
      const email = message.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
      if (email) {
        value[field] = email;
        if (!optional) filled += 1;
        continue;
      }
    }
    if (/name|title|label/i.test(field)) {
      // "rename it to X", 'call it "X"', and "call this project X" are all the
      // same request with the value in three different places.
      const candidate = quoted[0] ?? toWords ?? trailingProperNoun(message);
      if (candidate) {
        value[field] = stripTrailingPunctuation(candidate);
        if (!optional) filled += 1;
        continue;
      }
    }
    if (/region|place|location|area|country|city/i.test(field)) {
      // People type "in fiji" as often as "in Fiji", so casing cannot be the
      // signal. Anything that is plainly not a place is rejected instead.
      const named = message.match(
        /\b(?:near|in|around|from|at)\s+([A-Za-z][\w'’-]{2,}(?:\s+[A-Z][\w'’-]*)?)/
      )?.[1];
      // Failing that, any capitalised word that is not the first word and is
      // not obviously something else: "California's earthquake", "Japan quakes".
      const standalone = named ? undefined : trailingProperNoun(message);
      const raw = named ?? standalone;
      const candidate = raw
        ? stripTrailingPunctuation(raw).replace(/['’]s$/i, "")
        : undefined;
      if (candidate && !NOT_A_PLACE.has(candidate.toLowerCase())) {
        value[field] = candidate;
        if (!optional) filled += 1;
        continue;
      }
    }
    // Content is not a search query. "add a note - hello how are you" means the
    // note should say exactly that, so nothing may be stripped out of it.
    if (/^(text|content|body|message|note|comment|title|description)$/i.test(field)) {
      const literal = quoted[0] ?? afterSeparator(message) ?? toWords;
      if (literal) {
        value[field] = stripTrailingPunctuation(literal);
        if (!optional) filled += 1;
        continue;
      }
    }
    if (/query|search|text|term/i.test(field)) {
      value[field] = quoted[0] ?? searchTerms(message, actionName);
      if (!optional) filled += 1;
      continue;
    }
    if (/limit|count|size|top|first/i.test(field)) {
      const n = numberIn(message);
      if (n !== undefined) {
        value[field] = n;
        if (!optional) filled += 1;
        continue;
      }
    }
  }

  const confidence = required === 0 ? 0.9 : Math.max(0.1, filled / required) * 0.95;
  return { value, confidence };
}

/**
 * Deterministic "explanation": it restates what the application supplied,
 * preferring the developer-authored action summary. No model can be wrong
 * about a fact it is not allowed to rewrite.
 */
/** Everything after a dash or colon: the part the user actually dictated. */
function afterSeparator(message: string): string | undefined {
  const tail = message.match(/[-—–:]\s*(.{2,200})$/)?.[1]?.trim();
  return tail || undefined;
}

/** The last capitalised word that is not the first word of the sentence. */
function trailingProperNoun(message: string): string | undefined {
  const words = message.trim().split(/\s+/);
  for (let i = words.length - 1; i >= 1; i--) {
    const word = stripTrailingPunctuation(words[i]!);
    if (/^[A-Z][\w'’-]*$/.test(word)) return word.replace(/['’]s$/i, "");
  }
  return undefined;
}

// "a"/"an" are articles, not quantities: "an earthquake near Iceland" asks for
// events in Iceland, not for exactly one event.
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  single: 1, couple: 2, pair: 2,
};

/** "top 3", "the most recent two", "just one" all mean a count. */
function numberIn(message: string): number | undefined {
  const digits = message.match(/\b(\d{1,3})\b/)?.[1];
  if (digits) return Number(digits);
  for (const word of message.toLowerCase().split(/[^a-z]+/)) {
    if (word in WORD_NUMBERS) return WORD_NUMBERS[word];
  }
  return undefined;
}

function enumOptions(schema: ZodTypeAny): string[] | undefined {
  const kind = schemaTypeName(schema);
  const def = (schema as any)?.def ?? (schema as any)?._def;
  if (!def) return undefined;
  if (kind === "enum") {
    if (Array.isArray(def.values)) return [...def.values];
    if (def.entries) return Object.values(def.entries) as string[];
    return undefined;
  }
  if (kind === "optional" || kind === "default" || kind === "nullable") {
    return enumOptions(def.innerType ?? def.type);
  }
  return undefined;
}

/** Closed sets are what small models and rule-based routers do best. */
function pickEnum(
  message: string,
  options: string[],
  actionPhrases?: string[]
): string | undefined {
  const messageTokens = new Set(tokenize(message));
  const incidental = incidentalOption(options, actionPhrases);
  // The one option that is really just a word in the action's own name needs
  // to be said as a choice, not merely be present: "invite sam as a member"
  // picks the role, "add a new member to my team" is how you ask for the
  // action at all.
  if (incidental) {
    const said = message.trim().toLowerCase().replace(/[.!?]$/, "");
    const qualified = new RegExp(
      `\\b(as|role|access|permission)\\b[\\w\\s]{0,12}\\b${incidental}\\b|\\b${incidental}\\b\\s+(role|access)`,
      "i"
    );
    if (said !== incidental.toLowerCase() && !qualified.test(message)) {
      messageTokens.delete(incidental.toLowerCase());
    }
  }
  let best: { value: string; score: number } | undefined;
  for (const option of options) {
    const optionTokens = tokenize(splitCamel(option));
    if (!optionTokens.length) continue;
    const overlap = optionTokens.filter((t) => messageTokens.has(t)).length;
    const score = overlap / optionTokens.length;
    if (score > 0 && (!best || score > best.score)) best = { value: option, score };
  }
  return best && best.score >= 0.5 ? best.value : undefined;
}

/**
 * The enum member that appears in the action's own phrasing by coincidence.
 *
 * When examples mention *several* of an enum's values they are demonstrating
 * the argument — "take me to billing", "go to the team page" teach navigate's
 * destinations, and stripping them would leave nothing to match on. When only
 * one value shows up it is part of how the action is named, not a value being
 * taught: inviteMember's examples say "member" and never say "admin".
 */
function incidentalOption(options: string[], actionPhrases?: string[]): string | undefined {
  if (!actionPhrases?.length || options.length < 2) return undefined;
  const phraseTokens = new Set(actionPhrases.flatMap((p) => tokenize(splitCamel(p))));
  const mentioned = options.filter((option) =>
    tokenize(splitCamel(option)).every((t) => phraseTokens.has(t))
  );
  return mentioned.length === 1 ? mentioned[0] : undefined;
}

/** Words that follow "in"/"near" without naming a place. */
const NOT_A_PLACE = new Set(
  ("the this that these those catalogue catalog list total detail details general " +
    "your our their my his her its any all some each every here there").split(" ")
);

// Question scaffolding and field words are not search terms: "what is Coastal
// Sensors id?" is a search for "Coastal Sensors".
const COMMAND_WORDS = new Set(
  ("find search show list get look fetch display give tell open see all any my me the a an of " +
    "for please what which is are was were does do did whose id ids how many much we our us " +
    "have has had there their about").split(" ")
);

/**
 * "find the sensors project" is not a search for "find the sensors project".
 * Strip the instruction and the action's own subject noun, leaving the part
 * the user actually wants matched.
 */
function searchTerms(message: string, actionName?: string): string {
  const actionWords = new Set(
    actionName ? tokenize(splitCamel(actionName)) : []
  );
  const kept = message
    .replace(/[?!.]+$/, "")
    .split(/\s+/)
    .filter((word) => {
      const bare = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
      if (!bare) return false;
      if (COMMAND_WORDS.has(bare)) return false;
      return !tokenize(bare).every((t) => actionWords.has(t));
    });
  // Nothing left means the user named no filter at all ("show my projects"),
  // which is a request for everything — not a search for the sentence.
  return kept.join(" ").trim();
}

function explain(input: GenerateInput): string {
  const stage = input.stage ?? {};
  if (stage.summaries?.length) {
    return capitalize(stage.summaries.join(". ")) + ".";
  }
  const doc = stage.knowledge?.[0]?.trim();
  if (doc) return firstSentences(stripMarkdown(doc), 2);
  const facts = stage.facts?.trim();
  if (!facts || facts === "(none)") {
    return "I don't have anything in this product that answers that yet.";
  }
  const lines = facts
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.endsWith(":") && l !== "(none)");
  return lines.slice(0, 3).join(" ").slice(0, 500);
}

/** Documentation is written in markdown; an answer is not. */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSentences(text: string, count: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const parts = flat.match(/[^.!?]+[.!?]+/g);
  if (!parts?.length) return flat.slice(0, 400);
  return parts.slice(0, count).join(" ").trim();
}

/**
 * "do it" and "change it" are under-specified and need a question back.
 * "Write me a poem about databases" is perfectly specific and needs an honest
 * "that is not something this product knows about". The difference is whether
 * the user gave us anything to work with, not how the sentence starts.
 */
function isAnswerable(message: string, hasKnowledge = false): boolean {
  const content = tokenize(message).length;
  if (content >= 2) return true;
  // A single-topic question is still a question when the docs cover it:
  // "what does magnitude mean?" is one content word and perfectly clear.
  return content === 1 && hasKnowledge && message.trim().endsWith("?");
}

function whatDoYouMean(message: string): string {
  return message.trim().length
    ? "Could you say a bit more about what you'd like to do?"
    : "What would you like to do?";
}

function splitCamel(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.!?,;:]+$/, "").trim();
}
