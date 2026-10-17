# Precept MCP Server

[![npm version](https://img.shields.io/npm/v/@preceptai/mcp-server.svg)](https://www.npmjs.com/package/@preceptai/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](https://opensource.org/licenses/MIT)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Standard-blue.svg)](https://modelcontextprotocol.io)

Expose [Precept's](https://preceptai.co.uk) enterprise B2B lead discovery, company intelligence, signal monitoring, and automated LinkedIn outreach directly inside AI assistants like **Claude (Web & Desktop)**, **ChatGPT**, **Cursor**, and **Codex**.

This server implements the open [Model Context Protocol (MCP)](https://modelcontextprotocol.io) specification. It enables LLMs to search millions of verified decision makers, enrich contact details via a 140+ provider waterfall, monitor hiring and career moves, and orchestrate automated outreach campaigns without leaving the conversation.

---

## Architecture & Transports

Precept MCP Server supports dual-transport bootstrapping:

- **Streamable HTTP (Remote OAuth 2.1)**: Hosted endpoint for cloud AI platforms (**Claude.ai**, **ChatGPT**), enterprise agents, and browser clients. Uses standard OAuth 2.1 with PKCE.
- **`stdio` (Local CLI)**: Standard input/output transport for local developer tools (**Claude Desktop**, **Cursor**, **Codex**, CLI agents) powered by `npx -y @preceptai/mcp-server`.

All heavy data operations are **non-blocking and asynchronous**: jobs immediately return an `enrichment_id` (`jobId`), and the assistant polls progress via `precept_get_job_status` until complete. This prevents LLM client timeouts on deep web research and waterfall data lookups.

---

## Available Tools

Precept MCP Server exposes **13 specialized tools** organized across lead discovery, account intelligence, signal subscriptions, outreach automation, and system utilities:

### 1. Lead & Contact Discovery

| Tool | Description |
| :--- | :--- |
| `precept_search_leads` | Search and discover business leads using natural language queries (e.g. *"Marketing heads at SaaS companies in California with 50-200 employees"*). Supports optional waterfall contact enrichment (verified emails and direct dials) and AI-generated prospect profiles. |
| `precept_get_leads_from_post_search` | Discover high-intent prospects actively engaging (posting, commenting, reacting) with specific topics on LinkedIn over the past 24 hours, week, or month. |
| `precept_enrich_leads` | Enrich a specific list of contacts using LinkedIn URLs or name + company details. Delivers verified emails, phone numbers, professional summary, top problems, and strategic initiatives. |

### 2. Company & Account Intelligence

| Tool | Description |
| :--- | :--- |
| `precept_search_companies` | Discover accounts matching specific criteria (industry, headcount, geography, revenue, recent funding, tech stack). Optionally extracts key department heads and employee breakdowns. |
| `precept_get_company_insights` | Retrieve deep structured intelligence on target accounts: decision makers across 40 canonical departments, installed technologies, funding history, revenue, employee growth trends, and department ratios. |

### 3. Hiring & Market Signal Subscriptions

| Tool | Description |
| :--- | :--- |
| `precept_job_posting_subscriptions` | Monitor real-time hiring triggers on a 7–30 day schedule. Supports natural language queries (*"active AI or ML jobs in healthcare"*) or monitoring up to 100 target accounts. Automatically extracts relevant decision makers for each open role with zero duplicate billing. |
| `precept_lead_subscriptions` | Track up to 150 target decision makers per organization for career moves: job changes, internal promotions, title updates, and new LinkedIn posts. |

### 4. Automated LinkedIn Outreach (Chrome Extension)

| Tool | Description |
| :--- | :--- |
| `precept_get_extension_status` | Checks if the user's [Precept Chrome Extension](https://chromewebstore.google.com/detail/precept/mlhpcomoechogpgbmjgpfenbmpflcfig) is installed and active. Required before launching outreach or dispatching messages. |
| `precept_campaign_queue` | Queue discovered leads directly into automated LinkedIn outreach campaigns. Supports FIFO queue discipline, progress tracking, rate-limit safety pauses, resuming, pausing, and archiving campaigns. Runs safely in Chrome background without needing Precept or LinkedIn tabs open. |
| `precept_linkedin_messages` | Dispatches 1-on-1 direct messages or connection request notes via LinkedIn with automated delivery status verification and error diagnostics. |

### 5. Utility & System

| Tool | Description |
| :--- | :--- |
| `precept_get_job_status` | Polls progress and retrieves complete structured results for any async search or enrichment job. Returns progress percentages while processing and full datasets upon completion. |
| `precept_check_credits` | Checks remaining account credit balance and connector version status before initiating operations. |
| `precept_check_version` | Validates running connector version against the latest release to check if updates are available. |

---

## How It Works (Async Non-Blocking Pattern)

```
User: "Find 20 VP of Sales at fintech companies in New York"
  │
  ▼
LLM calls `precept_check_credits` → verifies sufficient balance
  │
  ▼
LLM calls `precept_search_leads` → returns { enrichment_id: "job_94827" }
  │
  ▼
LLM polls `precept_get_job_status("job_94827")` every 4s (up to 150 attempts / 10m)
  │ Updates user with progress every ~1 minute
  ▼
Job completes → LLM presents full structured table/artifact with contacts
  │
  ▼
Follow-up: LLM offers to enrich phone numbers or queue LinkedIn outreach
```

---

## Client Setup

### Step 1: Create Account & Get API Key

1. Sign up or log in at [app.preceptai.co.uk](https://app.preceptai.co.uk/auth).
2. Go to the [Precept Developer Dashboard](https://app.preceptai.co.uk/developer).
3. Click **Generate New API Key** and copy your key (`pt_...`).

---

### Option A: Remote Setup (Claude.ai Web, Claude Desktop App, & ChatGPT)

Both **Claude (Web & Desktop apps)** and **ChatGPT** connect to Precept via remote **Streamable HTTP** using OAuth 2.1. Once added in your Claude account, connectors automatically sync across web, desktop, and mobile:

#### 1. Claude (Web & Desktop App)
1. In Claude.ai or the Claude Desktop app, open **Settings** (or **Customize**) → **Connectors**.
2. Click **Add Custom Connector** (or **+**).
3. Fill in the connector details:
   - **Name:** `Precept AI`
   - **Remote MCP Server URL:** `https://precept-mcp-server-production.up.railway.app/mcp`
   - **Client ID:** `claude`
4. Click **Save** then click **Connect**.
5. When the authorization window appears, paste your **Precept API Key** to authorize the connector.

#### 2. ChatGPT (Web & Desktop)
1. In ChatGPT, open **Settings** → **Connected apps** / **Developer Mode**.
2. Add a new remote MCP connector:
   - **URL:** `https://precept-mcp-server-production.up.railway.app/mcp`
3. Click **Connect**. When the authorization window appears, paste your **Precept API Key** to authorize the connector.

---

### Option B: Local CLI & IDE Setup (Claude Code, Cursor, Codex)

Developer CLI agents and IDEs execute the server locally over `stdio` via `npx` using your API key:

#### 1. Claude Code (Anthropic CLI)
Run the following in your terminal:
```bash
claude mcp add --env PRECEPT_API_KEY=pt_your_api_key_here precept -- npx -y @preceptai/mcp-server
```
*(Supports `--scope user` to make Precept available globally across all projects, or `--scope project` to save into `.mcp.json`)*.

Prefer the hosted connector instead? Claude Code also supports remote servers:
```bash
claude mcp add --transport http precept https://precept-mcp-server-production.up.railway.app/mcp
```
Then run `/mcp` inside Claude Code to complete authorization.

#### 2. Cursor
1. Go to **Settings** → **Features** → **MCP**.
2. Click **+ Add New MCP Server**.
3. Configure:
   - **Name:** `Precept`
   - **Type:** `command`
   - **Command:** `npx -y @preceptai/mcp-server`
4. Set `PRECEPT_API_KEY=pt_your_api_key_here` in your environment or workspace `.env`.

#### 3. Claude Desktop (Alternative: Local `stdio` mode)
If you prefer running the server locally in Claude Desktop instead of using the remote OAuth connector, add this to `claude_desktop_config.json`:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "precept": {
      "command": "npx",
      "args": ["-y", "@preceptai/mcp-server"],
      "env": {
        "PRECEPT_API_KEY": "pt_your_api_key_here"
      }
    }
  }
}
```

#### 4. Codex CLI
Run:
```bash
codex mcp add precept --env PRECEPT_API_KEY=pt_your_api_key_here -- npx -y @preceptai/mcp-server
```

---

## Hosting Your Own Remote Instance

To host your own remote Streamable HTTP server:

```bash
git clone https://github.com/johnbabat/precept-mcp-server.git
cd precept-mcp-server
npm install
npm run build
```

Configure environment variables in `.env`:

```env
PORT=3000
MCP_TRANSPORT=http
ALLOWED_HOSTS=your-domain.com
JWT_SECRET=your-random-32-character-secret
PRECEPT_API_URL=https://api.preceptai.co.uk
```

Start the server:
```bash
npm start
```
The endpoint will be available at `http://your-domain.com:3000/mcp` with full OAuth 2.1 endpoints at `/authorize` and `/token`.

---

## Environment Variables

| Variable | Transport | Default | Description |
| :--- | :--- | :--- | :--- |
| `PRECEPT_API_KEY` | `stdio` | *(required for stdio)* | Your Precept API key (`pt_...`). |
| `MCP_TRANSPORT` | Both | `stdio` | Transport type: `stdio` (local CLI) or `http` (remote streamable HTTP). |
| `PORT` | `http` | `3000` | Port for the HTTP server. |
| `ALLOWED_HOSTS` | `http` | `localhost,127.0.0.1` | Comma-separated allowed hostnames for DNS rebinding protection. |
| `JWT_SECRET` | `http` | *(auto-generated)* | Secret for signing OAuth tokens. **Set this in production** — if omitted, a random secret is generated and all connected users are logged out on every restart. |
| `ALLOWED_REDIRECT_DOMAINS` | `http` | *(see source)* | Comma-separated domains allowed as OAuth `redirect_uri` targets (e.g. Claude and ChatGPT callback domains). |
| `REDIS_URL` | `http` | *(optional)* | Redis connection string for persistent distributed auth code storage. Defaults to in-memory store. |
| `PRECEPT_API_URL` | Both | `https://api.preceptai.co.uk` | Core Precept API endpoint. |
| `WEB_APP_URL` | `http` | `https://app.preceptai.co.uk` | Precept web app that handles sign-in/sign-up during OAuth and mints the connector API key. |

---

## Credits & Pricing

Precept API uses a credit-based model for data operations:

| Operation | Cost |
| :--- | :--- |
| **Lead Search** (basic profile) | `0.1 credits` / lead |
| **Lead Search with AI Insights** | `1.1 credits` / lead |
| **Lead Enrichment** (existing contact) | `1.0 credit` / lead |
| **Verified Work Email** | `+1.0 credit` / lead |
| **Verified Direct Phone Number** | `+10.0 credits` / lead |
| **Both Email & Phone** | `+11.0 credits` / lead |
| **Company Search / Base Insights** | `1.0 credit` / company |
| **Custom AI Company Query** | `+0.2 credits` / query / company |
| **Company Decision Makers** | `0.5 credits` / person |
| **Company Tech Stack** | `2.0 credits` / company |
| **Company Revenue / Funding** | `5.0 credits` / company |
| **Job Posting Subscription Monitoring** | `0 credits` for search; `0.5 credits` / discovered decision maker |
| **Post Activity Filter** | `+5 credits` / lead |

*Full documentation on credit policies is available at [docs.preceptai.co.uk](https://docs.preceptai.co.uk/essentials/credits).*

---

## Useful Links

- **Precept Web App:** [app.preceptai.co.uk](https://app.preceptai.co.uk)
- **Developer Dashboard:** [app.preceptai.co.uk/developer](https://app.preceptai.co.uk/developer)
- **Official Documentation:** [docs.preceptai.co.uk](https://docs.preceptai.co.uk)
- **Precept MCP Hub:** [preceptai.co.uk/mcp](https://www.preceptai.co.uk/mcp)
- **Chrome Extension:** [Chrome Web Store](https://chromewebstore.google.com/detail/precept/mlhpcomoechogpgbmjgpfenbmpflcfig)
- **GitHub Repository:** [github.com/johnbabat/precept-mcp-server](https://github.com/johnbabat/precept-mcp-server)

---

## License

MIT © Precept AI
