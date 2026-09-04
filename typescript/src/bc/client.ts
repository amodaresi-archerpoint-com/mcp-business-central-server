import { Agent, request } from "undici";
import type { Config, EndpointStyle } from "../config.js";
import type { AuthProvider } from "./auth/types.js";
import { BCError, parseBCError } from "./errors.js";
import { buildQueryString, type ODataQueryOptions } from "./odata.js";

export interface BCRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  path: string; // path AFTER baseUrl, AFTER the company segment if companyScoped
  query?: ODataQueryOptions;
  body?: unknown;
  ifMatch?: string; // ETag for PATCH/DELETE
  /** If true, prefix path with the company segment. Default true. */
  companyScoped?: boolean;
  /** Override the default company. Accepts company ID (GUID) or name. */
  company?: string;
}

/**
 * Build the company URL segment for the configured endpoint family.
 *
 * "api"   -> companies({guid})            — keyed by systemId GUID
 * "odata" -> Company(Id={guid})           — preferred: the ID is immutable
 *            Company('{Name}')            — fallback: name is case-sensitive
 *
 * For the name form, embedded single quotes are doubled per OData rules and
 * the name is percent-encoded (spaces and commas are common in BC company
 * names, e.g. "CRONUS USA, Inc." -> CRONUS%20USA%2C%20Inc.). Note that
 * encodeURIComponent leaves ' unescaped, so the doubled quotes remain literal
 * in the URL — which is the form OData expects.
 */
export function companySegment(
  style: EndpointStyle,
  company: string,
): string {
  if (style === "api") return `companies(${company})`;
  if (isGuid(company)) return `Company(Id=${company})`;
  const name = decodeIfEncoded(company);
  return `Company('${encodeURIComponent(name.replace(/'/g, "''"))}')`;
}

/**
 * Company names are commonly copied out of a browser address bar, arriving
 * already percent-encoded ("AP%20V28%20Test"). Encoding that again would send
 * "AP%2520V28%2520Test", so decode first to keep the operation idempotent.
 */
function decodeIfEncoded(value: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(value)) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    // Malformed escape sequence — treat the value as a literal name.
    return value;
  }
}

export interface BCEntity {
  "@odata.etag"?: string;
  [key: string]: unknown;
}

/**
 * Shaped after the /api/v2.0 `companies` entity. The ODataV4 `Company` set
 * uses different field names, so extra keys are preserved and callers on that
 * endpoint should read the record as-is rather than these named fields.
 */
export interface BCCompany {
  id?: string;
  systemVersion?: string;
  name?: string;
  displayName?: string;
  businessProfileId?: string;
  systemCreatedAt?: string;
  systemCreatedBy?: string;
  systemModifiedAt?: string;
  systemModifiedBy?: string;
  [key: string]: unknown;
}

export class BCClient {
  private readonly dispatcher: Agent;
  // Map: company name -> id. Populated lazily.
  private companyIdCache: Map<string, string> | null = null;

  constructor(
    private readonly config: Config,
    private readonly auth: AuthProvider,
  ) {
    this.dispatcher = new Agent({
      connect: {
        rejectUnauthorized: config.rejectUnauthorized,
      },
      headersTimeout: config.requestTimeoutMs,
      bodyTimeout: config.requestTimeoutMs,
    });
  }

  /**
   * Generic request. Returns parsed JSON or null for 204 responses.
   */
  async fetch<T = unknown>(opts: BCRequestOptions): Promise<T | null> {
    const url = await this.buildUrl(opts);
    const headers: Record<string, string> = {
      authorization: await this.auth.getAuthHeader(),
      accept: "application/json",
    };
    let body: string | undefined;
    if (opts.body !== undefined && opts.method !== "GET") {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    if (opts.ifMatch) {
      headers["if-match"] = opts.ifMatch;
    } else if (
      opts.method === "PATCH" ||
      opts.method === "DELETE"
    ) {
      // BC requires If-Match. Use "*" only when the caller hasn't supplied an ETag.
      // This bypasses optimistic concurrency — surfaced clearly to the user via
      // the warn_on_etag_wildcard option in tool handlers.
      headers["if-match"] = "*";
    }

    const res = await request(url, {
      method: opts.method ?? "GET",
      headers,
      body,
      dispatcher: this.dispatcher,
    });

    if (res.statusCode === 204) {
      // Drain to release the socket.
      await res.body.dump();
      return null;
    }

    const text = await res.body.text();
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw parseBCError(res.statusCode, text);
    }
    return text ? (JSON.parse(text) as T) : null;
  }

  /** GET a list — returns the .value array and stripped @odata fields. */
  async list<T extends BCEntity = BCEntity>(
    opts: Omit<BCRequestOptions, "method" | "body">,
  ): Promise<{ value: T[]; nextLink?: string; count?: number }> {
    const result = await this.fetch<{
      value: T[];
      "@odata.nextLink"?: string;
      "@odata.count"?: number;
    }>({ ...opts, method: "GET" });
    if (!result) return { value: [] };
    const out: { value: T[]; nextLink?: string; count?: number } = {
      value: result.value ?? [],
    };
    if (result["@odata.nextLink"] !== undefined) {
      out.nextLink = result["@odata.nextLink"];
    }
    if (result["@odata.count"] !== undefined) {
      out.count = result["@odata.count"];
    }
    return out;
  }

  /** GET a single entity by primary key. */
  async getOne<T extends BCEntity = BCEntity>(
    opts: Omit<BCRequestOptions, "method" | "body"> & { id: string },
  ): Promise<T | null> {
    const path = `${opts.path}(${opts.id})`;
    return this.fetch<T>({ ...opts, path, method: "GET" });
  }

  /** POST — create. */
  async create<T extends BCEntity = BCEntity>(
    opts: Omit<BCRequestOptions, "method"> & { body: unknown },
  ): Promise<T | null> {
    return this.fetch<T>({ ...opts, method: "POST" });
  }

  /** PATCH — update by ID. Caller should pass ifMatch (ETag) when possible. */
  async update<T extends BCEntity = BCEntity>(
    opts: Omit<BCRequestOptions, "method"> & {
      id: string;
      body: unknown;
    },
  ): Promise<T | null> {
    const path = `${opts.path}(${opts.id})`;
    return this.fetch<T>({ ...opts, path, method: "PATCH" });
  }

  /** DELETE by ID. */
  async delete(
    opts: Omit<BCRequestOptions, "method" | "body"> & { id: string },
  ): Promise<void> {
    const path = `${opts.path}(${opts.id})`;
    await this.fetch({ ...opts, path, method: "DELETE" });
  }

  /**
   * Invoke an OData bound or unbound action.
   * For bound actions: `Microsoft.NAV.{actionName}` after the entity.
   *   e.g. /salesOrders({id})/Microsoft.NAV.shipAndInvoice
   */
  async invokeAction<T = unknown>(
    opts: Omit<BCRequestOptions, "method"> & { body?: unknown },
  ): Promise<T | null> {
    return this.fetch<T>({ ...opts, method: "POST" });
  }

  /**
   * List all companies in this environment. Companies are NOT scoped
   * to a parent company themselves.
   */
  async listCompanies(): Promise<BCCompany[]> {
    const odata = this.config.endpointStyle === "odata";
    try {
      const result = await this.fetch<{ value: BCCompany[] }>({
        method: "GET",
        path: odata ? "Company" : "companies",
        companyScoped: false,
      });
      return result?.value ?? [];
    } catch (err) {
      if (odata) {
        throw new Error(
          "Could not list companies from the ODataV4 endpoint. Unlike /api/v2.0, " +
            "the OData root does not reliably expose a company collection. Set " +
            "BC_COMPANY to the company GUID (preferred — it is immutable) or to the " +
            "exact, case-sensitive name shown on the Companies page in Business Central. " +
            `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      throw err;
    }
  }

  /**
   * Resolve a company name OR id into a company ID (GUID).
   * Names are matched against `name` first, then `displayName`.
   */
  async resolveCompanyId(nameOrId: string): Promise<string> {
    if (isGuid(nameOrId)) return nameOrId;

    if (!this.companyIdCache) {
      const companies = await this.listCompanies();
      this.companyIdCache = new Map();
      for (const c of companies) {
        // id/name are optional on BCCompany because the OData `Company` set
        // uses different field names; this path only runs for /api endpoints.
        if (!c.id) continue;
        if (c.name) this.companyIdCache.set(c.name, c.id);
        if (c.displayName) this.companyIdCache.set(c.displayName, c.id);
      }
    }
    const id = this.companyIdCache.get(nameOrId);
    if (!id) {
      throw new BCError({
        status: 404,
        message: `Company "${nameOrId}" not found in this environment.`,
        raw: "",
      });
    }
    return id;
  }

  /** Fetch the OData service metadata document (XML) for the environment. */
  async fetchMetadata(): Promise<string> {
    const url = `${this.trimSlash(this.config.baseUrl)}/$metadata`;
    const res = await request(url, {
      method: "GET",
      headers: {
        authorization: await this.auth.getAuthHeader(),
        accept: "application/xml",
      },
      dispatcher: this.dispatcher,
    });
    const text = await res.body.text();
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw parseBCError(res.statusCode, text);
    }
    return text;
  }

  private async buildUrl(opts: BCRequestOptions): Promise<string> {
    const base = this.trimSlash(this.config.baseUrl);
    const companyScoped = opts.companyScoped ?? true;
    const company = opts.company ?? this.config.defaultCompany;

    let path = opts.path.replace(/^\/+/, "");

    if (companyScoped) {
      if (!company) {
        throw new Error(
          "No company specified. Either set BC_COMPANY or pass `company` to the tool. " +
            "Use the bc_list_companies tool to find one.",
        );
      }
      if (this.config.endpointStyle === "odata") {
        // The ODataV4 root has no `companies` set to resolve names against, so
        // the supplied value is used as-is (GUID preferred, else exact name).
        path = `${companySegment("odata", company)}/${path}`;
      } else {
        const companyId = await this.resolveCompanyId(company);
        path = `${companySegment("api", companyId)}/${path}`;
      }
    }

    const qs = opts.query ? buildQueryString(opts.query) : "";
    return `${base}/${path}${qs}`;
  }

  private trimSlash(s: string): string {
    return s.replace(/\/+$/, "");
  }
}

function isGuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s,
  );
}
