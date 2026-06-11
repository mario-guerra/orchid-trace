# Orchid — Record, Inspect, Replay AI Agents

[Orchid Website](https://orchidtrace.xyz)

**Stop grepping logs.** Orchid records your agent's network traffic — LLM calls, tool invocations, and any other API your agent talks to — through a zero-instrumentation proxy, then lets you time-travel through completed runs, inspect every payload, and debug failures step-by-step — in the proxy's built-in web UI or via MCP tools from your IDE.

**Orchid gives your coding agent the ability to debug your AI app.** The proxy has a built-in MCP server, so when an LLM call is buried deep in your stack — behind a framework, a queue, three layers of abstraction — your AI assistant in Cursor, VS Code, or Claude Desktop can query the recorded traffic directly and see exactly what prompts went out and what came back, allowing your local agent to reason about the response and address issues immediately. No print statements, no log spelunking: ask your agent "why did this run fail?" and it can go look, figure out why it happened, and fix it for you.

You choose how much to record: route only your LLM traffic through the proxy for lightweight inspection, or capture everything for the full picture. To **replay** a run with perfect fidelity, all of the agent's network traffic must go through the proxy — replay works by serving back the recorded responses, so anything that wasn't recorded can't be replayed.

> This repository contains the open-source Orchid SDKs and user documentation. The `orchid-proxy` container is distributed via the GitHub Container Registry (see below). Content here is synced automatically from the main development repository — issues and discussions are welcome; pull requests may be ported rather than merged directly.

---

## Quick Start: Run the Orchid Proxy

The proxy ships as a multi-arch container image (Apple Silicon `arm64` and Linux `amd64`):

*   **Stable**: `ghcr.io/mario-guerra/orchid-proxy:latest`
*   **Rolling**: `ghcr.io/mario-guerra/orchid-proxy:edge`

### 1. Generate an API key
```bash
docker run --rm ghcr.io/mario-guerra/orchid-proxy:latest generate-api-key
```

### 2. Start the proxy
```bash
docker run -d \
  --name orchid-proxy \
  -p 4320:4320 \
  -p 4321:4321 \
  -v orchid-data:/data \
  -e ORCHID_API_KEY=your-secure-api-key \
  -e ORCHID_DB_PATH=/data/orchid.db \
  ghcr.io/mario-guerra/orchid-proxy:latest
```

*   **Recording Proxy**: `http://localhost:4320/v1` (pass `X-Orchid-Proxy-Key: your-secure-api-key` — the `Authorization` header is forwarded untouched to the upstream provider). Works for LLM endpoints and any other HTTP API you route through it.
*   **Query API / Visualizer UI**: `http://localhost:4321`

### 3. Point your app at the proxy

Use the SDKs in this repository ([sdk/python/](sdk/python/), [sdk/rust/](sdk/rust/)) or simply set your client's base URL to the proxy — for your LLM provider, and for any other APIs you want recorded. Route everything through the proxy if you want full-fidelity replay. See [docs/deploy_and_setup.md](docs/deploy_and_setup.md) for full instructions, including cloud deployment templates (AWS / GCP / Azure).

### 4. Connect your AI assistant (MCP)

Hook the proxy's MCP server into Cursor, VS Code, or Claude Desktop and your coding agent gets direct visibility into your app's recorded LLM traffic — even when those calls happen deep inside frameworks or services it could never see otherwise. Setup instructions are in [docs/deploy_and_setup.md](docs/deploy_and_setup.md).

---

## What's in this repository

| Path | Contents |
| --- | --- |
| `sdk/python/` | Python instrumentation SDK |
| `sdk/rust/` | Rust instrumentation SDK |
| `docs/` | Deployment, setup, and integration guides |

Additional language SDKs will be added under `sdk/` as they become available.

## License

The SDKs are open source — see [sdk/python/LICENSE](sdk/python/LICENSE).
