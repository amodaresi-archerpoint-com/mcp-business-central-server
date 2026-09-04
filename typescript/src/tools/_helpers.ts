import { z } from "zod";
import type { Config } from "../config.js";

export function ensureWritesAllowed(config: Config, toolName: string): void {
  if (config.readOnly) {
    throw new Error(
      `Tool "${toolName}" is disabled because the server is running in read-only mode. ` +
        `Restart with BC_READ_ONLY=false to enable writes.`,
    );
  }
}

export function ensureWriteConfirmed(
  config: Config,
  toolName: string,
  confirmed: boolean | undefined,
): void {
  if (config.requireWriteConfirmation && !confirmed) {
    throw new Error(
      `Tool "${toolName}" requires \`confirm: true\` to execute. ` +
        `This is a write operation; review the inputs and re-call with confirm=true to proceed.`,
    );
  }
}

/** Optional company override — most tools take this. */
export const companyOptionSchema = {
  company: z
    .string()
    .optional()
    .describe(
      "Company name or GUID. If omitted, the server's default company is used.",
    ),
};

/** Confirmation flag for write tools. */
export const confirmFlagSchema = {
  confirm: z
    .boolean()
    .optional()
    .describe(
      "Must be true to execute this write operation when the server requires write confirmation.",
    ),
};

/** Standard JSON content envelope for tool results. */
export function jsonResult<T>(data: T): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: { result: data } as Record<string, unknown>,
  };
}

/** Formatted error result — surfaces BC error code/message clearly. */
export function errorResult(err: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const message =
    err instanceof Error ? err.message : `Unknown error: ${String(err)}`;
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}
