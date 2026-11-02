import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/server";
import type { z } from "zod";

import type { Ctx } from "../domain/context";
import { isDomainError } from "../domain/errors";

/** A domain context plus what tools need to link humans back to the web app. */
export interface ToolContext extends Ctx {
  /** Absolute URL for an in-app path, on the origin the agent connected to. */
  url: (path: string) => string;
}

export interface PheanTool {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  annotations: ToolAnnotations;
  execute: (ctx: ToolContext, input: unknown) => Promise<CallToolResult>;
}

interface ToolSpec<S extends z.ZodObject, O extends object> {
  name: string;
  title: string;
  description: string;
  input: S;
  /** Read-only tools never change workspace state. */
  readOnly?: boolean;
  /** Destructive tools remove information (as opposed to adding or updating it). */
  destructive?: boolean;
  run: (ctx: ToolContext, input: z.output<S>) => Promise<O>;
  /** Text shown to the model; defaults to the JSON of the result. */
  format?: (output: O) => string;
}

/** Declares an MCP tool. Input arrives already validated against `input` by the SDK. */
export function defineTool<S extends z.ZodObject, O extends object>(spec: ToolSpec<S, O>): PheanTool {
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: spec.input,
    annotations: {
      title: spec.title,
      readOnlyHint: spec.readOnly ?? false,
      destructiveHint: spec.destructive ?? false,
      openWorldHint: false,
    },
    execute: async (ctx, input) => {
      try {
        const output = await spec.run(ctx, input as z.output<S>);
        return toolResult(output, spec.format?.(output));
      } catch (error) {
        return toolError(error);
      }
    },
  };
}

export function toolResult(output: object, text = JSON.stringify(output)): CallToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent: output as Record<string, unknown>,
  };
}

/** Expected failures carry an actionable message; anything else is logged and kept opaque. */
export function toolError(error: unknown): CallToolResult {
  if (isDomainError(error)) {
    return { isError: true, content: [{ type: "text", text: `${error.code}: ${error.message}` }] };
  }
  console.error("Phean MCP tool failed", error);
  return { isError: true, content: [{ type: "text", text: "internal_error: Phean could not complete this request." }] };
}
