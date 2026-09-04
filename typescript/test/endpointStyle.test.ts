import { describe, expect, it } from "vitest";
import { companySegment } from "../src/bc/client.js";
import { detectEndpointStyle } from "../src/config.js";

describe("detectEndpointStyle", () => {
  it("detects the SaaS ODataV4 root", () => {
    expect(
      detectEndpointStyle(
        "https://api.businesscentral.dynamics.com/v2.0/tenant/Sandbox/ODataV4",
      ),
    ).toBe("odata");
  });

  it("detects an on-prem ODataV4 root", () => {
    expect(detectEndpointStyle("https://bc.contoso.local:7048/BC/ODataV4")).toBe(
      "odata",
    );
  });

  it("is case-insensitive and tolerates a trailing slash", () => {
    expect(detectEndpointStyle("https://host/BC/odatav4/")).toBe("odata");
  });

  it("detects the legacy /OData segment", () => {
    expect(detectEndpointStyle("https://host/BC/OData")).toBe("odata");
  });

  it("defaults to api for API endpoints", () => {
    expect(
      detectEndpointStyle(
        "https://api.businesscentral.dynamics.com/v2.0/tenant/Sandbox/api/v2.0",
      ),
    ).toBe("api");
  });

  it("defaults to api for custom API routes", () => {
    expect(detectEndpointStyle("https://host/BC/api/archerpoint/arc/v1.0")).toBe(
      "api",
    );
  });

  it("defaults to api when the URL is missing", () => {
    expect(detectEndpointStyle(undefined)).toBe("api");
  });
});

describe("companySegment", () => {
  const guid = "a4bc6898-4591-4cf7-9990-293a0a0d66b7";

  it("uses companies({guid}) for api style", () => {
    expect(companySegment("api", guid)).toBe(`companies(${guid})`);
  });

  it("prefers the immutable Id form for odata style", () => {
    expect(companySegment("odata", guid)).toBe(`Company(Id=${guid})`);
  });

  it("falls back to the quoted name for odata style", () => {
    expect(companySegment("odata", "CRONUS")).toBe("Company('CRONUS')");
  });

  it("percent-encodes spaces and commas in company names", () => {
    expect(companySegment("odata", "CRONUS USA, Inc.")).toBe(
      "Company('CRONUS%20USA%2C%20Inc.')",
    );
  });

  it("doubles embedded single quotes per OData rules", () => {
    // "O'Brien Ltd" -> O''Brien Ltd. encodeURIComponent leaves ' unescaped by
    // spec, so the doubled quotes stay literal — which is what OData expects.
    expect(companySegment("odata", "O'Brien Ltd")).toBe(
      "Company('O''Brien%20Ltd')",
    );
  });

  it("treats a GUID as a name when it is not a real GUID", () => {
    expect(companySegment("odata", "not-a-guid")).toBe("Company('not-a-guid')");
  });

  it("does not double-encode an already-encoded name", () => {
    // Real case: BC_COMPANY copied out of a browser address bar.
    expect(companySegment("odata", "AP%20V28%20Test")).toBe(
      "Company('AP%20V28%20Test')",
    );
  });

  it("is idempotent for an encoded name containing a comma", () => {
    expect(companySegment("odata", "CRONUS%20USA%2C%20Inc.")).toBe(
      "Company('CRONUS%20USA%2C%20Inc.')",
    );
  });

  it("falls back to the literal name on a malformed escape", () => {
    expect(companySegment("odata", "100%25 Fresh")).toBe(
      "Company('100%25%20Fresh')",
    );
    expect(companySegment("odata", "Discount %ZZ Co")).toBe(
      "Company('Discount%20%25ZZ%20Co')",
    );
  });
});
