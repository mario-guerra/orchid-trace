# Model Context Protocol (MCP) Server

## Overview

The Model Context Protocol (MCP) Server is embedded directly within the Orchid Proxy. It allows AI agents and IDE tools (like Claude Desktop, Cursor, or VS Code Copilot) to query, search, and manage recorded sessions programmatically, enabling agent-driven debugging and triage.

The embedded server supports two distinct integration methods:
1. **Local Stdio Mode**: The IDE spawns the Orchid Proxy container locally over standard input/output.
2. **Remote HTTP/SSE Mode**: The IDE connects to the remote proxy query service (typically over an SSH/IAP tunnel) using standard HTTP headers.

---

## 1. Local Stdio Integration

Use this pattern when running the Orchid Proxy container and the IDE/MCP client on the same local development machine.

### Step 1: Configure Your Client

Add the Orchid configuration to your local client config file:
* **Claude Desktop**: `~/Library/Application Support/Claude/mcp_config.json`
* **Cursor**: In Cursor Settings -> Features -> MCP -> Add New Tool (choose `command` type).
* **Google Antigravity IDE**: `~/.gemini/antigravity-ide/mcp_config.json` (macOS/Linux) or `%USERPROFILE%\.gemini\antigravity-ide\mcp_config.json` (Windows).
* **Claude Code**: Run the command `claude mcp add orchid-local docker -- run -i --rm -v orchid-data:/data ghcr.io/mario-guerra/orchid-proxy:latest --mcp --bind-host 127.0.0.1` (or add to `~/.config/claude/mcp.json`).
> [!NOTE]
> **Authentication in Stdio Mode**: Because the Docker image binds to `0.0.0.0` by default, launching the container requires a configured `ORCHID_API_KEY` by default. 
> 
> * **Option A (No Key setup)**: If you are running the container locally *only* for stdio MCP, you can bypass key validation by passing `--bind-host 127.0.0.1` at the end of the container arguments (included in the examples below). Since communication occurs over stdin/stdout, there is no network exposure.
> * **Option B (Using a Key)**: If you run a persistent proxy server or want to enforce key check, omit `--bind-host 127.0.0.1` and pass `-e ORCHID_API_KEY=your_key_here` in the Docker args list.


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

---

## Configuration Options


| CLI Flag | Description | Default |
| :--- | :--- | :--- |
| `--mcp` | Runs the proxy in stdin/stdout MCP mode (blocks HTTP listener). | `false` |

---

## Troubleshooting

### Symptom: Client fails to connect to the Stdio server
* **Cause**: Docker permissions are missing, or the volume name `orchid-data` does not exist.
* **Fix**: Run the command `docker run --rm -v orchid-data:/data ghcr.io/mario-guerra/orchid-proxy:latest --mcp` manually in your shell to verify execution rights.

### Symptom: Database is locked error
* **Cause**: Multiple docker containers are trying to write to the SQLite database concurrently.
* **Fix**: Ensure your proxy instance is configured to run SQLite in WAL (Write-Ahead Logging) mode, or run exactly 1 active container replica using the volume.