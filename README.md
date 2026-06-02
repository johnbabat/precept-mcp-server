# Precept MCP Server

> Expose [Precept's](https://preceptai.co.uk) B2B contact and company intelligence tools directly to AI assistants like **Claude Desktop**, **Cursor**, and **ChatGPT**.

This server implements the [Model Context Protocol (MCP)](https://modelcontextprotocol.io) and wraps Precept's core API. All operations are **non-blocking** — jobs return immediately with an `enrichment_id`, and results are polled via a separate status tool. This avoids LLM client timeouts on long running jobs.

Supports dual-transport bootstrapping:

- **`stdio`** — for local integrations (Claude Desktop, Cursor)
- **Streamable HTTP** — for remote hosting (ChatGPT, enterprise agents)

---

## Tools

| Tool                           | Description                                                                                                                                                                                          |
| :----------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `precept_search_leads`         | Search for leads using natural language (e.g. _"Marketing heads at SaaS companies in California"_). Optionally enrich with verified emails, phone numbers, and AI insights. Returns a `jobId`.       |
| `precept_enrich_leads`         | Enrich a specific list of contacts using LinkedIn URLs or name + company details. Returns verified emails, phones, professional summary, top problems, and strategic initiatives. Returns a `jobId`. |
| `precept_get_company_insights` | Retrieve structured insights for specific companies — decision makers, technology stack, revenue, funding, employee counts, department ratios, and custom queries. Returns a `jobId`.                |
| `precept_search_companies`     | Discover companies using natural language queries and optionally enrich with insights. Returns a `jobId`.                                                                                            |
| `precept_get_job_status`       | Poll the status and retrieve results of any job. Returns `processing` (with progress) or `completed` (with full data).                                                                               |
| `precept_check_credits`       | Check the remaining credit balance for your Precept account.                                                                                                                                         |

### How It Works (Async Job Pattern)

```
User → "Find CTOs at fintech startups in London"
  ↓
LLM calls precept_search_leads → returns { enrichment_id: "job_123" }
  ↓
LLM waits ~30 seconds, then calls precept_get_job_status("job_123")
  ↓
If still processing → LLM waits and retries
If completed → LLM receives full results with contact details
```

---

## Client Setup

The Precept MCP server is designed to run directly inside your LLM client.

### Prerequisites

- **Node.js** v20+
- **Precept API Key** — generate one from the [Precept Developer Dashboard](https://app.preceptai.co.uk/developer)

### 1. Claude Desktop

Add this config to your Claude Desktop configuration file (typically at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "precept": {
      "command": "npx",
      "args": ["-y", "@preceptai/mcp-server"],
      "env": {
        "PRECEPT_API_KEY": "your_precept_api_key_here"
      }
    }
  }
}
```

_(Make sure to completely restart/quit Claude Desktop after editing this file)._

### 2. Cursor

Go to **Settings** → **Features** → **MCP**:

1. Click **+ Add New MCP Server**
2. **Name:** `Precept` | **Type:** `command`
3. **Command:** `npx -y @preceptai/mcp-server`
4. Click **Save**
5. Ensure your terminal has the `PRECEPT_API_KEY` environment variable set, or add it to a local `.env` file where Cursor is opened.

### 3. Codex

Run the following CLI command:

```bash
codex mcp add precept --env PRECEPT_API_KEY=your_api_key_here -- npx -y @preceptai/mcp-server
```

_(Or add to `~/.codex/config.toml` under `[mcp_servers.precept]` if you prefer manual configuration)._

---

## Remote Setup: Streamable HTTP Mode

For remote deployment (e.g., ChatGPT Web/Desktop or hosted agents), run the server over Streamable HTTP:

### 1. Configure Environment

Create a `.env` file in the project root:

```env
PRECEPT_API_KEY=your_precept_api_key_here
MCP_TRANSPORT=http
PORT=3000
ALLOWED_HOSTS=your-mcp-domain.com
```

### 2. Start Server

```bash
npm start
```

The server will expose a stateless MCP endpoint at `http://your-domain.com:3000/mcp`.

---

## Environment Variables

| Variable          | Default               | Description                                                                                 |
| :---------------- | :-------------------- | :------------------------------------------------------------------------------------------ |
| `PRECEPT_API_KEY` | _(required)_          | Your Precept API key from the [Developer Dashboard](https://app.preceptai.co.uk/developer). |
| `MCP_TRANSPORT`   | `stdio`               | Transport mode: `stdio` (local) or `http` (remote Streamable HTTP).                         |
| `PORT`            | `3000`                | Port for HTTP mode.                                                                         |
| `ALLOWED_HOSTS`   | `localhost,127.0.0.1` | Comma-separated allowed hosts for DNS rebinding protection (HTTP mode only).                |

---

## Credits & Pricing

All Precept API operations consume credits. Key costs:

| Operation                   | Cost                      |
| :-------------------------- | :------------------------ |
| Lead Search (no insights)   | 0.1 credits/lead          |
| Lead Search (with insights) | 1.1 credits/lead          |
| Lead Enrichment             | 1 credit/lead             |
| Contact Details (email)     | +1 credit/lead            |
| Contact Details (phone)     | +10 credits/lead          |
| Company Base Insight        | 1 credit/company          |
| Custom Query                | 0.2 credits/query/company |
| Decision Makers             | 0.5 credits/person/role   |
| Technology Stack            | 2 credits/company         |
| Revenue                     | 5 credits/company         |
| Post Activity Filter        | +5 credits/lead           |

See the full [Precept Credits Documentation](https://docs.preceptai.co.uk/essentials/credits) for details.

---

## Links

- [Precept Website](https://preceptai.co.uk)
- [Precept API Documentation](https://docs.preceptai.co.uk)
- [Developer Dashboard](https://app.preceptai.co.uk/developer)
- [Model Context Protocol](https://modelcontextprotocol.io)

---

## License

MIT
