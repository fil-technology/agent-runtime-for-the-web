import type { JsonValue } from "../types.js";

/**
 * Answering a specific question from structured data, deterministically.
 *
 * An action returns a whole record; the user asks about one part of it. Left
 * alone, a rule-based provider replies with the same summary sentence whatever
 * was asked, which makes the assistant look broken even though the data was
 * right there. This picks the field the question is about.
 *
 * It is not a model. It matches the question against field names, so it works
 * with whatever vocabulary the application already uses in its own data.
 */

/** Everyday words for things field names rarely spell out. */
const SYNONYMS: Record<string, string[]> = {
  place: ["where", "location", "located", "country", "city", "region", "area", "near"],
  location: ["where", "place", "country", "city", "region"],
  region: ["where", "country", "area"],
  time: ["when", "date", "happen", "happened", "occurred"],
  date: ["when", "time"],
  depth: ["deep", "deeply", "km"],
  magnitude: ["big", "large", "strong", "size", "strength", "power"],
  intensity: ["shaking", "felt", "strong"],
  status: ["state"],
  amount: ["cost", "price", "much", "total"],
  total: ["cost", "price", "much", "amount"],
  email: ["address", "contact"],
  name: ["called", "named"],
  owner: ["who", "owns", "belongs"],
  count: ["many", "number"],
};

/** Unit suffixes carried in the field name, e.g. depthKm. */
const UNITS: Record<string, string> = {
  km: "km",
  kg: "kg",
  ms: "ms",
  mb: "MB",
  gb: "GB",
  hz: "Hz",
};

/**
 * What shape of answer a question word demands.
 *
 * "when does my plan renew" names the field `plan` outright, so a pure name
 * match answers "team" — the right field for a different question. The
 * interrogative is the disambiguator: "when" wants a date, whatever else the
 * sentence happens to mention.
 */
const EXPECTED: Array<{ test: RegExp; kind: (value: string | number | boolean) => boolean }> = [
  {
    test: /\bwhen\b/i,
    kind: (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}([T ]|$)/.test(value),
  },
  {
    test: /\bhow (many|much)\b/i,
    kind: (value) => typeof value === "number",
  },
];

export interface FieldAnswer {
  label: string;
  value: string;
  field: string;
}

/**
 * Plain words, not search tokens.
 *
 * Retrieval strips "where", "when" and "how many" as stopwords — which is
 * right for finding documents and exactly wrong here, because those words are
 * the entire question.
 */
function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1)
    .map(stem);
}

function stem(word: string): string {
  for (const suffix of ["ies", "es", "s"]) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

/**
 * Questions that want an explanation, not a value.
 *
 * "why was it felt so far away?" contains the word "felt", which is also a
 * field name — answering it with `feltReports: 4210` is not a near miss, it is
 * a different question. Explanations come from documentation.
 */
const EXPLANATORY =
  /\b(why|how (come|does|do|did|is|are|can)|explain|what (causes?|makes?|does .* mean)|reason|because)\b/i;

export function answerFromFields(
  question: string,
  data: JsonValue | undefined
): FieldAnswer | undefined {
  if (!data || typeof data !== "object") return undefined;
  if (EXPLANATORY.test(question)) return undefined;

  // A list on screen is still an answerable record set: "what is Coastal
  // Sensors id?" names which row it means, so pick that row and read the
  // field from it rather than searching again.
  if (Array.isArray(data)) {
    const row = pickRow(question, data);
    return row ? answerFromFields(question, row) : undefined;
  }

  const asked = new Set(words(question));
  if (!asked.size) return undefined;

  const expected = EXPECTED.find((rule) => rule.test.test(question));

  let best: { entry: FieldAnswer; score: number } | undefined;

  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined || typeof value === "object") continue;

    const { label, unit } = splitUnit(key);
    const named = new Set(words(label));
    const implied = new Set((SYNONYMS[label.toLowerCase()] ?? []).flatMap(words));
    if (!named.size && !implied.size) continue;

    // Naming a field outright beats matching one of its everyday synonyms, and
    // ties go to the field the application declared first — which is the more
    // specific one in practice ("place" before "region").
    let score = 0;
    for (const token of named) if (asked.has(token)) score += 2;
    for (const token of implied) if (asked.has(token) && !named.has(token)) score += 1;
    if (!score) continue;
    // A field of the shape the question asked for outranks one that merely
    // shares a word with it.
    if (expected?.kind(value)) score += 2;

    if (!best || score > best.score) {
      best = {
        score,
        entry: {
          field: key,
          label: humanise(label),
          value: formatValue(value, unit),
        },
      };
    }
  }

  return best?.entry;
}

/** ISO timestamps are data, not something to read out loud. */
function formatValue(value: string | number | boolean, unit?: string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toUTCString();
  }
  return unit ? `${value} ${unit}` : String(value);
}

/**
 * Which row the question is about.
 *
 * Scored on how much of a row's own text the question repeats, so a row has to
 * be named — not merely be first in the list.
 */
function pickRow(question: string, rows: JsonValue[]): JsonValue | undefined {
  const asked = new Set(words(question));
  let best: { row: JsonValue; score: number } | undefined;

  let runnerUp = 0;

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const text = Object.entries(row)
      .filter(([key, value]) => typeof value === "string" && !/id$/i.test(key))
      .map(([, value]) => value as string)
      .join(" ");
    const rowWords = new Set(words(text));
    if (!rowWords.size) continue;

    // Count how much of the row the question names. Scoring as a *fraction* of
    // the row would punish rows that simply carry more fields, which has
    // nothing to do with whether this is the row being asked about.
    let matched = 0;
    for (const word of rowWords) if (asked.has(word)) matched += 1;

    if (!best || matched > best.score) {
      runnerUp = best?.score ?? 0;
      best = { row, score: matched };
    } else if (matched > runnerUp) {
      runnerUp = matched;
    }
  }

  // A tie means the question did not single out a row, and guessing between
  // two records is worse than searching properly.
  return best && best.score >= 1 && best.score > runnerUp ? best.row : undefined;
}

function splitUnit(key: string): { label: string; unit?: string } {
  const match = key.match(/^(.*?)([A-Z][a-z]{1,2})$/);
  const suffix = match?.[2]?.toLowerCase();
  if (match && suffix && suffix in UNITS) {
    return { label: match[1]!, unit: UNITS[suffix] };
  }
  return { label: key };
}

/** "feltReports" -> "Felt reports": sentence case, not title case. */
function humanise(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
