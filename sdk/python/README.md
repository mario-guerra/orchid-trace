# Orchid Python SDK

The Orchid Python SDK is a lightweight, thin SDK designed to work seamlessly with Orchid - [the Orchestration Interactive Debugger](https://orchidtrace.xyz).

It automatically intercepts outgoing LLM and external API requests (e.g., OpenAI, Anthropic, Gemini, Vertex AI, SerpAPI, etc.) and routes them through the local Orchid Proxy. This enables full request capturing, visualization, interactive debugging, and mock replay capabilities in unit tests or local development environments.

---

## Installation

Install the SDK via `pip`:

```bash
pip install orchid-sdk
```

---

## Quickstart

### 1. Initialization

Call `orchid.init()` at the entry point of your application (before instantiating any LLM clients). 

```python
import orchid

# Initialize the Orchid environment and patch network transports
orchid.init()

# Now, standard client libraries will automatically route through the Orchid proxy!
import openai
client = openai.OpenAI()
```

### 2. Session Contexts

Use the `orchid.session` context manager to group API exchanges under a specific session ID and mode.

```python
import orchid

# Initialize the SDK
orchid.init()

# Intercept and capture requests in this block under a custom session name
with orchid.session("user-onboarding-flow", mode="capture"):
    # Outgoing LLM calls here will be captured under session ID 'user-onboarding-flow'
    response = client.chat.completions.create(
        model="gpt-5.2",
        messages=[{"role": "user", "content": "Hello!"}]
    )
```

Supported modes are:
* `"capture"`: Intercepts and records all outgoing requests.
* `"replay"`: Intercepts requests and serves mocked responses from previously recorded exchanges.
* `"passthrough"`: Bypasses the proxy database logging (requests still pass through but are not recorded/mocked).

---

## Capture & Replay Decorator (`@replay`)

The `@replay` decorator automates capturing and replaying HTTP exchanges. It is perfect for unit tests and local iteration, ensuring test suites are deterministic and do not make expensive, slow, or volatile external network calls.

```python
from orchid import replay

# The decorator wraps both synchronous and asynchronous functions
@replay("tests/fixtures/test_user_greeting.json")
def test_user_greeting():
    # If ORCHID_RECORD=1: This will execute the API call and save results to the JSON fixture file.
    # If ORCHID_RECORD=0 or unset: This will mock the API call using the contents of the fixture file.
    response = client.chat.completions.create(
        model="gpt-5.2",
        messages=[{"role": "user", "content": "Say hello!"}]
    )
    assert "hello" in response.choices[0].message.content.lower()
```

*Note: In async contexts, the decorator automatically offloads synchronous file and query service operations to a background executor (`loop.run_in_executor`) to prevent blocking the asyncio event loop.*

---

## Orchid Control Client

For programmatic control over recorded fixtures, you can use the `OrchidControlClient` to manually check health, export, or import fixtures.

```python
from orchid import OrchidControlClient

# Create the client pointing to the control port (default: 4321)
control_client = OrchidControlClient()

# Check if the query service is active
if control_client.check_health():
    # Export a recorded session to a local JSON file
    control_client.export_fixture(session_id="my-session-123", path="fixtures/session_data.json")

    # Import a local JSON fixture database back into the proxy
    control_client.import_fixture(path="fixtures/session_data.json")
```

---

## How It Works (Auto-Instrumentation)

When you run `orchid.init()`, the SDK dynamically monkeypatches the standard request-sending hooks of the following HTTP clients:
1. `httpx` (`httpx.Client.send` and `httpx.AsyncClient.send` — *Note: This automatically intercepts libraries like `openai` and `anthropic` which use `httpx` as their underlying HTTP transport*).
2. `requests` (`requests.Session.request`)
3. `aiohttp` (`aiohttp.ClientSession._request`)
4. `google-cloud-aiplatform` (Vertex AI client classes are forced to use REST transports, which in turn use patched `requests` or `aiohttp` clients).

### Fail-Soft Fallback
The SDK is built to be resilient. During initialization, the SDK performs a fast health check on the Orchid Query service. 
* If the proxy or control service is **offline**, the SDK silently falls back to direct routing. None of the client patches are active, and environment base URLs are not modified.
* If a patch is active but the proxy goes offline mid-session, transport layers catch connection failures, log a warning, case-insensitively purge internal Orchid headers (preventing key leakage), and seamlessly retry the request directly to the upstream public API.

---

## Configuration Variables

Configure the SDK using the following environment variables:

| Variable | Default | Description |
|---|---|---|
| `ORCHID_PROXY_URL` | `http://127.0.0.1:4320/v1` | Base URL of the Orchid interceptor proxy. |
| `ORCHID_QUERY_URL` | `http://127.0.0.1:4321` | Base URL of the Orchid Query and Control service. |
| `ORCHID_API_KEY` | None | API key required to authenticate to the Orchid Proxy and Control Client (injected as `X-Orchid-Api-Key`). |
| `ORCHID_RECORD` | `0` | Set to `1`, `true`, or `yes` to run `@replay` decorators in capture/record mode. |
| `ORCHID_CAPTURE_DOMAINS` | None | Comma-separated list of domains to proxy. Use `*` to capture all outgoing HTTP requests. |
| `ORCHID_IGNORE_DOMAINS` | None | Comma-separated list of domains to explicitly bypass (ignored during capture). |
| `ORCHID_FLUSH_SLEEP` | `0.2` | Delay in seconds before exporting a captured session to allow async logs to flush. |
| `ORCHID_BYPASS_HEALTHCHECK` | `False` | Set to `True` to force-apply monkeypatches without performing the query service handshake. |

---

## License

This project is licensed under the [Apache License 2.0](LICENSE).
