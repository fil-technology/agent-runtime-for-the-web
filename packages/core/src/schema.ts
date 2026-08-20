import type { ZodType, ZodTypeAny } from "zod";

/**
 * Minimal Zod -> JSON Schema conversion.
 *
 * Deliberately covers only the subset an action input should use. Anything
 * outside the subset throws at agent definition time rather than producing a
 * schema the model silently cannot satisfy.
 */
export type JsonSchema = Record<string, any>;

/**
 * Zod 3 and Zod 4 describe schemas completely differently: v3 hangs everything
 * off `_def.typeName` ("ZodObject"), v4 off `def.type` ("object"). An
 * application picks its own zod, and today `npm install zod` gives v4 — so the
 * runtime reads both rather than dictating which one you may use.
 */
function def(schema: ZodTypeAny): any {
  return (schema as any)?.def ?? (schema as any)?._def;
}

/** Normalised type name, lower-case and without the Zod prefix. */
function typeName(schema: ZodTypeAny): string {
  const d = def(schema);
  if (!d) return "unknown";
  if (typeof d.type === "string") return d.type; // zod 4
  if (typeof d.typeName === "string") {
    return d.typeName.replace(/^Zod/, "").toLowerCase(); // zod 3
  }
  return "unknown";
}

/** The wrapped schema of an optional/nullable/default, in either version. */
function inner(schema: ZodTypeAny): ZodTypeAny {
  const d = def(schema);
  return d?.innerType ?? d?.type;
}

/** Object fields, in either version. */
function shapeOf(schema: ZodTypeAny): Record<string, ZodTypeAny> {
  const d = def(schema);
  if (!d) return {};
  const shape = (schema as any).shape ?? d.shape;
  return typeof shape === "function" ? shape() : (shape ?? {});
}

/** Enum members, in either version. */
function enumValues(schema: ZodTypeAny): string[] {
  const d = def(schema);
  if (Array.isArray(d?.values)) return d.values;
  if (d?.entries) return Object.values(d.entries) as string[];
  const options = (schema as any).options;
  return Array.isArray(options) ? options : [];
}

/** Array element schema, in either version. */
function elementOf(schema: ZodTypeAny): ZodTypeAny {
  const d = def(schema);
  return d?.element ?? d?.type;
}

/** Union branches, in either version. */
function optionsOf(schema: ZodTypeAny): ZodTypeAny[] {
  const d = def(schema);
  const options = d?.options;
  if (!options) return [];
  return Array.isArray(options) ? options : [...options.values()];
}

export function toJsonSchema(schema: ZodTypeAny, path = "input"): JsonSchema {
  const d = def(schema);
  const description = d?.description as string | undefined;
  const withMeta = (out: JsonSchema): JsonSchema =>
    description ? { ...out, description } : out;

  switch (typeName(schema)) {
    case "string":
      return withMeta({ type: "string" });
    case "number":
    case "int":
      return withMeta({ type: "number" });
    case "boolean":
      return withMeta({ type: "boolean" });
    case "literal": {
      const values = Array.isArray(d.values) ? d.values : [d.value];
      return withMeta(values.length === 1 ? { const: values[0] } : { enum: values });
    }
    case "enum":
      return withMeta({ type: "string", enum: enumValues(schema) });
    case "nativeenum":
      return withMeta({ enum: Object.values(d.values ?? d.entries ?? {}) });
    case "array":
      return withMeta({
        type: "array",
        items: toJsonSchema(elementOf(schema), `${path}[]`),
      });
    case "optional":
    case "nullable":
      return toJsonSchema(inner(schema), path);
    case "default":
      return {
        ...toJsonSchema(inner(schema), path),
        default: typeof d.defaultValue === "function" ? d.defaultValue() : d.defaultValue,
      };
    case "effects":
    case "pipe":
    case "transform":
      return toJsonSchema(d.schema ?? d.in ?? inner(schema), path);
    case "record":
      return withMeta({ type: "object", additionalProperties: true });
    case "any":
    case "unknown":
      return withMeta({});
    case "union":
    case "discriminatedunion":
      return withMeta({
        anyOf: optionsOf(schema).map((o, i) => toJsonSchema(o, `${path}|${i}`)),
      });
    case "object": {
      const shape = shapeOf(schema);
      const properties: JsonSchema = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = toJsonSchema(value, `${path}.${key}`);
        if (!isOptional(value)) required.push(key);
      }
      return withMeta({
        type: "object",
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: false,
      });
    }
    default:
      throw new Error(
        `Unsupported schema type "${typeName(schema)}" at ${path}. ` +
          `Action inputs support: object, string, number, boolean, enum, literal, array, union, record, optional, nullable, default.`
      );
  }
}

export function isOptional(schema: ZodTypeAny): boolean {
  const name = typeName(schema);
  if (name === "optional" || name === "default") return true;
  if (name === "nullable") return isOptional(inner(schema));
  return false;
}

/** Human/model readable rendering, used in prompts and error messages. */
export function describeSchema(schema: ZodType<any>, indent = ""): string {
  const d = def(schema as ZodTypeAny);
  switch (typeName(schema as ZodTypeAny)) {
    case "object": {
      const entries = Object.entries(shapeOf(schema as ZodTypeAny));
      if (!entries.length) return "{}";
      const inner = entries
        .map(([key, value]) => {
          const opt = isOptional(value) ? "?" : "";
          const desc = def(value)?.description;
          return `${indent}  ${key}${opt}: ${describeSchema(
            value,
            `${indent}  `
          )}${desc ? `  // ${desc}` : ""}`;
        })
        .join("\n");
      return `{\n${inner}\n${indent}}`;
    }
    case "optional":
    case "nullable":
    case "default":
      return describeSchema(inner(schema as ZodTypeAny), indent);
    case "effects":
    case "pipe":
    case "transform":
      return describeSchema(d.schema ?? d.in ?? inner(schema as ZodTypeAny), indent);
    case "array":
      return `${describeSchema(elementOf(schema as ZodTypeAny), indent)}[]`;
    case "enum":
      return enumValues(schema as ZodTypeAny).map((v) => JSON.stringify(v)).join(" | ");
    case "literal":
      return JSON.stringify(Array.isArray(d.values) ? d.values[0] : d.value);
    case "string":
      return "string";
    case "number":
    case "int":
      return "number";
    case "boolean":
      return "boolean";
    case "record":
      return "Record<string, unknown>";
    default:
      return typeName(schema as ZodTypeAny);
  }
}

/** Field names of an object schema, in declaration order. */
export function objectFields(schema: ZodTypeAny): string[] {
  if (typeName(schema) !== "object") return [];
  return Object.keys(shapeOf(schema));
}

/** Extract the first JSON value from a model's raw text output. */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to the first balanced {...} or [...] block.
    const start = candidate.search(/[[{]/);
    if (start === -1) throw new Error("no JSON value found in model output");
    const open = candidate[start]!;
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          return JSON.parse(candidate.slice(start, i + 1));
        }
      }
    }
    throw new Error("unbalanced JSON value in model output");
  }
}

/** Shared with the runtime so it does not need its own zod-version handling. */
/**
 * The schema for one field of an object input, unwrapped past optional/default.
 * Returns undefined for anything that is not a plain object schema.
 */
export function fieldSchema(schema: ZodTypeAny, field: string): ZodTypeAny | undefined {
  const found = shapeOf(schema)[field];
  if (!found) return undefined;
  let current: ZodTypeAny = found;
  // optional/default/nullable wrap the thing we actually want to look at.
  for (let depth = 0; depth < 5; depth += 1) {
    const kind = typeName(current);
    if (kind !== "optional" && kind !== "default" && kind !== "nullable") break;
    const next = inner(current);
    if (!next) break;
    current = next;
  }
  return current;
}

/** Enum members of a field, or an empty array when it is not an enum. */
export function fieldEnumValues(schema: ZodTypeAny, field: string): string[] {
  const found = fieldSchema(schema, field);
  return found && typeName(found) === "enum" ? enumValues(found) : [];
}

export { typeName as schemaTypeName, shapeOf as schemaShape };
