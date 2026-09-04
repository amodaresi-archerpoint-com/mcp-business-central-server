import { describe, expect, it } from "vitest";
import {
  buildQueryString,
  eqFilter,
  escapeODataLiteral,
  validateFieldName,
} from "../src/bc/odata.js";

describe("escapeODataLiteral", () => {
  it("escapes simple strings", () => {
    expect(escapeODataLiteral("Acme")).toBe("'Acme'");
  });

  it("doubles single quotes inside strings", () => {
    expect(escapeODataLiteral("O'Brien")).toBe("'O''Brien'");
  });

  it("handles empty strings", () => {
    expect(escapeODataLiteral("")).toBe("''");
  });

  it("formats numbers without quotes", () => {
    expect(escapeODataLiteral(42)).toBe("42");
    expect(escapeODataLiteral(3.14)).toBe("3.14");
    expect(escapeODataLiteral(-5)).toBe("-5");
  });

  it("rejects non-finite numbers", () => {
    expect(() => escapeODataLiteral(Infinity)).toThrow();
    expect(() => escapeODataLiteral(NaN)).toThrow();
  });

  it("formats booleans without quotes", () => {
    expect(escapeODataLiteral(true)).toBe("true");
    expect(escapeODataLiteral(false)).toBe("false");
  });

  it("formats null as literal null", () => {
    expect(escapeODataLiteral(null)).toBe("null");
    expect(escapeODataLiteral(undefined)).toBe("null");
  });

  it("formats dates as ISO strings", () => {
    const d = new Date("2024-01-15T10:30:00Z");
    expect(escapeODataLiteral(d)).toBe("2024-01-15T10:30:00.000Z");
  });
});

describe("validateFieldName", () => {
  it("accepts simple identifiers", () => {
    expect(() => validateFieldName("name")).not.toThrow();
    expect(() => validateFieldName("balance_lcy")).not.toThrow();
    expect(() => validateFieldName("Customer123")).not.toThrow();
  });

  it("accepts navigation property paths", () => {
    expect(() => validateFieldName("customer.name")).not.toThrow();
  });

  it("rejects injection attempts", () => {
    expect(() => validateFieldName("name eq 'x' or 1 eq 1")).toThrow();
    expect(() => validateFieldName("name; DROP TABLE")).toThrow();
    expect(() => validateFieldName("")).toThrow();
    expect(() => validateFieldName("123abc")).toThrow();
  });
});

describe("eqFilter", () => {
  it("composes a safe equality filter for strings", () => {
    expect(eqFilter("name", "Acme Corp")).toBe("name eq 'Acme Corp'");
  });

  it("composes a safe equality filter with quote escaping", () => {
    expect(eqFilter("name", "O'Brien")).toBe("name eq 'O''Brien'");
  });

  it("composes for numbers and booleans", () => {
    expect(eqFilter("balance", 0)).toBe("balance eq 0");
    expect(eqFilter("blocked", true)).toBe("blocked eq true");
  });

  it("rejects malicious field names", () => {
    expect(() => eqFilter("name eq 'x' or 1 eq 1 --", "x")).toThrow();
  });
});

describe("buildQueryString", () => {
  it("returns empty string when nothing is set", () => {
    expect(buildQueryString({})).toBe("");
  });

  it("builds a full query string with multiple options", () => {
    const qs = buildQueryString({
      filter: "balance gt 1000",
      select: ["id", "name"],
      expand: ["salesLines"],
      orderBy: "name asc",
      top: 10,
      skip: 20,
      count: true,
    });
    // URLSearchParams encodes spaces as + and uses URL encoding.
    expect(qs).toContain("%24filter=balance+gt+1000");
    expect(qs).toContain("%24select=id%2Cname");
    expect(qs).toContain("%24expand=salesLines");
    expect(qs).toContain("%24orderby=name+asc");
    expect(qs).toContain("%24top=10");
    expect(qs).toContain("%24skip=20");
    expect(qs).toContain("%24count=true");
  });
});
