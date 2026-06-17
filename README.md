# Orchid — Record, Inspect, Replay AI Agents

[Orchid Website](https://orchidtrace.xyz)

**Stop grepping logs.** Orchid records your agent's network traffic — LLM calls, tool invocations, and any other API your agent talks to — through a zero-instrumentation proxy. Then it lets you:

*   **Time-travel** through completed runs, step by step
*   **Inspect** every prompt, response, token count, and cost
*   **Debug** failures in the built-in web UI or via MCP tools from your IDE
*   **Replay** recorded runs offline — deterministic tests with zero API cost

**Orchid gives your coding agent the ability to debug your AI app.** The proxy has a built-in MCP server, so when an LLM call is buried deep in your stack — behind a framework, a queue, three layers of abstraction — your AI assistant in Cursor, VS Code, or Claude Desktop can query the recorded traffic directly. No print statements, no log spelunking: ask your agent *"why did this run fail?"* and it can go look, figure out why, and fix it for you.

You choose how much to record: route only your LLM traffic through the proxy for lightweight inspection, or capture everything for the full picture. To **replay** a run with perfect fidelity, all of the agent's network traffic must go through the proxy — replay works by serving back the recorded responses, so anything that wasn't recorded can't be replayed.

> **IMPORTANT NOTE - YOUR DATA _NEVER_ LEAVES YOUR INFRASTRUCTURE!** 
>
> *   The proxy forwards requests **only** to the upstream APIs your app was already calling.
> *   Everything recorded stays in a local SQLite database inside the container (or your mounted volume). No phone-home, no telemetry, no cloud backend.
> *   Secrets are scrubbed in memory **before** anything is written to disk: `Authorization` headers are forwarded untouched to the upstream but never stored, and headers, query strings, and body fields with secret-like names (keys, tokens, passwords, credentials, cookies) are stored as `[REDACTED]`.
> *   One honest caveat: redaction works by recognizing field *names* (like `api_key` or `authorization`), not by scanning the contents of your prompts. Prompt and completion text is recorded verbatim — that's the whole point of Orchid — so if a secret is pasted into a prompt, it will be stored along with the rest of the prompt text.


This repository contains the open-source Orchid SDKs and user documentation. The `orchid-proxy` container is distributed via the GitHub Container Registry (see below). Content here is synced automatically from the main development repository — issues and discussions are welcome; pull requests may be ported rather than merged directly.

---

## How It Works

```mermaid
flowchart LR
    subgraph env["Your Environment (laptop, on-prem, or your own cloud)"]
        app["Application<br/>(Python, TS, ...)"]
        proxy["orchid-proxy<br/>:4320 (proxy)<br/>:4321 (query / UI / MCP)"]
        db[("orchid.db<br/>(SQLite)")]
        app -- "HTTP" --> proxy
        proxy -- "record" --> db
        db -. "replay" .-> proxy
    end
    upstream["Upstream APIs<br/>OpenAI, Anthropic,<br/>Gemini, tools, any API ..."]
    proxy -- "HTTPS<br/>(skipped in replay mode)" --> upstream
```

### Non-Intrusive Interception (Thin SDK)

Unlike traditional LLM observability tools that require wrapping every client initialization or using heavy SDKs with AST modifications, Orchid uses an **APM-style Thin SDK**. The SDK patches the foundational HTTP transport layer (`httpx`/`requests` in Python, `fetch` in Node), so every LLM call made by standard client libraries is automatically routed through the local or remote Orchid Proxy — without changing your prompt-handling or generation code.

### Header-Driven State Machine

The proxy does not keep track of application state. It reads `X-Orchid-*` HTTP headers (injected by the SDK, or set manually from any language) to decide how to process each request:

*   **`passthrough`**: Transparent reverse proxy. Forwards the request and returns the response without writing anything to disk.
*   **`capture`**: Forwards the request, serializes the complete request/response payloads (including streaming chunks), calculates costs, and saves them to a local SQLite database under a specific `Session ID`.
*   **`replay`**: Blocks all outbound network traffic. Hashes the incoming request and serves the exact matching recorded response from SQLite. If no match is found, returns a deterministic mock error.

---

## Key Features

### Forensic Capture
Every captured LLM call (or "Exchange") records:
*   **Request Metadata**: System prompts, user prompts, temperature, top-p, and custom tags.
*   **Response Telemetry**: Complete completion text, usage tokens (input/output), and latency.
*   **Cost Calculation**: Real-time USD cost attribution based on up-to-date model pricing maps.
*   **Stream Reassembly**: For streaming completions, Orchid buffers SSE chunks in memory, serving them to the client instantly, and writes the fully reassembled completion body to SQLite.

### Deterministic Mock Replays
Writing mocks for LLM calls in tests is notoriously fragile and tedious. Orchid converts mock management into a simple recording flow:
1.  Run your test suite once in `capture` mode to generate a JSON fixture.
2.  Commit the fixture to your repository.
3.  Run CI in `replay` mode using the fixture. Your tests now execute instantly, offline, and with zero API cost.

Because replay serves responses from the local recording with near-zero latency, it also isolates **your own code's performance**: profile or benchmark your agent logic with network calls and upstream API variance taken out of the equation, and get reproducible numbers run after run.

### Embedded Visualizer Dashboard
The proxy embeds a React-based dashboard on port `4321` — nothing extra to install. Search and filter exchanges by model, provider, status, or prompt keywords; compare token usage and costs across sessions; export sessions as portable JSON fixtures.

<p align="center">
  <img src="assets/web-visualizer-preview.svg" alt="Animated preview of the Orchid web visualizer: an exchange timeline on the left cycling through recorded LLM and tool calls, with the inspector on the right showing provider, status, latency, tokens, and syntax-highlighted JSON output for each exchange" width="880" />
</p>

### MCP Server for AI Assistants
A built-in **MCP server** (SSE) lets AI assistants like Cursor, VS Code, or Claude Desktop query the recorded traffic directly: analyze prompt performance, pull token/cost statistics, or fetch payload examples as context for editing code.

<p align="center">
  <img src="assets/mcp-workspace-preview.svg" alt="Animated preview of an IDE AI assistant debugging a RAG hallucination: the agent calls the Orchid MCP search_exchanges tool, inspects the recorded request payload, and discovers the vector DB injected the wrong document into the prompt context" width="720" />
</p>

---

## Quick Start: Run the Orchid Proxy

The proxy ships as a multi-arch container image (Apple Silicon `arm64` and Linux `amd64`):

*   **Stable**: `ghcr.io/mario-guerra/orchid-proxy:latest`
*   **Rolling**: `ghcr.io/mario-guerra/orchid-proxy:edge`

### 0. Pull the Proxy Image

```bash
docker pull ghcr.io/mario-guerra/orchid-proxy:latest
```

### 1. Generate an API key
```bash
docker run --rm ghcr.io/mario-guerra/orchid-proxy:latest generate-api-key
```

### 2. Start the proxy

Start the container and pass your generated key as the `ORCHID_API_KEY` environment variable.

> [!IMPORTANT]
> **API Key is Mandatory in Docker**: The Orchid Proxy container binds to `0.0.0.0` (`ORCHID_BIND_HOST=0.0.0.0`) by default so that it can receive network traffic. Because it binds to a non-localhost address, setting `ORCHID_API_KEY` is **mandatory** when running inside Docker. If you attempt to start the container without setting `ORCHID_API_KEY`, the proxy will crash-exit on startup for security reasons.
>
> **Exempt Public Routes**: The health check endpoint (`/health`) and the static visualizer web assets (HTML, JS, CSS) on the query port (`4321`) do not require the key, allowing you to load the visualizer login screen. All proxying traffic on port `4320` and data API endpoints (under `/v1/*` and `/api/*` on port `4321`) are strictly auth-gated and require the key.


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

Use the SDKs in this repository ([sdk/python/](sdk/python/), [sdk/typescript/](sdk/typescript/)) or simply set your client's base URL to the proxy — for your LLM provider, and for any other APIs you want recorded. Route everything through the proxy if you want full-fidelity replay. See [docs/getting_started.md](docs/getting_started.md) for full instructions, including cloud deployment templates (AWS / GCP / Azure).

Using Go, Java, Ruby, or anything else? No SDK needed — the proxy is header-driven, so any HTTP client works. See the header specifications in [docs/configuration.md](docs/configuration.md) and [docs/api_reference.md](docs/api_reference.md).

### 4. Connect your AI assistant (MCP)

Hook the proxy's MCP server into Cursor, VS Code, or Claude Desktop and your coding agent gets direct visibility into your app's recorded LLM traffic — even when those calls happen deep inside frameworks or services it could never see otherwise. Setup instructions are in [docs/features/mcp_server.md](docs/features/mcp_server.md).

---

## What's in this repository

| Path | Contents |
| --- | --- |
| `sdk/python/` | Python instrumentation SDK ([PyPI](https://pypi.org/project/orchid-sdk/)) |
| `sdk/typescript/` | TypeScript instrumentation SDK ([NPM](https://www.npmjs.com/package/orchid-sdk)) |
| `docs/` | Deployment, setup, and integration guides |

Additional language SDKs will be added under `sdk/` as they become available.

## License

Orchid SDKs are open source under the [Apache 2.0 License](LICENSE).

