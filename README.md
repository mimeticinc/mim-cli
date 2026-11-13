# mim: the Mimetic CLI

Bring your site's growth context into the terminal and the AI tools where you
already work.

Connect your AI assistant to website audits, analytics, advertising, and experiment
results to identify revenue opportunities and implement reviewable improvements.

- [MCP connection guide and use cases](https://trymimetic.com/docs/mcp)
- [Live tool catalog and input schemas](https://mcp.trymimetic.com/docs/mcp/tools.json)
- Remote MCP: `https://mcp.trymimetic.com/mcp` (Streamable HTTP with OAuth sign-in)

The public catalog contains tool definitions. MCP requests require authentication
and enforce access to your own projects and connected accounts.

## Set up (recommended)

One command, no global install:

```bash
npx -y @mimeticinc/mim-cli setup
```

Setup finds the AI apps on this machine (Claude Code, Codex, Cursor, VS Code,
Windsurf), points each one at the hosted server and signs you in through the
browser. Claude (web and desktop) and ChatGPT get the connector steps, because
their config cannot hold a remote server. No API key is written into any
app's config, other MCP servers you have are left alone, and each config file
is backed up before it is written. Re-running setup is safe: it reuses your
login and registration.

To use `mim` commands in your terminal as well, install it globally
(Node.js 20 or newer):

```bash
npm install -g @mimeticinc/mim-cli
mim setup
```

## Set up one app by hand

Every app connects to the same hosted server and signs you in with OAuth:

```
https://mcp.trymimetic.com/mcp?toolsets=diagnose,data
```

### Cursor

[Install in Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=mim&config=eyJ1cmwiOiJodHRwczovL21jcC50cnltaW1ldGljLmNvbS9tY3A/dG9vbHNldHM9ZGlhZ25vc2UsZGF0YSJ9),
or add this to `~/.cursor/mcp.json` and Cursor asks you to sign in:

```json
{"mcpServers": {"mim": {"url": "https://mcp.trymimetic.com/mcp?toolsets=diagnose,data"}}}
```

### Claude Code

```bash
claude mcp add --transport http --scope user mim "https://mcp.trymimetic.com/mcp?toolsets=diagnose,data"
```

Then run `/mcp` in Claude Code to sign in.

### Claude (web and desktop)

Settings, Connectors, Add custom connector, and paste the server URL above.
On Team and Enterprise plans an owner adds it first.

### Codex

```bash
codex mcp add mim --url "https://mcp.trymimetic.com/mcp?toolsets=diagnose,data"
```

### ChatGPT

Settings, Connectors (developer mode), add the server URL above.

### VS Code

[Install in VS Code](https://vscode.dev/redirect/mcp/install?name=mim&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A//mcp.trymimetic.com/mcp%3Ftoolsets%3Ddiagnose%2Cdata%22%7D),
or add this to `.vscode/mcp.json`:

```json
{"servers": {"mim": {"type": "http", "url": "https://mcp.trymimetic.com/mcp?toolsets=diagnose,data"}}}
```

### Other apps

Use the server URL above with OAuth if the app supports it. For CI and apps
without browser sign-in, `mim mcp headless` prints a config that sends your
key from the `MIM_API_TOKEN` environment variable
(`export MIM_API_TOKEN=$(mim auth token)`).

## Choosing which tools load

`?toolsets=diagnose,data` loads the tools most conversations need, so the rest
stay out of your assistant's context:

| Toolset | What it covers |
|---|---|
| `diagnose` | Projects, scans, findings and fixes, page speed, accessibility, session recordings |
| `data` | Read-only queries: GA4, Search Console, Google Ads, BigQuery, PostHog, Mixpanel, Amplitude, Adobe Analytics, Klaviyo, Shopify, Webflow, A/B test results |
| `setup` | Connecting tools, provisioning analytics and Google Ads, session recording |
| `account` | Billing and checkout links |

Add a toolset to the list (for example `?toolsets=diagnose,data,setup`) when
you want your assistant to connect tools or set up tracking. The URL without
`?toolsets=` loads every tool. The [live tool catalog](https://mcp.trymimetic.com/docs/mcp/tools.json)
lists each tool, its inputs and whether it reads or writes.

Mimetic connects audits, live analytics, ad performance, lifecycle marketing,
and session behavior so you can find what is holding growth back, decide what
to do next, and move into a reviewable fix workflow without hopping between
dashboards. Use `mim` directly from the shell or give the same context and
actions to Claude Code, Codex, and other MCP clients.

Mimetic is the hosted service behind the CLI. Learn more at
[trymimetic.com](https://trymimetic.com).

## What you can accomplish

- **Find the highest-impact problems.** Pull site audits, prioritized findings,
  and redacted session-replay insights into one project context.
- **Answer growth questions with live data.** Query acquisition, conversion,
  revenue, search, advertising, product analytics, and lifecycle performance
  without exporting CSV files.
- **Repair measurement and acquisition setup.** Provision hosted GA4 and Search
  Console, install tracking through a PR, Shopify pixel, or agent-applied
  snippet, and create or connect Google Ads resources.
- **Turn findings into reviewable work.** Start a code-fix workflow, then open
  the proposed PR, diff, preview, or Mimetic review page.
- **Give coding agents business context.** Let an MCP client inspect the same
  findings and connected data before it recommends or starts an action.

## Integrations

| Integration | What it unlocks |
|---|---|
| **Google Analytics 4** | Query sessions, users, channels, landing pages, engagement, conversions, and revenue. Set up a hosted property and tag when measurement is missing. |
| **Google Search Console** | Analyze queries, pages, countries, devices, clicks, impressions, CTR, and position. Hosted setup can also handle verification and sitemap submission. |
| **Google Ads** | Inspect campaigns, spend, clicks, conversions, search terms, and other GAQL data. Create or link an account, connect it to GA4, and enable auto-tagging. |
| **PostHog** | Run read-only HogQL against events and properties to investigate product usage, funnels, and behavior. |
| **Klaviyo** | Review campaign and flow performance, lists, segments, and metrics. Check whether abandoned cart is live and find dead links in campaign templates. |
| **GitHub** | Receive analytics installation and code fixes as reviewable pull requests, diffs, and previews. |
| **Shopify** | Install hosted analytics through the Mimetic app pixel when that delivery path is available for the project. |
| **Claude Code, Codex, and MCP clients** | Bring project context, connected-data queries, audits, and explicitly described action tools into an AI-assisted workflow. |

## Questions you can answer

Once the relevant accounts are connected, you can use the CLI or ask an MCP
client questions such as:

- Which landing pages lost organic clicks but still convert well in GA4?
- Where is ad spend rising without a matching increase in conversions?
- What are users struggling with in recent high-priority sessions?
- Is the abandoned-cart flow live, and which campaign templates contain dead
  links?
- What is the highest-priority fix that is ready to start, and where can I
  review the proposed change?

## From context to action

```bash
# Build a project brief from audits, findings, and connected signals
mim context --project yourstore.com

# Investigate acquisition and conversion performance
mim query-ga4 --project yourstore.com \
  --metrics sessions,conversions,totalRevenue \
  --dimensions sessionDefaultChannelGroup
mim query-gsc --project yourstore.com --dimensions query,page
mim query-bq --project yourstore.com --describe
mim query-bq --project yourstore.com --sql \
  "SELECT event_name, COUNT(*) AS n FROM \`events_*\` WHERE _TABLE_SUFFIX >= '20260901' GROUP BY 1 ORDER BY n DESC"
mim ads query --project yourstore.com

# Check lifecycle marketing and recent customer friction
mim klaviyo query --project yourstore.com --resource abandoned_cart_status
mim recordings --project yourstore.com

# Move a prioritized finding into a reviewable fix workflow
mim fixes list --project yourstore.com
mim fixes start 1 --project yourstore.com
```

## Running commands

With a global install, run `mim <command>`. Without one, every command also
works through npx:

```bash
npx -y @mimeticinc/mim-cli <command>
```

## Authentication and local credentials

`mim auth login` opens a browser-based device flow. The server-issued token
expires after a configured lifetime (90 days by default).

Logging in is idempotent: if this machine already has a working token, `mim
auth login` verifies it against the server and reuses it instead of minting a
new one. Use `mim auth login --force` to sign in as a different account.

After every login the CLI makes a real API call to confirm the token works and
to list your projects. Projects belong to the email your Mimetic audit or
report was sent to. If you sign in with a different email (personal instead of
work, for example), the project list will be empty and the CLI tells you which
email to use instead. `mim auth status` runs the same server-side verification
and shows exactly which account and projects this machine is using.

### Headless servers and SSH

The browser does not need to run on the same machine as the CLI. On a server
without a desktop environment, start the device flow without attempting to
launch a local browser:

```bash
mim auth login --no-open
```

Keep that process running, open the printed verification URL on your laptop or
phone, and approve the login there. The server will finish the login by polling
Mimetic and will store its own token in `~/.mim/config.json`.

For unattended deployments, provide `MIM_API_TOKEN` through the server's secret
manager or environment instead of relying on an interactive login. Do not put
the token directly in a command argument.

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
| `mim setup` | One-command onboarding: install check, sign-in, project detection, hosted MCP registration for every app found, and verification of each step. `--local` writes the deprecated relay instead. |
| `mim mcp headless` | Config for CI and clients without browser sign-in: the hosted URL with the key from `MIM_API_TOKEN`. |
| `mim auth token` | Print the saved API key, for `export MIM_API_TOKEN=$(mim auth token)`. |
| `mim auth login [--no-open] [--force]` | Authenticate with the device flow; reuses a working token unless forced. |
| `mim auth status` | Show and server-verify the active account, projects, and default project. |
| `mim auth logout [--local-only]` | Revoke and remove stored credentials, or remove only the local copy. |
| `mim projects` | List projects/sites available to the authenticated account. |
| `mim projects use <key>` | Save a default project so commands stop needing `--project`. |
| `mim properties` | List the GA4 properties the project's Google connection can see, with 28-day sessions and the current selection. |
| `mim properties use <id>` | Point the project at a specific GA4 property (validated against what the connection can see). |
| `mim context` | Print a growth-context pack for a project. |
| `mim recordings` | List recent session-replay summaries. |
| `mim replay [session_id]` | Print one persisted replay insight; defaults to the latest. |
| `mim findings` | List prioritized audit findings. |
| `mim query-ga4 --metrics sessions` | Run a provider-read-only GA4 report. |
| `mim query-gsc` | Run a provider-read-only Search Console query. |
| `mim query-bq --sql <q>` | Run a read-only SELECT over the project's own GA4 BigQuery export (`--describe` for the dataset and table dates). |
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
| `mim mcp install claude` | Register the mim MCP server with Claude Code (user scope) and verify it; falls back to Claude Desktop. |
| `mim mcp install codex` / `cursor` / `windsurf` / `desktop` | Write that agent's config file, backing up what was there. Add `--print` to output the block instead. |
| `mim mcp install all` | Register with every agent found on this machine. |

Run `mim --help` for all options.

## MCP

`mim setup` registers the hosted server with every app it finds. To register
only the MCP piece, or one app at a time:

```bash
mim mcp install all       # every agent found on this machine
mim mcp install claude    # registers with Claude Code at user scope, then verifies
mim mcp install codex     # writes ~/.codex/config.toml
mim mcp install cursor    # writes ~/.cursor/mcp.json
mim mcp install windsurf  # writes ~/.codeium/windsurf/mcp_config.json
mim mcp install desktop   # writes Claude Desktop's config file
```

Every file write is backed up first and read back after, and other MCP servers
already in the file are preserved. Codex config is TOML, so the entry is
appended rather than the file being reparsed and rewritten. Running any of
these twice does not create a duplicate entry. Add `--print` to any of them to
see the block without writing anything.

`mim mcp install claude` registers at user scope on purpose: the Claude Code
default (local scope) only applies to the directory the command ran in, which
is the most common reason a "successful" install never shows up in a session.
After registering, the CLI reads the entry back through `claude mcp get mim`
and makes a live call to the hosted endpoint, so success means the server is
reachable, not just that a command exited 0.

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
| `MIM_MCP_TIMEOUT_MS` | MCP request timeout; defaults to `120000` (PageSpeed and accessibility checks can take 20 to 50 seconds). |
| `MIM_TELEMETRY=0` | Disable metadata-only CLI/MCP usage events. |
| `MIM_DISABLE_TELEMETRY=1` | Alternative telemetry opt-out. |
| `DO_NOT_TRACK=1` | Also turns telemetry off (the cross-tool convention). |
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

## Telemetry: what is sent

The CLI sends one small event per command to `trymimetic.com`, on by default,
the same way the Stripe CLI does. Turn it off with `MIM_TELEMETRY=0` or
`DO_NOT_TRACK=1`.

| Sent | Never sent |
|---|---|
| command name and the names of the options you used | option values, URLs, file paths |
| project key, success or failure, duration | page content, analytics data, query text |
| error type and a bounded outcome (`auth`, `not_found`, `rate_limited`, `server_error`, `timeout`...) | error messages |
| CLI version, OS, CPU architecture | your API key (it is the request's credential, not part of the event) |
| which AI agent ran it (Claude Code, Codex, Cursor...) and the terminal app, from the environment variables those tools set | anything from your shell history or files |

The hosted MCP server records each tool call on our side (tool name, which
app called it, duration, outcome, argument names) and never argument values
or results.

## Local relay (deprecated)

The local `mim-mcp` stdio relay still works and `mim setup --local` still
writes it, but it no longer receives updates. Move to the hosted server above.
