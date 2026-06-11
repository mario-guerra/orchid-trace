# Orchid TypeScript SDK

The Orchid TypeScript SDK is a lightweight, thin SDK designed to work seamlessly with Orchid - [the Orchestration Interactive Debugger](https://orchidtrace.xyz).

It automatically intercepts outgoing LLM and external API requests (e.g., OpenAI, Anthropic, Gemini, Vertex AI, SerpAPI, etc.) and routes them through the local Orchid Proxy. This enables full request capturing, visualization, interactive debugging, and mock replay capabilities in unit tests or local development environments.

**Requires Node.js 18+** (native `fetch` and `AsyncLocalStorage`).

---

## Installation

```bash
npm install orchid-sdk
```

---

## Quickstart

### 1. Initialization

Call `await init()` at the entry point of your application (before instantiating any LLM clients).

```ts
import { init } from "orchid-sdk";

// Initialize the Orchid environment and patch the global fetch
await init();

// Now, standard client libraries will automatically route through the Orchid proxy!
import OpenAI from "openai";
const client = new OpenAI();
```

### 2. Session Contexts

Use `session()` to group API exchanges under a specific session ID and mode. Context propagates safely across async boundaries via `AsyncLocalStorage`.

```ts
import { init, session } from "orchid-sdk";

await init();

// Intercept and capture requests in this block under a custom session name
await session("user-onboarding-flow", "capture", async () => {
  // Outgoing LLM calls here will be captured under session ID 'user-onboarding-flow'
  const response = await client.chat.completions.create({
    model: "gpt-5.2",
    messages: [{ role: "user", content: "Hello!" }],
  });
});
```

Supported modes are:
* `"capture"`: Intercepts and records all outgoing requests.
* `"replay"`: Intercepts requests and serves mocked responses from previously recorded exchanges.
* `"passthrough"`: Bypasses the proxy database logging (requests still pass through but are not recorded/mocked).

### Explicit fetch wrapper (no global patching)

If you prefer not to patch `globalThis.fetch`, pass `orchidFetch` directly to clients that accept a custom fetch implementation:

```ts
import { orchidFetch } from "orchid-sdk";
import OpenAI from "openai";

const client = new OpenAI({ fetch: orchidFetch });
```

---

## Capture & Replay Test Helper (`withReplay`)

`withReplay()` automates capturing and replaying HTTP exchanges. It is framework-agnostic and works in vitest, jest, or `node:test`, ensuring test suites are deterministic and do not make expensive, slow, or volatile external network calls.

```ts
import { withReplay } from "orchid-sdk";

test("user greeting", () =>
  withReplay("tests/fixtures/test_user_greeting.json", async () => {
    // If ORCHID_RECORD=1: executes the API call and saves results to the JSON fixture file.
    // If ORCHID_RECORD=0 or unset: mocks the API call using the contents of the fixture file.
    const response = await client.chat.completions.create({
      model: "gpt-5.2",
      messages: [{ role: "user", content: "Say hello!" }],
    });
    expect(response.choices[0].message.content.toLowerCase()).toContain("hello");
  }));
```

---

## Orchid Control Client

For programmatic control over recorded fixtures, use `OrchidControlClient` to check health, export, or import fixtures.

```ts
import { OrchidControlClient } from "orchid-sdk";

// Create the client pointing to the control port (default: 4321)
const controlClient = new OrchidControlClient();

// Check if the query service is active
if (await controlClient.checkHealth()) {
  // Export a recorded session to a local JSON file
  await controlClient.exportFixture("my-session-123", "fixtures/session_data.json");

  // Import a local JSON fixture database back into the proxy
  await controlClient.importFixture("fixtures/session_data.json");
}
```

---

## Configuration (Environment Variables)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `ORCHID_PROXY_URL` | `http://127.0.0.1:4320/v1` | The Orchid Proxy intercept endpoint. |
| `ORCHID_QUERY_URL` | derived (`:4321`) | The Query & Control API endpoint. |
| `ORCHID_PROXY_KEY` | — | Auth key sent as `X-Orchid-Proxy-Key`. |
| `ORCHID_API_KEY` | — | Control plane API key (`X-Orchid-Api-Key`). |
| `ORCHID_SESSION_ID` / `ORCHID_MODE` | — | Global session/mode fallback when no `session()` scope is active. |
| `ORCHID_CAPTURE_DOMAINS` | — | Comma-separated extra domains to intercept, or `*` for all. |
| `ORCHID_IGNORE_DOMAINS` | — | Comma-separated domains to never intercept. |
| `ORCHID_RECORD` | — | Set to `1` to run `withReplay` blocks in record mode. |
| `ORCHID_BYPASS_HEALTHCHECK` | — | Set to `True` to skip the init health check. |

---

## How It Works (Auto-Instrumentation)

When you call `init()`, the SDK patches `globalThis.fetch` (Node's native undici-backed fetch). This automatically intercepts libraries like `openai` and `@anthropic-ai/sdk`, which use the global fetch as their underlying HTTP transport. Requests to core LLM providers (and any `ORCHID_CAPTURE_DOMAINS`) are rewritten to the proxy with `X-Orchid-*` control headers attached; localhost traffic is never intercepted.

### Fail-Soft Fallback

The SDK is built to be resilient. During initialization, the SDK performs a fast health check on the Orchid Query service.
* If the proxy or control service is **offline**, the SDK silently falls back to direct routing. The global fetch is not patched, and environment base URLs are not modified.
* If the patch is active but the proxy goes offline mid-session, the wrapper catches connection failures, logs a warning, case-insensitively purges internal Orchid headers (preventing key leakage), and seamlessly retries the request directly to the upstream public API.

---

## Development

```bash
npm install
npm test        # vitest
npm run build   # tsup -> dist/ (esm + cjs + d.ts)
```
