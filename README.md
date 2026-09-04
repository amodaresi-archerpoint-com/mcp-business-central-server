# bc-mcp-server

A TypeScript MCP server for Microsoft Dynamics 365 Business Central. Designed to improve on the existing Python `mcp-business-central-server` with:

- **OAuth 2.0 client credentials** (S2S) and Basic auth.
- **Full OData v4 query support** (`$filter`, `$select`, `$expand`, `$orderby`, `$top`, `$skip`, `$count`).
- **Bound action invocation** (post documents, ship & invoice, approve, etc.).
- **Metadata caching** with configurable TTL.
- **Read-only mode + write confirmation** for safer agent usage.
- **Multi-company** — pass `company` per tool call, or set a default.
- **stdio + Streamable HTTP** transports.
- Targets **BC SaaS and on-prem** (you supply the base URL).

## Install

```bash
git clone <your-fork-url> bc-mcp-server
cd bc-mcp-server
npm install
npm run build
```

## Configure

Copy `.env.example` to `.env` and fill in credentials. The minimum for SaaS with OAuth:

```
BC_BASE_URL=https://api.businesscentral.dynamics.com/v2.0/{tenant-id}/Production/api/v2.0
BC_COMPANY=CRONUS USA, Inc.
BC_AUTH_TYPE=oauth_client_credentials
BC_TENANT_ID=...
BC_CLIENT_ID=...
BC_CLIENT_SECRET=...
```

For on-prem with Basic auth:

```
BC_BASE_URL=https://bc.contoso.local:7048/BC/api/v2.0
BC_COMPANY=CRONUS International Ltd.
BC_AUTH_TYPE=basic
BC_USER=...
BC_PASS=...
BC_REJECT_UNAUTHORIZED=false   # only if self-signed cert
```

## Run

**stdio (Claude Desktop, MCP Inspector, etc.):**

```bash
npm run start
```

**Streamable HTTP:**

```bash
npm run start:http
# POST/GET/DELETE on http://127.0.0.1:3000/mcp
```

**Inspect with the official inspector:**

```bash
npm run inspect
```

## Claude Desktop config

```json
{
  "mcpServers": {
    "businesscentral": {
      "command": "node",
      "args": ["/absolute/path/to/bc-mcp-server/dist/index.js"],
      "env": {
        "BC_BASE_URL": "...",
        "BC_COMPANY": "...",
        "BC_AUTH_TYPE": "oauth_client_credentials",
        "BC_TENANT_ID": "...",
        "BC_CLIENT_ID": "...",
        "BC_CLIENT_SECRET": "..."
      }
    }
  }
}
```

## Tools

| Tool | Purpose |
| --- | --- |
| `bc_list_companies` | Discover company names/IDs in this environment. |
| `bc_list_entity_sets` | List all entity sets exposed via the API. |
| `bc_get_entity_schema` | Fields, keys, navigation properties, bound actions. |
| `bc_list_entities` | Query records with full OData support. |
| `bc_get_entity` | Fetch one record by ID. |
| `bc_find_entities_by_field` | Safe equality search by single field. |
| `bc_create_entity` | Create a record. (write) |
| `bc_update_entity` | Update by ID, supports `If-Match` ETags. (write) |
| `bc_delete_entity` | Delete by ID, supports `If-Match` ETags. (write) |
| `bc_invoke_action` | Call a bound or unbound OData action. (write) |

Write tools are gated by `BC_READ_ONLY` (hard disable) and `BC_REQUIRE_WRITE_CONFIRMATION` (require `confirm: true` per call).

## Tests

```bash
npm test
```

## License

MIT.
