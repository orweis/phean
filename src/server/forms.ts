import type { z } from "zod";

const WRAPPERS = new Set(["optional", "default", "nullable", "prefault", "readonly", "catch"]);

function fieldType(field: z.ZodType): string {
  let current: z.core.$ZodType = field;
  while (WRAPPERS.has(current._zod.def.type)) {
    current = (current._zod.def as unknown as { innerType: z.core.$ZodType }).innerType;
  }
  return current._zod.def.type;
}

/** An object field posted as JSON text (a pipeline's definition, a run's inputs); left as text when it is not JSON, so the schema says what is wrong. */
function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** What an empty form input means for a field: empty text if allowed, else "clear it" (null), else "not provided". */
function emptyValue(field: z.ZodType): "" | null | undefined {
  if (field.safeParse("").success) return "";
  if (field.safeParse(null).success) return null;
  return undefined;
}

/**
 * Reads the fields a schema declares from a form, so one zod schema serves the MCP tool and
 * the web form alike. Array fields accept repeated or comma-separated values; object fields take
 * JSON, which a form's client part writes into a hidden input.
 */
export function formToInput(formData: FormData, schema: z.ZodObject): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.shape) as [string, z.ZodType][]) {
    const values = formData.getAll(key).filter((value): value is string => typeof value === "string");
    if (values.length === 0) continue;
    const type = fieldType(field);
    const value =
      type === "array"
        ? values.flatMap((entry) => entry.split(",")).map((entry) => entry.trim()).filter(Boolean)
        : values[0]!.trim() === ""
          ? emptyValue(field)
          : type === "object" || type === "record"
            ? parseJson(values[0]!)
            : values[0];
    if (value !== undefined) input[key] = value;
  }
  return input;
}
