# mim — the Mimetic CLI

Mimetic in your terminal: pull site audits, prioritized findings, code-fix PRs,
and session-replay insights into shell workflows and coding agents such as
Claude Code and Codex.

```bash
# Browser-based device login
npx -y --package @mimeticinc/mim-cli mim auth login

# Pull a growth-context pack for a project
npx -y --package @mimeticinc/mim-cli mim context --project yourstore.com
```

Requires Node.js 20 or newer.

## Install

Run on demand:

```bash
npx -y --package @mimeticinc/mim-cli mim <command>
```

Or install globally:

```bash
npm install -g @mimeticinc/mim-cli
mim auth login
```

## Authentication and local credentials

`mim auth login` opens a browser-based device flow. The server-issued token
expires after a configured lifetime (90 days by default).

By default, the CLI stores that bearer token as plaintext JSON in
`~/.mim/config.json`. On supported POSIX systems it enforces mode `0700` on the
directory and `0600` on the file whenever credentials are saved. The token is
not encrypted locally and is not stored in the operating-system keychain.

```bash
mim auth status
mim auth logout
```

`mim auth logout` revokes the stored managed token on Mimetic's server before
removing the local file. If revocation cannot be confirmed, the CLI keeps the
local credentials and reports the error. `mim auth logout --local-only` removes
only the local copy; the token remains usable until it expires or is revoked
another way.

For CI or a secret manager, set `MIM_API_TOKEN` instead. Environment tokens
override locally stored credentials and are never changed by `mim auth logout`.
Tokens are intentionally not accepted as command-line arguments, where they
could be exposed through shell history or process listings.

## Commands

| Command | What it does |
|---|---|
| `mim auth login` | Authenticate with the browser device flow. |
| `mim auth status` | Show the active account, API origin, and default project. |
| `mim auth logout [--local-only]` | Revoke and remove stored credentials, or remove only the local copy. |
| `mim projects` | List projects/sites available to the authenticated account. |
| `mim context` | Print a growth-context pack for a project. |
| `mim recordings` | List recent session-replay summaries. |
| `mim replay [session_id]` | Print one persisted replay insight; defaults to the latest. |
| `mim findings` | List prioritized audit findings. |
| `mim query-ga4 --metrics sessions` | Run a provider-read-only GA4 report. |
| `mim query-gsc` | Run a provider-read-only Search Console query. |
| `mim setup-analytics [--wait]` | Start hosted GA4 and Search Console setup. |
| `mim setup-analytics --status` | Check hosted setup progress. |
| `mim setup-analytics --channel agent` | Provision server-side and return a snippet for an agent to apply. |
| `mim ads setup` | Create hosted Google Ads resources and invite the site owner as Administrator. |
| `mim ads status` | Show the linked Ads account and setup state. |
| `mim ads query [--gaql <q>]` | Run a provider-read-only GAQL report. |
| `mim posthog connect` / `query` | Authorize PostHog and run provider-read-only HogQL. |
| `mim klaviyo connect` / `query` | Authorize Klaviyo and run provider-read-only reports and checks. |
| `mim audit start <url> [--wait]` | Start an audit, optionally polling to completion. |
| `mim audit rerun <url>` | Force a fresh audit. |
| `mim audit status <id>` / `wait <id>` | Check or poll an audit. |
| `mim fixes list` | List fixable findings and PR/review state. |
| `mim fixes start <rank>` | Queue a code-fix workflow. |
| `mim fixes open <rank>` | Open the PR, preview, diff, review, or workflow. |
| `mim billing status` / `checkout` / `portal` | Manage project billing. |
| `mim mcp install claude` / `codex` | Print MCP client setup. |

Run `mim --help` for all options.

## MCP

The `mim-mcp` binary proxies MCP stdio messages to Mimetic's hosted
Streamable HTTP endpoint:

```bash
mim mcp install claude
mim mcp install codex
```

The MCP surface includes read tools for findings, redacted replay insights, and
provider-read-only analytics queries. It also includes explicitly described
action tools that can start audits, create or configure analytics/advertising
resources, or initiate reviewable fix workflows. Review tool descriptions and
your client's approval prompt before authorizing an action.

See [docs/MCP.md](docs/MCP.md) for client configuration, the data flow, remote
HTTP setup, and registry publication notes.

## Connected-data access

The CLI and MCP wrapper are clients for Mimetic's hosted API; they do not query
Google, PostHog, or Klaviyo directly from your computer. Credentials, tool
arguments, and requested provider results pass through Mimetic's systems.
Mimetic therefore has technical access to connected credentials and data while
providing the request. A connector's “read-only” label describes its permissions
at the third-party provider; it does not mean the data is invisible to Mimetic.

PostHog queries can return distinct identifiers and event or user properties
available to the connected project. The current Klaviyo connector does not
request profile or write scopes. If you invoke tools through an AI client, the
returned data is also provided to the AI client and account you configured.

See the [Privacy Policy](https://trymimetic.com/privacy#ga-integration) and
[Terms of Service](https://trymimetic.com/terms) before connecting production
data.

## Transport security

Bearer tokens are sent only to HTTPS URLs by default. Plain HTTP is allowed for
loopback hosts such as `localhost`, `127.0.0.1`, and `::1`. For an unusual local
development environment, `MIM_ALLOW_INSECURE_HTTP=1` explicitly disables this
protection; do not use it with production credentials.

## Environment

| Variable | Purpose |
|---|---|
| `MIM_API_TOKEN` | Bearer token; overrides saved credentials. |
| `MIM_API_BASE_URL` | API origin; defaults to `https://trymimetic.com`. |
| `MIM_MCP_URL` | Full MCP URL; defaults to `<API origin>/api/mim/mcp`. |
| `MIM_PROJECT` | Default project/site key. |
| `MIM_CONFIG_DIR` | Credential directory; defaults to `~/.mim`. |
| `MIM_MCP_TIMEOUT_MS` | MCP request timeout; defaults to `30000`. |
| `MIM_TELEMETRY=0` | Disable metadata-only CLI/MCP usage events. |
| `MIM_DISABLE_TELEMETRY=1` | Alternative telemetry opt-out. |
| `MIM_ALLOW_INSECURE_HTTP=1` | Allow non-loopback plaintext HTTP for development only. |

Metadata telemetry includes the client version, project, command or tool name,
status, duration, trace ID, HTTP status, and bounded diagnostics. It is designed
not to include access tokens, query text, MCP arguments, replay narratives, or
provider results. Hosted requests and results still reach Mimetic when telemetry
is disabled.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

Licensed under the [MIT License](LICENSE). Copyright © 2026 Mimetic Inc.
