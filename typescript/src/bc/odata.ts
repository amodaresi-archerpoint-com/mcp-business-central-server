/**
 * OData v4 query builder for Business Central.
 *
 * The biggest trap is $filter string escaping. BC follows OData v4 rules:
 *   - String literals: 'value' (single quotes)
 *   - Single quotes inside strings: doubled ('O''Brien')
 *   - GUIDs: no quotes, raw hex (12345678-1234-1234-1234-123456789012)
 *   - Numbers/booleans: no quotes
 *   - Dates: 2024-01-15 or 2024-01-15T00:00:00Z
 *   - null: literal `null`
 *
 * We provide both:
 *   1. A raw `filter` string passthrough (for power users who know OData)
 *   2. A typed equality helper (the safe default for tools)
 */

export interface ODataQueryOptions {
  filter?: string;
  select?: string[];
  expand?: string[];
  orderBy?: string;
  top?: number;
  skip?: number;
  count?: boolean;
}

export function buildQueryString(opts: ODataQueryOptions): string {
  const params = new URLSearchParams();
  if (opts.filter) params.set("$filter", opts.filter);
  if (opts.select?.length) params.set("$select", opts.select.join(","));
  if (opts.expand?.length) params.set("$expand", opts.expand.join(","));
  if (opts.orderBy) params.set("$orderby", opts.orderBy);
  if (opts.top !== undefined) params.set("$top", String(opts.top));
  if (opts.skip !== undefined) params.set("$skip", String(opts.skip));
  if (opts.count) params.set("$count", "true");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Escape a value for use as an OData literal in a $filter expression.
 * Returns the value WITH appropriate quoting/formatting — drop directly into a filter.
 */
export function escapeODataLiteral(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot encode non-finite number in OData filter: ${value}`);
    }
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    // GUID detection — BC accepts unquoted GUIDs in $filter for Edm.Guid columns.
    // We err on the side of quoting; BC also accepts quoted GUIDs in most contexts.
    return `'${value.replace(/'/g, "''")}'`;
  }
  throw new Error(
    `Unsupported value type for OData filter: ${typeof value} (${String(value)})`,
  );
}

/**
 * Build a simple equality filter: escape value and produce `field eq <literal>`.
 */
export function eqFilter(field: string, value: unknown): string {
  validateFieldName(field);
  return `${field} eq ${escapeODataLiteral(value)}`;
}

/**
 * Defense against filter injection through field names. BC field names are
 * alphanumeric + underscore. Allow dots for navigation properties.
 */
export function validateFieldName(field: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(field)) {
    throw new Error(`Invalid OData field name: ${field}`);
  }
}
