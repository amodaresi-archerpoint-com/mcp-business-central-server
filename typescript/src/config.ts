import { z } from "zod";

/**
 * BC URL shape detection.
 *
 * SaaS:    https://api.businesscentral.dynamics.com/v2.0/{tenant}/{environment}/api/{publisher}/{group}/{version}
 *          (or the standard /api/v2.0)
 * On-prem: https://{host}:{port}/{instance}/api/{publisher}/{group}/{version}
 *
 * The user supplies the FULL base URL up to and including /api/.../{version}.
 * We don't try to construct it for them — too many on-prem variations.
 */

const AuthTypeSchema = z.enum(["oauth_client_credentials", "basic"]);
export type AuthType = z.infer<typeof AuthTypeSchema>;

const BaseConfigSchema = z.object({
  // The full BC API base URL up to and including the version segment.
  // Examples:
  //   https://api.businesscentral.dynamics.com/v2.0/{tenant}/Production/api/v2.0
  //   https://bc.contoso.local:7048/BC/api/v2.0
  baseUrl: z.string().url(),

  // Default company name or ID. Tools accept a `company` arg to override.
  // If neither is provided, list_companies must be called first.
  defaultCompany: z.string().optional(),

  authType: AuthTypeSchema,

  // Read-only mode: when true, write tools (create/update/delete/invoke) are disabled.
  readOnly: z.boolean().default(false),

  // Require explicit confirmation flag on write operations.
  // When true, write tools require `confirm: true` in their input.
  requireWriteConfirmation: z.boolean().default(true),

  // Metadata cache TTL in seconds. 0 disables caching.
  metadataCacheTtlSec: z.number().int().nonnegative().default(3600),

  // Request timeout in milliseconds.
  requestTimeoutMs: z.number().int().positive().default(30_000),

  // For on-prem with self-signed certs. NEVER set this for SaaS.
  rejectUnauthorized: z.boolean().default(true),
});

const OAuthConfigSchema = BaseConfigSchema.extend({
  authType: z.literal("oauth_client_credentials"),
  tenantId: z.string().min(1, "BC_TENANT_ID is required for OAuth"),
  clientId: z.string().min(1, "BC_CLIENT_ID is required for OAuth"),
  clientSecret: z.string().min(1, "BC_CLIENT_SECRET is required for OAuth"),
  // Scope defaults to BC's resource scope. Override only if your environment differs.
  scope: z
    .string()
    .default("https://api.businesscentral.dynamics.com/.default"),
});

const BasicConfigSchema = BaseConfigSchema.extend({
  authType: z.literal("basic"),
  username: z.string().min(1, "BC_USER is required for basic auth"),
  password: z.string().min(1, "BC_PASS is required for basic auth"),
});

export const ConfigSchema = z.discriminatedUnion("authType", [
  OAuthConfigSchema,
  BasicConfigSchema,
]);

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Build config from process.env. Throws ZodError with all problems at once
 * if anything is missing or malformed.
 */
export function loadConfigFromEnv(): Config {
  const env = process.env;

  const authType: AuthType =
    (env["BC_AUTH_TYPE"] as AuthType) ??
    (env["BC_CLIENT_ID"] ? "oauth_client_credentials" : "basic");

  const common = {
    baseUrl: env["BC_URL_SERVER"] ?? env["BC_BASE_URL"],
    defaultCompany: env["BC_COMPANY"],
    readOnly: parseBool(env["BC_READ_ONLY"]) ?? false,
    requireWriteConfirmation:
      parseBool(env["BC_REQUIRE_WRITE_CONFIRMATION"]) ?? true,
    metadataCacheTtlSec: env["BC_METADATA_CACHE_TTL_SEC"]
      ? Number(env["BC_METADATA_CACHE_TTL_SEC"])
      : 3600,
    requestTimeoutMs: env["BC_REQUEST_TIMEOUT_MS"]
      ? Number(env["BC_REQUEST_TIMEOUT_MS"])
      : 30_000,
    rejectUnauthorized: parseBool(env["BC_REJECT_UNAUTHORIZED"]) ?? true,
  };

  if (authType === "oauth_client_credentials") {
    return ConfigSchema.parse({
      ...common,
      authType,
      tenantId: env["BC_TENANT_ID"],
      clientId: env["BC_CLIENT_ID"],
      clientSecret: env["BC_CLIENT_SECRET"],
      scope: env["BC_SCOPE"],
    });
  }

  return ConfigSchema.parse({
    ...common,
    authType: "basic",
    username: env["BC_USER"] ?? env["BC_USERNAME"],
    password: env["BC_PASS"] ?? env["BC_PASSWORD"],
  });
}

function parseBool(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}
