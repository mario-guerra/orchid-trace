# Orchid — Record, Inspect, Replay AI Agents

**Stop grepping logs.** Orchid captures LLM traffic through a zero-instrumentation proxy, then lets you time-travel through completed runs, inspect every payload, and debug failures step-by-step — in the proxy's built-in web UI or via MCP tools from your IDE.

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

*   **LLM Proxy**: `http://localhost:4320/v1` (pass `X-Orchid-Proxy-Key: your-secure-api-key` — the `Authorization` header is forwarded untouched to the upstream provider)
*   **Query API / Visualizer UI**: `http://localhost:4321`

### 3. Point your app at the proxy

Use the SDKs in this repository ([sdk/python/](sdk/python/), [sdk/rust/](sdk/rust/)) or simply set your LLM client's base URL to the proxy. See [docs/deploy_and_setup.md](docs/deploy_and_setup.md) for full instructions, including cloud deployment templates (AWS / GCP / Azure) and MCP integration for Cursor, VS Code, and Claude Desktop.

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
