import type { z } from "zod";

const WRAPPERS = new Set(["optional", "default", "nullable", "prefault", "readonly", "catch"]);

function isArrayField(field: z.ZodType): boolean {
  let current: z.core.$ZodType = field;
  while (WRAPPERS.has(current._zod.def.type)) {
    current = (current._zod.def as unknown as { innerType: z.core.$ZodType }).innerType;
  }
  return current._zod.def.type === "array";
}

/** What an empty form input means for a field: empty text if allowed, else "clear it" (null), else "not provided". */
function emptyValue(field: z.ZodType): "" | null | undefined {
  if (field.safeParse("").success) return "";
  if (field.safeParse(null).success) return null;
  return undefined;
}

/**
 * Reads the fields a schema declares from a form, so one zod schema serves the MCP tool and
 * the web form alike. Array fields accept repeated or comma-separated values.
 */
export function formToInput(formData: FormData, schema: z.ZodObject): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.shape) as [string, z.ZodType][]) {
    const values = formData.getAll(key).filter((value): value is string => typeof value === "string");
    if (values.length === 0) continue;
    const value = isArrayField(field)
      ? values.flatMap((entry) => entry.split(",")).map((entry) => entry.trim()).filter(Boolean)
      : values[0]!.trim() === ""
        ? emptyValue(field)
        : values[0];
    if (value !== undefined) input[key] = value;
  }
  return input;
}
