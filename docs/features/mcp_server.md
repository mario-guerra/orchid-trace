# Model Context Protocol (MCP) Server

## Overview

The Model Context Protocol (MCP) Server is embedded directly within the Orchid Proxy. It allows AI agents and IDE tools (like Claude Code, Cursor, or VS Code Copilot) to query, search, and manage recorded sessions programmatically, enabling agent-driven debugging and triage.

The embedded server supports two distinct integration methods:
1. **Local Stdio Mode**: The IDE spawns the Orchid Proxy container locally over standard input/output.
2. **Remote HTTP/SSE Mode**: The IDE connects to the remote proxy query service (typically over an SSH/IAP tunnel) using standard HTTP headers.

---

## 1. Local Stdio Integration

Use this pattern when running the Orchid Proxy container and the IDE/MCP client on the same local development machine.

### Step 1: Configure Your Client

Add the Orchid configuration to your local client config file:
* **Claude Code**: `~/Library/Application Support/Claude/mcp_config.json`
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

## 2. Remote HTTP/SSE Integration (Recommended for Cloud)

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

## 3. Available MCP Tools

Your assistant automatically discovers these tools once connected:

### Session Control & Overview
* **`get_proxy_status`**: Inspect active proxy configuration and SQLite storage statistics.
* **`list_sessions`**: List recent LLM capture sessions with usage and cost summary stats.
* **`get_session_details`**: Retrieve detailed metadata summaries (excluding full payloads) for a session.
* **`get_last_session`**: Instantly retrieve request/response payloads of only the single most recently recorded LLM exchange.
* **`set_active_session`**: Set a global active session override for proxy recording (useful for black-box or E2E integration testing).
* **`clear_active_session`**: Clear the global active session override, resuming default header-based session tracking.
* **`clear_session_exchanges`**: Clear all recorded exchanges (traces) from a session without deleting the session itself.
* **`delete_session`**: Permanently delete a session and all its associated exchanges from the SQLite database.

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

## 4. Available MCP Resources & Templates

For MCP clients that support the Resource specification, Orchid exposes data nodes directly under the `orchid://` URI scheme:

### Resources
* **`orchid://sessions`**: A JSON list of all recorded trace sessions with their metadata.
* **`orchid://jobs`**: A JSON list of pipeline jobs recorded by the proxy.

### Resource Templates
* **`orchid://sessions/{session_id}`**: Retrieves the complete session log/fixture for the specified `session_id`.
* **`orchid://jobs/{job_id}/events`**: Retrieves a timelined list of step execution events for a single pipeline run.

---

## 5. Available MCP Prompts

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