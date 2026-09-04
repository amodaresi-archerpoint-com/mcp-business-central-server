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

This repository holds two implementations; the TypeScript one lives in `typescript/`.

```bash
git clone https://github.com/amodaresi-archerpoint-com/mcp-business-central-server.git
cd mcp-business-central-server/typescript
npm ci
npm run build
```

Requires **Node 20+**. `npm run build` is required before the server can be started — the
entry point is `dist/index.js`.

## Prerequisites: Microsoft Entra app registration (SaaS)

Business Central online only accepts OAuth; Basic auth (web service access keys) was
[removed for BC online after October 1, 2022](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/upgrade/deprecated-features-platform#accesskeys).
This server uses the service-to-service (S2S) client-credentials flow, which needs a one-time
setup by someone with tenant admin rights. Full reference:
[Using service-to-service (S2S) authentication](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/administration/automation-apis-using-s2s-authentication).

**1. In the [Microsoft Entra admin center](https://entra.microsoft.com):**

1. **App registrations** → **New registration**. Name it something identifiable
   (e.g. `BC MCP — <customer>`), supported account types **Single tenant**. No redirect URI needed.
2. From **Overview**, copy the **Application (client) ID** and **Directory (tenant) ID**.
3. **Certificates & secrets** → **New client secret**. Copy the value **immediately** — it is
   never displayed again.
4. **API permissions** → **Add a permission** → **Microsoft APIs** → **Dynamics 365 Business
   Central** → **Application permissions** → tick **`API.ReadWrite.All`** ("Access to APIs and
   webservices"), then **Add permissions**.
   - `API.ReadWrite.All` is the correct scope for APIs *and* OData web services. Delegated
     `Financials.ReadWrite.All` is for a different (interactive) flow and won't work here.
   - Add `Automation.ReadWrite.All` only if you also need the automation APIs.
5. **Grant admin consent for \<tenant\>**.

**2. In Business Central** (each environment you want to reach):

1. Search for **Microsoft Entra Applications** and open it → **New**.
2. **Client ID** = the Application (client) ID from step 2 above. Fill in **Description** with
   identifying info.
3. Set **State** to **Enabled**.
4. Assign permission sets. Applications **cannot** be granted `SUPER`, so follow least privilege
   and assign only what the integration reads. `D365 AUTOMATION` and `EXTEN. MGT. - ADMIN` cover
   most typical objects; for read-only querying, a read permission set over the relevant tables is
   enough.

The app can now authenticate, but it can only *see* objects that are exposed — see
[Endpoint styles](#endpoint-styles).

## Handling the client secret

**Never commit the secret, and never put it in a shared config file.** Three options, in order of
preference:

**1. A user environment variable** (best for a shared, committed MCP config). Set it once:

```powershell
# Windows — persists for future processes; restart the terminal afterwards
setx BC_CLIENT_SECRET "<the secret value>"
```

```bash
# macOS/Linux — add to ~/.zshrc or ~/.bashrc
export BC_CLIENT_SECRET="<the secret value>"
```

Then reference it rather than inlining it, which is what makes a committed `.mcp.json` safe:

```json
"env": { "BC_CLIENT_SECRET": "${BC_CLIENT_SECRET}" }
```

**2. A local `.env` file** (best for running the dev scripts). `.env` and `.env.*` are gitignored
except the `*.example` files, so this stays off the repo. Note the server itself has no `dotenv`
dependency — only the scripts in `scripts/` read `.env`; when launched by an MCP client the values
come from that client's `env` block.

**3. Azure Key Vault / your secret manager**, fetched at shell start. Preferable for anything
shared or long-lived; the server reads plain env vars, so any mechanism that populates them works.

If a secret leaks, rotate it in **Certificates & secrets** — the old value stops working
immediately and nothing in BC needs changing.

## Configure

Copy `.env.detailed.example` (fully commented) or `.env.onprem.example` to `.env` and fill it in.
The minimum for SaaS with OAuth:

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

## Endpoint styles

`BC_ENDPOINT_STYLE` selects which Business Central endpoint family `BC_BASE_URL` points at. It is
**auto-detected** from the URL (any `/ODataV4` or `/OData` segment ⇒ `odata`), so you normally
don't set it.

| | `api` | `odata` |
| --- | --- | --- |
| Base URL ends in | `/api/v2.0` (or a custom `/api/{pub}/{group}/{ver}`) | `/ODataV4` |
| Reaches | API pages and API queries **only** | **anything published on the Web Services page** |
| Custom / ISV tables | need an API page written per table | reachable with **no AL code** |
| Entity set name | the API page name (`salesOrders`) | the **Service Name** from Web Services |
| Record key | `systemId` GUID | the page's `ODataKeyFields`, often a quoted string |
| Field names | `camelCase` | `Underscored_Names` |
| Company segment | `companies({guid})` | `Company(Id={guid})` or `Company('Name')` |
| Bound action prefix | `Microsoft.NAV.` | `NAV.` |

**To expose a table via `odata`:** in Business Central open **Web Services** → **New** → Object
Type `Page` (or `Query`) → pick the object → set a **Service Name** → tick **Published**. Use
singular PascalCase without spaces (`CSMAutomation`). That Service Name is what you pass as
`entitySet`.

On the `odata` style, prefer the **company GUID** for `BC_COMPANY`: names are case-sensitive there,
can be renamed by an admin, and cannot be resolved server-side. `bc_list_companies` reports the
GUID under `Id`. A pre-encoded name (`AP%20V28%20Test`, e.g. copied from a browser) is handled
without double-encoding.

Both styles are served concurrently by every environment. To use both at once, register the server
**twice** in your MCP client with different `BC_BASE_URL` values — the tools are namespaced per
server, which keeps the two entity-set namespaces from colliding.

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
      "args": ["/absolute/path/to/mcp-business-central-server/typescript/dist/index.js"],
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

## Claude Code config (shared, committed)

Claude Code reads a project-scoped `.mcp.json` from the repository root, and that file **is
committed and shared with the team** — so expand secrets from the environment rather than inlining
them. It supports `${VAR}` and `${VAR:-default}` in `command`, `args`, `env`, `url` and `headers`.

```json
{
  "mcpServers": {
    "bc-odata": {
      "type": "stdio",
      "command": "node",
      "args": ["${BC_MCP_SERVER_DIR:-C:/Src/PY/mcp-business-central-server/typescript}/dist/index.js"],
      "env": {
        "BC_BASE_URL": "${BC_BASE_URL:-https://api.businesscentral.dynamics.com/v2.0/{tenant}/{environment}/ODataV4}",
        "BC_COMPANY": "${BC_COMPANY:-<company-guid>}",
        "BC_AUTH_TYPE": "oauth_client_credentials",
        "BC_TENANT_ID": "${BC_TENANT_ID:-<tenant-guid>}",
        "BC_CLIENT_ID": "${BC_CLIENT_ID:-<client-id>}",
        "BC_CLIENT_SECRET": "${BC_CLIENT_SECRET}",
        "BC_READ_ONLY": "${BC_READ_ONLY:-true}",
        "BC_REQUIRE_WRITE_CONFIRMATION": "true"
      }
    }
  }
}
```

Notes for whoever picks this up:

- **Only `BC_CLIENT_SECRET` has no default** — set it as described in
  [Handling the client secret](#handling-the-client-secret). Without it Claude Code warns about a
  missing variable and the server fails to start.
- `BC_READ_ONLY` defaults to `true`. A committed file shouldn't hand a whole team write access to
  a live BC environment; opt in per machine by setting `BC_READ_ONLY=false`.
- `BC_MCP_SERVER_DIR` lets each person point at their own clone without editing the tracked file.
- Project-scoped servers require explicit approval on first use, and won't appear until Claude Code
  restarts. Check with `/mcp`.
- The path runs `dist/index.js`, so each person must run `npm ci && npm run build` in their clone.

## Dev scripts

Tracked helpers in `scripts/`, which read `.env` directly (the server does not):

```bash
npm run smoke                 # auth -> $metadata -> companies; exits non-zero on failure
npm run smoke -- ItemList     # also fetch that set's schema and 2 rows
npm run query -- --tools      # list available tool names
npm run query -- bc_list_entities '{"entitySet":"ItemList","top":5}'
```

`npm run smoke` is the fastest way to confirm a new Entra registration actually works end to end.
It prints `BC_BASE_URL` and `BC_COMPANY` in full and redacts anything matching `SECRET|PASS|KEY`.

## Tools

| Tool | Purpose |
| --- | --- |
| `bc_list_companies` | Discover company names/IDs in this environment. Records are returned unprojected on the `odata` style, whose field names differ (`Name`, `Id`, `Display_Name`). |
| `bc_list_entity_sets` | List all entity sets: API pages on the `api` style, published Web Services on `odata`. |
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
