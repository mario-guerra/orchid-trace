# Getting Started

## Overview

Orchid (Orchestration Interactive Debugger) is a local-first, zero-instrumentation tool designed to record, inspect, and replay AI agent and LLM traffic. It acts as a lightweight intercepting proxy that captures all outgoing requests at the transport layer into a local SQLite database. It provides an embedded web visualizer for step-by-step telemetry analysis, and an embedded Model Context Protocol (MCP) server so that AI assistants (such as Cursor, VS Code, or Claude Code) can directly query and debug your agent's execution sequence in natural language.


## Prerequisites

Before using Orchid, ensure you have the following in place:
* Docker installed on your local machine or staging environment.
* Python 3.8+ or Node.js 18+ (or any language that supports HTTP clients/middleware, such as Go, Java, or Rust).
* API keys for your upstream LLM providers (such as `OPENAI_API_KEY` or Anthropic credentials).
* If you plan to expose the proxy to a non-localhost network interface, you must generate a secure global API key to protect your captured prompts and credentials.

## Step-by-Step Installation

### Step 0: Get the Orchid Proxy Container

Pull the multi-arch container image from the GitHub Container Registry:

```bash
docker pull ghcr.io/mario-guerra/orchid-proxy:latest
```

*(Optional)* If you need to bind the proxy to a public network interface, you must secure it. Generate a secure, high-entropy global API key by running:

```bash
docker run --rm ghcr.io/mario-guerra/orchid-proxy:latest generate-api-key
```

### Step 1: Start the Orchid Proxy

Run the Orchid Proxy container using Docker, passing your generated key as the `ORCHID_API_KEY` environment variable. This secures the proxy instance endpoints, requiring clients to provide this key for all subsequent proxy and API access. This command also maps the proxy port (`4320`) and the query/web interface port (`4321`), and mounts a local volume to persist your SQLite database.


```bash
docker run -d \
  -p 4320:4320 \
  -p 4321:4321 \
  -v orchid-data:/data \
  --name orchid-proxy \
  ghcr.io/mario-guerra/orchid-proxy:latest
```

> [!IMPORTANT]
> **API Key is Mandatory in Docker**: The Orchid Proxy container binds to `0.0.0.0` (`ORCHID_BIND_HOST=0.0.0.0`) by default to receive external bridge network traffic. Because of this, setting `ORCHID_API_KEY` is **mandatory** when running the Docker image. If you start the container without a key, the proxy will crash-exit immediately on startup.
>
> **Exempt Public Routes**: The health check endpoint (`/health`) and the static visualizer web assets (HTML, JS, CSS) on the query port (`4321`) are exempt from authentication. This allows the visualizer UI to load in your browser, but it requires the key to load any session data (the screen will prompt you to enter the key). However, all actual proxy traffic (port `4320`) and data API endpoints (port `4321` under `/v1/*` and `/api/*`) are strictly auth-gated and require the key.

### Step 2: Install the Orchid SDK

Install the lightweight SDK in your application environment to enable automatic transport patching.

For Python applications:
```bash
pip install orchid-sdk
```

For TypeScript/JavaScript applications:
```bash
npm install orchid-sdk
```

For Rust applications, we recommend a native HTTP middleware approach instead of a dedicated SDK. See the [Rust Integration Guide](./features/rust_integration.md) for full instructions and copy-pasteable code.

## Initializing the SDK

Call the initialization helper at the very beginning of your application entry point, before you instantiate any LLM clients.

For Python applications:
```python
import orchid

# Initialize the Orchid environment and patch network transports
orchid.init()
```

For TypeScript/JavaScript applications:
```typescript
import { init } from "orchid-sdk";

// Initialize the Orchid environment and patch the global fetch
await init();
```



## Connecting Your AI Assistant (MCP)

Orchid embeds a Model Context Protocol (MCP) server that exposes its telemetry database to your agentic coding environments (like Cursor, VS Code, or Claude Code). This allows your AI coding assistant to query, search, and analyze recorded LLM traffic directly using natural language—enabling your coding agent to debug your AI application automatically.

To connect your IDE assistant:
* For local development, configure your client to run the proxy container in interactive stdio mode with the `--mcp` flag.
* For remote staging/production containers, connect via the streamable HTTP transport (`/v1/mcp`) over an SSH tunnel.

See the [MCP Server Guide](./features/mcp_server.md) for full configuration steps.

---

## Next Steps

Once your first run is recorded and your MCP client is connected, explore the other features:
* **[Session Recording](./features/session_recording.md)**: Group and customize capture scopes.
* **[Replay Testing](./features/replay_testing.md)**: Run integration tests completely offline with zero API cost.
* **[Web Visualizer](./features/web_visualizer.md)**: Inspect latencies, token counts, and cost waterfall charts in your browser.
* **[Configuration Reference](./configuration.md)**: Customize data retention limits and security settings.


