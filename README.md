# mcp-business-central-server

MCP server for Microsoft Dynamics 365 Business Central. This repository holds **two independent
implementations** in separate folders — they do not share code.

| | [`typescript/`](typescript/) | [`python/`](python/) |
| --- | --- | --- |
| Status | **Current — use this one** | Legacy (original upstream implementation) |
| Package | `bc-mcp-server` (Node 20+) | `mcp-business-central-server` (Python 3.10+) |
| Auth | OAuth 2.0 client credentials, or Basic | **Basic only** |
| Works against BC online (SaaS) | Yes | **No** — see below |
| Works against BC on-premises | Yes | Yes |
| BC endpoint style | `api/v2.0` **and** `ODataV4` (selectable) | `ODataV4` only |
| Transports | stdio + HTTP | stdio |
| Tests | vitest | none |

## Which one to use

Use **`typescript/`**. It is a functional superset: it supports both OAuth and Basic auth, adds an
HTTP transport, `$metadata` caching, request timeouts, read-only and write-confirmation guards, and
has tests.

`python/` is kept for reference only. **It cannot authenticate to Business Central online**:
Microsoft removed Web Service Access Keys (Basic auth) for BC online after October 1, 2022, and
OAuth2 is now the only option for SaaS. It remains usable against on-premises deployments.
See [Deprecated features in the platform](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/upgrade/deprecated-features-platform#accesskeys).

## Reaching tables that have no API page

`api/v2.0` only exposes API pages and API queries, so ISV and customer-specific tables are
invisible to it unless someone writes an API page for each one. The `ODataV4` endpoint has no such
limit: **anything published on Business Central's *Web Services* page** — pages and queries (plus
codeunits as unbound actions) — is reachable, with no AL code at all.

`typescript/` supports both. Point `BC_BASE_URL` at an `/ODataV4` root and the endpoint style is
detected automatically (override with `BC_ENDPOINT_STYLE=api|odata`):

```
https://api.businesscentral.dynamics.com/v2.0/{tenant}/{environment}/ODataV4
https://bc.contoso.local:7048/BC/ODataV4
```

To expose a table this way, in Business Central open **Web Services**, add a row with Object Type
`Page` (or `Query`), pick the object, set a **Service Name**, and tick **Published**. That Service
Name — not the object name — is what you pass as `entitySet`. Microsoft's guidance is to use
singular PascalCase with no spaces, e.g. `CSMAutomation`.

Three differences to expect on the OData style:

- **Company** is `Company(Id={guid})` or `Company('{Name}')`. The name is case-sensitive and cannot
  be resolved server-side there, so prefer the GUID; `bc_list_companies` may be unavailable and
  returns actionable guidance if so.
- **Keys** are the page's `ODataKeyFields`, not systemId GUIDs — usually a quoted string, e.g.
  `bc_get_entity` with `id: "'PRODUCTLISTING'"`, and composite keys are comma-separated.
- **Field names** come from the page and have spaces replaced by underscores (`Codeunit_ID_Code`),
  rather than the camelCase of API pages.

## Setup

Each folder is self-contained — see [`typescript/README.md`](typescript/README.md) and
[`python/README.md`](python/README.md). Both require a Microsoft Entra app registration with a
matching entry on the Business Central **Microsoft Entra Applications** page when used against SaaS.

## License

MIT — see [LICENSE](LICENSE). Forked from
[luisMDev/mcp-business-central-server](https://github.com/luisMDev/mcp-business-central-server);
the Python implementation originates from sofias tech.
