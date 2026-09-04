import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BCClient } from "../bc/client.js";
import type { MetadataCache } from "../bc/metadata.js";
import { eqFilter } from "../bc/odata.js";
import type { Config } from "../config.js";
import {
  companyOptionSchema,
  confirmFlagSchema,
  ensureWriteConfirmed,
  ensureWritesAllowed,
  errorResult,
  jsonResult,
} from "./_helpers.js";

export interface ToolDeps {
  client: BCClient;
  metadata: MetadataCache;
  config: Config;
}

export function registerTools(server: McpServer, deps: ToolDeps): void {
  registerListCompanies(server, deps);
  registerListEntitySets(server, deps);
  registerGetEntitySchema(server, deps);
  registerListEntities(server, deps);
  registerGetEntity(server, deps);
  registerFindEntitiesByField(server, deps);
  registerCreateEntity(server, deps);
  registerUpdateEntity(server, deps);
  registerDeleteEntity(server, deps);
  registerInvokeAction(server, deps);
}

// ---------- discovery ----------

function registerListCompanies(
  server: McpServer,
  { client, config }: ToolDeps,
): void {
  server.registerTool(
    "bc_list_companies",
    {
      title: "List BC Companies",
      description:
        "List all companies in the connected Business Central environment. Use this to discover valid values for the `company` parameter on other tools. On /api endpoints this returns id, name and displayName; on OData web service endpoints the records are returned as-is, because that entity uses different field names.",
      inputSchema: {},
    },
    async () => {
      try {
        const companies = await client.listCompanies();
        // The ODataV4 `Company` set does not use the api/v2.0 field names, so
        // projecting onto id/name/displayName there yields empty objects.
        if (config.endpointStyle === "odata") return jsonResult(companies);
        return jsonResult(
          companies.map((c) => ({
            id: c.id,
            name: c.name,
            displayName: c.displayName,
          })),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

function registerListEntitySets(
  server: McpServer,
  { metadata }: ToolDeps,
): void {
  server.registerTool(
    "bc_list_entity_sets",
    {
      title: "List BC Entity Sets",
      description:
        "List all entity set names available in this environment. On /api endpoints these are API pages (e.g. customers, items, salesOrders). On OData web services these are the Service Names registered on the Business Central Web Services page. Use the result as the `entitySet` parameter on data tools.",
      inputSchema: {},
    },
    async () => {
      try {
        const sets = await metadata.listEntitySets();
        return jsonResult({ entitySets: sets, count: sets.length });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

function registerGetEntitySchema(
  server: McpServer,
  { metadata }: ToolDeps,
): void {
  server.registerTool(
    "bc_get_entity_schema",
    {
      title: "Get BC Entity Schema",
      description:
        "Get the schema (fields, types, keys, navigation properties, bound actions) for a Business Central entity set. Cached per environment with the configured TTL.",
      inputSchema: {
        entitySet: z
          .string()
          .describe("Entity set name, e.g. 'customers' or 'salesOrders'."),
      },
    },
    async ({ entitySet }) => {
      try {
        const schema = await metadata.getEntitySchema(entitySet);
        if (!schema) {
          return errorResult(
            new Error(
              `Entity set "${entitySet}" not found. Use bc_list_entity_sets to see available sets.`,
            ),
          );
        }
        return jsonResult(schema);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

// ---------- read ----------

function registerListEntities(server: McpServer, { client }: ToolDeps): void {
  server.registerTool(
    "bc_list_entities",
    {
      title: "List BC Entities",
      description:
        "List records from a Business Central entity set with full OData v4 query support: $filter, $select, $expand, $orderby, $top, $skip, $count. Returns the records and a nextLink for pagination.",
      inputSchema: {
        entitySet: z
          .string()
          .describe("Entity set name, e.g. 'customers'."),
        filter: z
          .string()
          .optional()
          .describe(
            "Raw OData $filter expression. Example: \"balance gt 1000 and country eq 'US'\". Use OData v4 syntax. Strings are single-quoted; doubled single quotes inside.",
          ),
        select: z
          .array(z.string())
          .optional()
          .describe("Fields to return. Reduces response size. Example: ['id','name','balance']."),
        expand: z
          .array(z.string())
          .optional()
          .describe("Navigation properties to expand inline. Example: ['salesLines']."),
        orderBy: z
          .string()
          .optional()
          .describe("OData $orderby expression. Example: 'name asc' or 'balance desc'."),
        top: z
          .number()
          .int()
          .min(1)
          .max(20000)
          .default(20)
          .describe("Max records to return. Defaults to 20."),
        skip: z.number().int().min(0).optional(),
        count: z
          .boolean()
          .optional()
          .describe("If true, includes total record count in the response."),
        ...companyOptionSchema,
      },
    },
    async ({ entitySet, filter, select, expand, orderBy, top, skip, count, company }) => {
      try {
        const reqOpts: Parameters<BCClient["list"]>[0] = {
          path: entitySet,
          query: { top },
        };
        if (filter !== undefined) reqOpts.query!.filter = filter;
        if (select !== undefined) reqOpts.query!.select = select;
        if (expand !== undefined) reqOpts.query!.expand = expand;
        if (orderBy !== undefined) reqOpts.query!.orderBy = orderBy;
        if (skip !== undefined) reqOpts.query!.skip = skip;
        if (count !== undefined) reqOpts.query!.count = count;
        if (company !== undefined) reqOpts.company = company;

        const result = await client.list(reqOpts);
        return jsonResult({
          records: result.value,
          recordCount: result.value.length,
          totalCount: result.count,
          nextLink: result.nextLink,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

function registerGetEntity(server: McpServer, { client }: ToolDeps): void {
  server.registerTool(
    "bc_get_entity",
    {
      title: "Get BC Entity by ID",
      description:
        "Fetch a single Business Central record by its primary key. On /api endpoints the key is a systemId GUID. On OData web services the key is the page's ODataKeyFields — usually a quoted string, and composite keys are comma-separated.",
      inputSchema: {
        entitySet: z.string(),
        id: z
          .string()
          .describe(
            "Primary key literal, inserted verbatim between parentheses. GUID on /api endpoints (e.g. 'a4bc6898-...'); an OData key literal on web services (e.g. \"'PRODUCTLISTING'\" or \"Code='X',Type='Y'\").",
          ),
        select: z.array(z.string()).optional(),
        expand: z.array(z.string()).optional(),
        ...companyOptionSchema,
      },
    },
    async ({ entitySet, id, select, expand, company }) => {
      try {
        const reqOpts: Parameters<BCClient["getOne"]>[0] = {
          path: entitySet,
          id,
        };
        if (select !== undefined || expand !== undefined) {
          reqOpts.query = {};
          if (select !== undefined) reqOpts.query.select = select;
          if (expand !== undefined) reqOpts.query.expand = expand;
        }
        if (company !== undefined) reqOpts.company = company;

        const result = await client.getOne(reqOpts);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

function registerFindEntitiesByField(
  server: McpServer,
  { client }: ToolDeps,
): void {
  server.registerTool(
    "bc_find_entities_by_field",
    {
      title: "Find BC Entities by Field Value",
      description:
        "Search a Business Central entity set for records where a specific field equals a value. This is a safe equality search — for complex queries, use bc_list_entities with a $filter expression.",
      inputSchema: {
        entitySet: z.string(),
        field: z
          .string()
          .describe("Field name to match. Validated against OData identifier rules."),
        value: z
          .union([z.string(), z.number(), z.boolean(), z.null()])
          .describe("Value to match. Strings will be properly OData-escaped."),
        select: z.array(z.string()).optional(),
        top: z.number().int().min(1).max(1000).default(20),
        ...companyOptionSchema,
      },
    },
    async ({ entitySet, field, value, select, top, company }) => {
      try {
        const filter = eqFilter(field, value);
        const reqOpts: Parameters<BCClient["list"]>[0] = {
          path: entitySet,
          query: { filter, top },
        };
        if (select !== undefined) reqOpts.query!.select = select;
        if (company !== undefined) reqOpts.company = company;
        const result = await client.list(reqOpts);
        return jsonResult({
          records: result.value,
          recordCount: result.value.length,
          filterUsed: filter,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

// ---------- writes ----------

function registerCreateEntity(
  server: McpServer,
  { client, config }: ToolDeps,
): void {
  server.registerTool(
    "bc_create_entity",
    {
      title: "Create BC Entity",
      description:
        "Create a new Business Central record. Returns the created entity including its server-assigned id and @odata.etag. Requires confirm=true when write confirmation is enabled.",
      inputSchema: {
        entitySet: z.string(),
        fields: z
          .record(z.unknown())
          .describe("Field values for the new record."),
        ...confirmFlagSchema,
        ...companyOptionSchema,
      },
    },
    async ({ entitySet, fields, confirm, company }) => {
      try {
        ensureWritesAllowed(config, "bc_create_entity");
        ensureWriteConfirmed(config, "bc_create_entity", confirm);
        const reqOpts: Parameters<BCClient["create"]>[0] = {
          path: entitySet,
          body: fields,
        };
        if (company !== undefined) reqOpts.company = company;
        const result = await client.create(reqOpts);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

function registerUpdateEntity(
  server: McpServer,
  { client, config }: ToolDeps,
): void {
  server.registerTool(
    "bc_update_entity",
    {
      title: "Update BC Entity",
      description:
        "Update fields on an existing Business Central record by ID. Pass `etag` for safe optimistic concurrency (BC requires If-Match). Without an etag we use If-Match: * which bypasses concurrency checks — ALWAYS prefer fetching the record first and using its @odata.etag.",
      inputSchema: {
        entitySet: z.string(),
        id: z.string(),
        fields: z.record(z.unknown()),
        etag: z
          .string()
          .optional()
          .describe(
            "ETag from a prior GET (the @odata.etag field). Strongly recommended.",
          ),
        ...confirmFlagSchema,
        ...companyOptionSchema,
      },
    },
    async ({ entitySet, id, fields, etag, confirm, company }) => {
      try {
        ensureWritesAllowed(config, "bc_update_entity");
        ensureWriteConfirmed(config, "bc_update_entity", confirm);
        const reqOpts: Parameters<BCClient["update"]>[0] = {
          path: entitySet,
          id,
          body: fields,
        };
        if (etag !== undefined) reqOpts.ifMatch = etag;
        if (company !== undefined) reqOpts.company = company;
        const result = await client.update(reqOpts);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

function registerDeleteEntity(
  server: McpServer,
  { client, config }: ToolDeps,
): void {
  server.registerTool(
    "bc_delete_entity",
    {
      title: "Delete BC Entity",
      description:
        "Delete a Business Central record by ID. IRREVERSIBLE. Requires confirm=true when write confirmation is enabled. Pass `etag` for safe optimistic concurrency.",
      inputSchema: {
        entitySet: z.string(),
        id: z.string(),
        etag: z.string().optional(),
        ...confirmFlagSchema,
        ...companyOptionSchema,
      },
    },
    async ({ entitySet, id, etag, confirm, company }) => {
      try {
        ensureWritesAllowed(config, "bc_delete_entity");
        ensureWriteConfirmed(config, "bc_delete_entity", confirm);
        const reqOpts: Parameters<BCClient["delete"]>[0] = {
          path: entitySet,
          id,
        };
        if (etag !== undefined) reqOpts.ifMatch = etag;
        if (company !== undefined) reqOpts.company = company;
        await client.delete(reqOpts);
        return jsonResult({ deleted: true, entitySet, id });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

function registerInvokeAction(
  server: McpServer,
  { client, config }: ToolDeps,
): void {
  server.registerTool(
    "bc_invoke_action",
    {
      title: "Invoke BC Bound Action",
      description:
        "Invoke an OData bound action on a Business Central record (e.g. Microsoft.NAV.shipAndInvoice on a salesOrder). Pass the entity set, the record id, and the action name. Use bc_get_entity_schema to discover bound actions for an entity. Requires confirm=true when write confirmation is enabled.",
      inputSchema: {
        entitySet: z.string(),
        id: z
          .string()
          .optional()
          .describe(
            "Record ID for bound actions. Omit for unbound actions on the service root.",
          ),
        action: z
          .string()
          .describe(
            "Action name. May be plain (e.g. 'shipAndInvoice') — the server prefixes Microsoft.NAV. when needed.",
          ),
        parameters: z
          .record(z.unknown())
          .optional()
          .describe("Action input parameters."),
        ...confirmFlagSchema,
        ...companyOptionSchema,
      },
    },
    async ({ entitySet, id, action, parameters, confirm, company }) => {
      try {
        ensureWritesAllowed(config, "bc_invoke_action");
        ensureWriteConfirmed(config, "bc_invoke_action", confirm);

        // API endpoints namespace bound actions as Microsoft.NAV.{name};
        // OData web services use the shorter NAV.{name}.
        const defaultNamespace =
          config.endpointStyle === "odata" ? "NAV." : "Microsoft.NAV.";
        const actionSegment = action.includes(".")
          ? action
          : `${defaultNamespace}${action}`;
        const path = id
          ? `${entitySet}(${id})/${actionSegment}`
          : `${entitySet}/${actionSegment}`;

        const reqOpts: Parameters<BCClient["invokeAction"]>[0] = { path };
        if (parameters !== undefined) reqOpts.body = parameters;
        if (company !== undefined) reqOpts.company = company;

        const result = await client.invokeAction(reqOpts);
        return jsonResult({ invoked: actionSegment, result });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
