# Mimetic MCP

The package exposes `mim-mcp`, a small stdio-to-HTTP bridge for Mimetic's hosted
MCP server. It reads newline-delimited JSON-RPC from stdin, sends each message to
`https://trymimetic.com/api/mim/mcp`, and writes the JSON-RPC response to stdout.

It is not a local data plane. MCP tool arguments, connected-provider queries,
and returned results pass through Mimetic's hosted systems.

## Authenticate

The simplest path is the same browser device flow used by the CLI:

```bash
npm install -g @mimeticinc/mim-cli
mim setup
```

The wrapper then reads the saved token from `~/.mim/config.json`. Device-login
tokens expire after a configured lifetime (90 days by default), and
`mim auth logout` revokes the stored managed token before deleting it.

For CI or an MCP client with secret storage, provide `MIM_API_TOKEN` as an
environment variable. Do not put bearer tokens in command arguments; `mim-mcp`
does not accept a `--token` flag.

## Claude Code

The recommended path registers and verifies in one step (or use `mim setup`
for the whole onboarding):

```bash
mim mcp install claude --project yourstore.com
```

This runs `claude mcp add` at user scope so the server is available in every
project, then confirms the registration through `claude mcp get mim` and a
live call to the hosted endpoint. The local-scope default of a bare
`claude mcp add` registers only for the current directory, which is easy to
mistake for a failed install.

To see or run the underlying command yourself:

```bash
mim mcp install claude --print
claude mcp add --transport stdio --scope user mim -- \
  npx -y --package @mimeticinc/mim-cli mim-mcp \
  --project yourstore.com
```

## Claude Desktop

```bash
mim mcp install desktop --project yourstore.com
```

This merges a `mim` entry into `claude_desktop_config.json` (backing up the
existing file first and preserving other servers), then restart Claude
Desktop.

Use your MCP client's secret storage if you configure `MIM_API_TOKEN` directly.

## Codex

Add the following to your Codex MCP configuration after device login:

```toml
[mcp_servers.mim]
command = "npx"
args = ["-y", "--package", "@mimeticinc/mim-cli", "mim-mcp", "--project", "yourstore.com"]
```

The CLI prints this block with:

```bash
mim mcp install codex --project yourstore.com
```

## Generic MCP client

```json
{
  "mcpServers": {
    "mim": {
      "command": "npx",
      "args": [
        "-y",
        "--package",
        "@mimeticinc/mim-cli",
        "mim-mcp",
        "--project",
        "yourstore.com"
      ],
      "env": {
        "MIM_API_TOKEN": "${MIM_API_TOKEN}"
      }
    }
  }
}
```

Environment-variable interpolation and secret-storage syntax vary by client.
Do not commit a literal token to a repository.

## Remote Streamable HTTP

Clients that support authenticated Streamable HTTP can use the hosted endpoint
without the stdio bridge:

```text
https://trymimetic.com/api/mim/mcp
```

Send:

```text
Authorization: Bearer <Mimetic token>
```

Optional default project:

```text
x-mim-project: yourstore.com
```

For a smoke test:

```bash
curl https://trymimetic.com/api/mim/mcp \
  -H "Authorization: Bearer ${MIM_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Capabilities and approvals

The server has two broad classes of tools:

- Read/query tools for projects, findings, billing state, redacted replay
  insights, and provider-read-only GA4, Search Console, Google Ads, PostHog,
  Klaviyo, Mixpanel, and experimentation data.
- Action tools that can start audits, initiate fix workflows, connect accounts,
  or create and configure analytics and advertising resources.

“Read-only” describes a specific third-party connector scope or query endpoint,
not the entire MCP server. Inspect each tool's description and arguments, and
keep client approval enabled for action tools.

Raw replay event payloads are not returned through MCP. Redacted narratives and
derived replay insights can still contain sensitive business context and should
be handled accordingly.

## Data flow and privacy

For every stdio request:

1. `mim-mcp` reads JSON-RPC from the local MCP client.
2. It sends that message over HTTPS with the Mimetic bearer token.
3. Mimetic authorizes the account/project and may call a connected provider.
4. Provider results pass through Mimetic and return to the configured MCP/AI
   client.

Mimetic has technical access to the credentials and data required for this
flow. If the MCP client is backed by an AI provider, returned data may also be
processed under that provider account's terms, retention, and training
settings.

The wrapper emits metadata-only usage events by default. Set
`MIM_TELEMETRY=0` or `MIM_DISABLE_TELEMETRY=1` to disable them. This does not
prevent hosted tool requests and results from reaching Mimetic.

Review:

- [Privacy Policy](https://trymimetic.com/privacy#ga-integration)
- [Terms of Service](https://trymimetic.com/terms)

## Configuration

| Setting | Purpose |
|---|---|
| `MIM_API_TOKEN` | Bearer token; overrides saved credentials. |
| `MIM_API_BASE_URL` | Hosted API origin. |
| `MIM_MCP_URL` or `--url` | Full MCP endpoint. |
| `MIM_PROJECT` or `--project` | Default project/site key. |
| `MIM_CONFIG_DIR` | Credential directory. |
| `MIM_MCP_TIMEOUT_MS` or `--timeout-ms` | Positive request timeout in milliseconds. |

Remote URLs must use HTTPS. Plain HTTP is accepted only for loopback hosts.
`MIM_ALLOW_INSECURE_HTTP=1` is an explicit development escape hatch and should
never be used with production credentials.

## MCP Registry

The repository's `server.json` advertises both:

- the npm stdio package `@mimeticinc/mim-cli`; and
- the hosted Streamable HTTP endpoint.

Registry name:

```text
com.trymimetic/mimetic
```

The npm package's `mcpName` must match that value. Because this is a custom
domain namespace, registry publication requires DNS- or HTTP-based domain
authentication for `trymimetic.com`; GitHub authentication cannot publish this
namespace.

The official MCP Registry is currently in preview. Before publishing metadata:

```bash
npm run typecheck
npm test
npm run build
npm pack --dry-run
npm publish --provenance --access public
mcp-publisher publish
```

Authenticate `mcp-publisher` using the official domain-authentication flow, and
keep its signing key outside the repository. The npm package must be public
before the registry entry that references that version is published.
