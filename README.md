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
| BC endpoint style | `api/v2.0` (`companies({guid})/…`) | `ODataV4` (`Company('NAME')/…`) |
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

## Known difference worth noting

The two implementations reach different sets of tables:

- `typescript/` targets `api/v2.0`, so it reaches **API pages only**.
- `python/` targets `ODataV4`, so it reaches **anything published on the BC Web Services page** —
  pages, queries, codeunits — which is a broader set and needs no AL code.

If you need `typescript/` to reach a table that has no API page, either add an API page for it, or
teach `typescript/src/bc/client.ts` to emit `Company('{name}')/` instead of `companies({guid})/`
when the configured base URL is an ODataV4 root.

## Setup

Each folder is self-contained — see [`typescript/README.md`](typescript/README.md) and
[`python/README.md`](python/README.md). Both require a Microsoft Entra app registration with a
matching entry on the Business Central **Microsoft Entra Applications** page when used against SaaS.

## License

MIT — see [LICENSE](LICENSE). Forked from
[luisMDev/mcp-business-central-server](https://github.com/luisMDev/mcp-business-central-server);
the Python implementation originates from sofias tech.
