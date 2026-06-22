# Model Context Protocol (MCP) Server

## Overview

The Model Context Protocol (MCP) Server is embedded directly within the Orchid Proxy. It allows AI agents and IDE tools (like Claude Code, Cursor, or VS Code Copilot) to query, search, and manage recorded sessions programmatically, enabling agent-driven debugging and triage.

The embedded server supports three integration methods:
1. **Local HTTP Mode** *(Recommended)*: The IDE connects directly to the running Orchid Proxy process over HTTP.
2. **Local Stdio Mode** *(Legacy / Zero-Config)*: The IDE spawns the Orchid Proxy container locally over standard input/output.
3. **Remote HTTP/SSE Mode**: The IDE connects to a remote proxy query service (typically over an SSH/IAP tunnel) using standard HTTP headers.

---

## 1. Local HTTP Integration *(Recommended)*

Use this pattern when running the Orchid Proxy on your local development machine. The HTTP transport connects directly to the running proxy process — no separate subprocess is spawned.

**Prerequisite**: The proxy must be running (`docker compose up -d`) and `ORCHID_API_KEY` must be set.

### VS Code GitHub Copilot

Create or edit `.vscode/mcp.json` in your workspace root. For user-profile scope (all workspaces), use **MCP: Open User Configuration** from the Command Palette.

> VS Code uses `"servers"` (not `"mcpServers"`), requires `"type": "http"`, and uses `${input:id}` for secure values. VS Code does **not** expand shell env vars in `headers` — `$ORCHID_API_KEY` would be sent literally. The `inputs` array causes VS Code to prompt once on first server start and store the value securely.

```json
{
  "servers": {
    "orchid": {
      "type": "http",
      "url": "http://localhost:4321/v1/mcp",
      "headers": {
        "Authorization": "Bearer ${input:orchidApiKey}"
      }
    }
  },
  "inputs": [
    {
      "id": "orchidApiKey",
      "type": "promptString",
      "description": "Orchid API Key (orchid_live_...)",
      "password": true
    }
  ]
}
```

### Claude Code

```bash
claude mcp add --transport http orchid http://localhost:4321/v1/mcp \
  --header "Authorization: Bearer $ORCHID_API_KEY" \
  --scope user
```

> `--scope user` stores the config in `~/.claude.json` and makes it available across all projects. The shell expands `$ORCHID_API_KEY` at add-time and stores the resolved token. If you rotate your API key, re-run this command.

### Cursor

Create `.cursor/mcp.json` in your project root (project-local) or `~/.cursor/mcp.json` (global). Cursor uses `${env:NAME}` syntax:

> `${env:ORCHID_API_KEY}` is Cursor's interpolation syntax. `${ORCHID_API_KEY}` (without `env:`) would be sent literally and cause 401s. `ORCHID_API_KEY` must be set in the shell environment before launching Cursor.

```json
{
  "mcpServers": {
    "orchid": {
      "url": "http://localhost:4321/v1/mcp",
      "headers": {
        "Authorization": "Bearer ${env:ORCHID_API_KEY}"
      }
    }
  }
}
```

### Google Antigravity IDE

Antigravity IDE only supports stdio transport. Use [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) as a stdio→HTTP bridge (Node.js 18+ required). Config file: `~/.gemini/antigravity-ide/mcp_config.json` (macOS/Linux) or `%USERPROFILE%\.gemini\antigravity-ide\mcp_config.json` (Windows).

> **Do not commit this file** — it contains a plaintext API key. Replace `orchid_live_your_key_here` with your actual key.
>
> `--allow-http` is required — `mcp-remote` rejects non-HTTPS URLs by default. The header is split across the `--header` arg and `env.AUTH_HEADER` to work around a known issue in some IDE clients where spaces inside args are not escaped correctly. To clear cached auth state after key rotation: `rm -rf ~/.mcp-auth`.

```json
{
  "mcpServers": {
    "orchid": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://localhost:4321/v1/mcp",
        "--allow-http",
        "--transport", "http-only",
        "--header",
        "Authorization:${AUTH_HEADER}"
      ],
      "env": {
        "AUTH_HEADER": "Bearer orchid_live_your_key_here"
      }
    }
  }
}
```

### OpenAI Codex

Add to `~/.codex/config.toml`. Codex uses TOML format and requires the env var **name** (not the value):

> `bearer_token_env_var` takes the name of the env var (the string `"ORCHID_API_KEY"`). Codex reads the value at runtime. Inline secrets (`bearer_token = "..."`) are rejected by the runtime with an error. `ORCHID_API_KEY` must be set when running `codex`.

```toml
[mcp_servers.orchid]
url = "http://localhost:4321/v1/mcp"
bearer_token_env_var = "ORCHID_API_KEY"
```

---

## 2. Local Stdio Integration *(Legacy / Zero-Config)*

> **Note:** The stdio transport spawns a separate `orchid-proxy --mcp` process inside the container. That process shares the SQLite database (read operations work correctly) but has its own isolated in-memory state. Use HTTP transport (Section 1) for the recommended local integration.

Use this pattern when running the Orchid Proxy container and the IDE/MCP client on the same local development machine.

### Step 1: Configure Your Client

Add the Orchid configuration to your local client config file:
* **Cursor**: In Cursor Settings -> Features -> MCP -> Add New Tool (choose `command` type).
* **Google Antigravity IDE**: `~/.gemini/antigravity-ide/mcp_config.json` (macOS/Linux) or `%USERPROFILE%\.gemini\antigravity-ide\mcp_config.json` (Windows).
* **Claude Code**:
  * *Recommended (Exec)*: `claude mcp add orchid-local docker -- exec -i orchid-proxy orchid-proxy --mcp`
  * *Standalone (Run)*: `claude mcp add orchid-local docker -- run -i --rm -v orchid-data:/data ghcr.io/mario-guerra/orchid-proxy:latest --mcp --bind-host 127.0.0.1`

Choose one of the two config approaches below:

#### Method A: Connect to Running Container (`docker exec` — Recommended)

If you already have a persistent proxy container running (started in step 2), you can connect the IDE's MCP client directly to it. This runs the MCP process inside the running container namespace, saving resources and ensuring direct access to the database.

```json
{
  "mcpServers": {
    "orchid-local": {
      "command": "docker",
      "args": [
        "exec",
        "-i",
        "orchid-proxy",
        "orchid-proxy",
        "--mcp"
      ]
    }
  }
}
```
> [!IMPORTANT]
> This requires the running container to be named `orchid-proxy`.

#### Method B: Standalone Container (`docker run`)

Use this if you do not run a persistent proxy server, or if you prefer to launch a dedicated container instance specifically for the MCP server.

```json
{
  "mcpServers": {
    "orchid-local": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-v",
        "orchid-data:/data",
        "ghcr.io/mario-guerra/orchid-proxy:latest",
        "--mcp",
        "--bind-host",
        "127.0.0.1"
      ]
    }
  }
}
```
> [!NOTE]
> Passing `--bind-host 127.0.0.1` at the end bypasses the `ORCHID_API_KEY` requirement for stdio communication, preventing unauthorized network exposure. If you want to enforce key check, omit `--bind-host 127.0.0.1` and pass `-e ORCHID_API_KEY=your_key_here` in the Docker args list.


### Step 2: Restart/Refresh Your Client
Restart or refresh your IDE/MCP Client to load the server. Your assistant will automatically discover the Orchid MCP tools (like `list_sessions`, `search_exchanges`, etc.).

---

## 3. Remote HTTP/SSE Integration (Recommended for Cloud)

Use this pattern when the Orchid Proxy is running in a cloud virtual machine or staging container. Since exposing the ports directly to the public internet is unsafe, connect using an encrypted SSH tunnel.

### Step 1: Open the SSH Tunnel
Establish a secure port-forward to map the remote query port (`4321`) to localhost:

```bash
ssh -L 4321:localhost:4321 user@your-remote-vm-ip
```

### Step 2: Configure Your Client
Add the server configuration using the streamable HTTP transport endpoint. Make sure to supply your generated API key using a `Bearer` token prefix in the `Authorization` header:

```json
{
  "mcpServers": {
    "orchid-remote": {
      "url": "http://localhost:4321/v1/mcp",
      "headers": {
        "Authorization": "Bearer orchid_live_your_generated_key_here"
      }
    }
  }
}
```

---

## 4. Available MCP Tools

Your assistant automatically discovers these tools once connected:

### Session Control & Overview
* **`get_proxy_status`**: Inspect active proxy configuration and SQLite storage statistics.
* **`list_sessions`**: List recent LLM capture sessions with usage and cost summary stats.
* **`get_session_details`**: Retrieve detailed metadata summaries (excluding full payloads) for a session.
* **`get_last_session`**: Instantly retrieve request/response payloads of only the single most recently recorded LLM exchange.
* **`set_active_session`**: Set a global active session override for proxy recording (useful for black-box or E2E integration testing).
* **`clear_active_session`**: Clear the global active session override, resuming default header-based session tracking.
* **`clear_session_exchanges`**: Clear all recorded exchanges (traces) from a session without deleting the session itself. Also available via the **Eraser** button in the web UI header when a session is open.
* **`delete_session`**: Permanently delete a session and all its associated exchanges from the SQLite database. Also available via the **Trash** icon on each session row in the web UI dashboard, or from the header when a session is open.

### Job Triage & Metrics
* **`list_jobs`**: List aggregated pipeline jobs recorded by the proxy.
* **`list_job_steps`**: List a lightweight step outline (metadata only) for a given job/session ID to analyze execution sequences.
* **`get_event_details`**: Retrieve full request and response details for a specific exchange event UUID.
* **`get_perf_profile`**: Get aggregated latency, call count, cost, and token profile metrics grouped by step and provider.

### Search & Fixture Portability
* **`search_exchanges`**: Search prompt/completion payloads globally across all sessions using text substring and model/provider filters.
* **`search_job_payloads`**: Search text payloads matching a pattern within a specific job.
* **`export_session`**: Export a session as a portable JSON fixture payload (useful for local mocking or unit tests).
* **`import_session`**: Import/seed a session fixture payload into the database.

### Cost & Pricing Configuration
* **`get_pricing`**: Retrieve the currently active pricing definitions (provider -> model -> cost mappings). If no pricing is loaded, returns a structured template with `status: "no_pricing_configured"`, an `instructions` field, and a `template` object pre-populated with the distinct provider/model pairs observed in recorded traffic (zero values). Fill in the costs, serialize `template` to a JSON string, and pass it to `update_pricing`. Save the result locally to re-apply it on proxy restart.
* **`update_pricing`**: Upload new pricing definitions to the proxy. Accepts a stringified JSON schema containing provider -> model -> cost mappings per million tokens. Pricing is stored in-memory only — restart clears it. Use `get_pricing` to retrieve and save your config locally for reuse.
  * *Example Pricing JSON Format:*
    ```json
    {
      "openai": {
        "gpt-5.5": { "prompt": 5.0, "completion": 15.0 },
        "gpt-5-mini": { "prompt": 0.5, "completion": 1.5 }
      },
      "anthropic": {
        "claude-4-6-sonnet": { "prompt": 3.0, "completion": 15.0 }
      }
    }
    ```
* **`recompute_pricing`**: Recompute `cost_usd` for all stored exchanges using the currently active pricing definitions. Use after updating pricing to backfill costs on sessions recorded before pricing was loaded.

---

## 5. Available MCP Resources & Templates

For MCP clients that support the Resource specification, Orchid exposes data nodes directly under the `orchid://` URI scheme:

### Resources
* **`orchid://sessions`**: A JSON list of all recorded trace sessions with their metadata.
* **`orchid://jobs`**: A JSON list of pipeline jobs recorded by the proxy.

### Resource Templates
* **`orchid://sessions/{session_id}`**: Retrieves the complete session log/fixture for the specified `session_id`.
* **`orchid://jobs/{job_id}/events`**: Retrieves a timelined list of step execution events for a single pipeline run.

---

## 6. Available MCP Prompts

Orchid includes built-in prompt templates that can guide assistant analysis:

* **`analyze_failure`**: Loads the failed step execution logs of a pipeline job directly into the LLM context to diagnose issues (e.g., rate limits, bad JSON structure, provider errors).
  * *Arguments*: `job_id` (string, required)
* **`optimize_cost`**: Generates a summary analysis prompt containing prompt/completion ratios and costs to help identify opportunities to save costs or use cheaper models.
  * *Arguments*: `session_id` (string, required)

---

## Configuration Options

Orchid Proxy configuration can be passed via command-line flags or environment variables:

| CLI Flag | Environment Variable | Description | Default |
| :--- | :--- | :--- | :--- |
| `--mcp` | N/A | Runs the proxy in stdin/stdout MCP mode (blocks HTTP listener). | `false` |
| `--bind-host` | `ORCHID_BIND_HOST` | Host IP address to bind to (e.g., `127.0.0.1` or `0.0.0.0`). | `127.0.0.1` |
| `--proxy-port` | `ORCHID_PROXY_PORT` | Port for the reverse proxy listener. | `4320` |
| `--query-port` | `ORCHID_QUERY_PORT` | Port for the query API and SSE endpoints. | `4321` |
| `--api-key` | `ORCHID_API_KEY` | Global API Key for securing HTTP/SSE endpoints. | None |
| `--db-path` | `ORCHID_DB_PATH` | Path to the SQLite database. | `~/.orchid/orchid.db` |
| `--pricing-file` | `ORCHID_PRICING_FILE` | Path to a local JSON file containing pricing definitions. | None |
| `--retention-days` | `ORCHID_RETENTION_DAYS` | Automatically delete sessions older than this many days (0 = disabled). | `30` |
| `--max-db-mb` | `ORCHID_MAX_DB_MB` | Prune oldest sessions when database size exceeds this value in MB (0 = disabled). | `1024` |
| `--default-provider` | `ORCHID_DEFAULT_PROVIDER` | Default upstream provider when no path prefix is used. | None |
| `--session-id` | `ORCHID_SESSION_ID` | Force recording under a specific session ID (groups exchanges). | None |

### Subcommands

* **`generate-api-key`**: Generates a secure, high-entropy global API key.

---

## Troubleshooting

### Symptom: Client fails to connect to the Stdio server
* **Cause**: Docker permissions are missing, or the volume name `orchid-data` does not exist.
* **Fix**: Run the command `docker run --rm -v orchid-data:/data ghcr.io/mario-guerra/orchid-proxy:latest --mcp` manually in your shell to verify execution rights.

### Symptom: Database is locked error
* **Cause**: Multiple docker containers are trying to write to the SQLite database concurrently.
* **Fix**: Ensure your proxy instance is configured to run SQLite in WAL (Write-Ahead Logging) mode, or run exactly 1 active container replica using the volume.

### Symptom: `update_pricing` appears to succeed but recorded exchanges show `NULL` costs
* **Cause**: Pricing was uploaded but exchanges recorded before the upload were not backfilled. Costs are computed at ingest time; existing rows are not retroactively updated.
* **Fix**: After uploading pricing via `update_pricing`, call `recompute_pricing` to backfill `cost_usd` on previously recorded exchanges.