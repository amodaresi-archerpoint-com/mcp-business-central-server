#!/usr/bin/env node
// End-to-end connection check against the live BC environment in .env:
// auth -> $metadata -> a company-scoped query.
//
//   npm run smoke
//   npm run smoke -- ItemList        # also fetch schema + 2 rows for that set
//
// Exits non-zero on the first failure, so it is usable as a gate.
import { callTool, connect, loadEnvFile, parseResult } from "./_env.mjs";

const entitySet = process.argv[2];
const envFile = process.env["BC_ENV_FILE"] ?? ".env";

const env = loadEnvFile(envFile);
const redact = (k, v) =>
  /SECRET|PASS|KEY/.test(k) ? `<set:${v.length} chars>` : v;
console.log(`config (${envFile}):`);
for (const k of ["BC_BASE_URL", "BC_COMPANY", "BC_AUTH_TYPE", "BC_ENDPOINT_STYLE", "BC_READ_ONLY"]) {
  if (env[k]) console.log(`  ${k.padEnd(20)} = ${redact(k, env[k])}`);
}

let client;
let failed = false;
const step = async (label, fn) => {
  try {
    const out = await fn();
    console.log(`  PASS  ${label}${out ? ` — ${out}` : ""}`);
  } catch (err) {
    console.log(`  FAIL  ${label}\n        ${err?.message ?? err}`);
    failed = true;
  }
};
const must = async (tool, args) => {
  const { isError, text } = await callTool(client, tool, args);
  if (isError) throw new Error(text.split("\n").slice(0, 4).join("\n        "));
  return text;
};

try {
  client = await connect({ envFile, name: "smoke-test" });
  console.log("\nchecks:");

  await step("stdio handshake + tool registration", async () => {
    const { tools } = await client.listTools();
    if (tools.length === 0) throw new Error("server registered no tools");
    return `${tools.length} tools`;
  });

  // Exercises auth and $metadata parsing in one call.
  await step("auth + $metadata (bc_list_entity_sets)", async () => {
    const r = parseResult(await must("bc_list_entity_sets", {}));
    if (!r.count) throw new Error("no entity sets returned");
    return `${r.count} entity sets published`;
  });

  await step("bc_list_companies", async () => {
    const r = parseResult(await must("bc_list_companies", {}));
    const first = Array.isArray(r) ? r[0] : undefined;
    if (!first) throw new Error("no companies returned");
    // Field names differ between the api and odata endpoint styles.
    const label = first.name ?? first.Name ?? "(unnamed)";
    return `${r.length} companies, first = ${label}`;
  });

  if (entitySet) {
    await step(`schema for ${entitySet}`, async () => {
      const s = parseResult(await must("bc_get_entity_schema", { entitySet }));
      const keys = (s.fields ?? []).filter((f) => f.isKey).map((f) => f.name);
      return `${s.fields?.length ?? 0} fields, key(s) ${JSON.stringify(keys)}`;
    });

    await step(`company-scoped read of ${entitySet}`, async () => {
      const r = parseResult(await must("bc_list_entities", { entitySet, top: 2 }));
      return `${r.recordCount} record(s)`;
    });
  } else {
    console.log("  SKIP  entity read — pass a set name, e.g. `npm run smoke -- ItemList`");
  }
} catch (err) {
  console.error(`\nFATAL: ${err?.message ?? err}`);
  failed = true;
} finally {
  await client?.close().catch(() => {});
}

console.log(failed ? "\nRESULT: FAILED" : "\nRESULT: OK");
process.exitCode = failed ? 1 : 0;
