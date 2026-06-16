# Session Recording

## Overview

Session Recording allows you to capture all outgoing LLM and external API requests from your AI agents at the transport layer. Captured exchanges are automatically scrubbed of sensitive keys, enriched with metadata (latency, token usage, and cost), and saved to a local SQLite database for offline analysis.

## Steps

1.  **Start the Orchid Proxy**: Ensure the Docker container is running and listening on port 4320.
2.  **Initialize the SDK**: Import the thin SDK in your agent application code. The SDK automatically patches standard HTTP clients to inject session tracking headers.
3.  **Set Session Metadata**: You can optionally group your recordings by setting a session identifier in your environment before running your agent:
    ```bash
    export ORCHID_SESSION_ID="customer-onboarding-test-run"
    ```
4.  **Execute Your Agent**: Run your agent workflow. All outbound HTTP/HTTPS requests to supported LLM providers are intercepted.
5.  **Verify Database Storage**: The proxy writes the recorded exchanges directly to the local SQLite database. You can verify that data is being recorded by checking the session list in the Web Visualizer.

## Intercepting Non-LLM API Traffic (Vector DBs, Search, Tools)

By default, the Orchid SDK only intercepts traffic directed to core LLM providers (such as OpenAI, Anthropic, or Google Gemini). To capture external tool calls, vector database requests (such as Pinecone, Qdrant, or Milvus), or other API endpoints (such as Google Search or custom endpoints), you must configure domain capturing:

1. **Explicit Capture Domains**: Set the `ORCHID_CAPTURE_DOMAINS` environment variable to a comma-separated list of target hostnames:
   ```bash
   export ORCHID_CAPTURE_DOMAINS="api.pinecone.io,api.tavily.com,custom-service.internal"
   ```
2. **Wildcard Interception**: Set `ORCHID_CAPTURE_DOMAINS` to `*` to force the SDK to intercept and route *all* outbound HTTP/HTTPS traffic through the proxy:
   ```bash
   export ORCHID_CAPTURE_DOMAINS="*"
   ```
3. **Explicit Bypass**: If using the wildcard `*`, you can bypass internal or high-volume endpoints using `ORCHID_IGNORE_DOMAINS`:
   ```bash
   export ORCHID_IGNORE_DOMAINS="telemetry.internal,metrics.datadoghq.com"
   ```

## Configuration Options

Use these environment variables to control how sessions are recorded and processed by the proxy:

| Variable | Description | Default Value |
| :--- | :--- | :--- |
| `OPENAI_BASE_URL` | Routes OpenAI client traffic to the proxy. Set to `http://localhost:4320/v1`. | None |
| `GOOGLE_CLOUD_DISABLE_GRPC` | Forces Google Cloud SDKs to use HTTP/REST instead of gRPC, allowing the proxy to intercept Gemini traffic. | `false` |
| `ORCHID_CAPTURE_DOMAINS` | Comma-separated domains to capture. Set to `*` to capture all outgoing HTTP requests. | Core providers |
| `ORCHID_IGNORE_DOMAINS` | Comma-separated domains to bypass interception. | Empty |


## Troubleshooting

### Traffic is not appearing in the database
*   **Symptom**: You run your agent, but no sessions or exchanges appear in the database or Web Visualizer.
*   **Why it happens**: The agent's HTTP client is bypassing the proxy, or the SDK was not initialized early enough in the application lifecycle.
*   **What to do**: Ensure `import orchid` is the very first import in your application's entry point file. Verify that `OPENAI_BASE_URL` is explicitly set to point to the proxy address (`http://localhost:4320/v1`).

### Sensitive API keys are visible in recorded headers
*   **Symptom**: Your raw API keys appear in the recorded headers within the database.
*   **Why it happens**: The proxy's automatic scrubbing rules did not recognize a custom authorization header format.
*   **What to do**: Ensure you are using standard authorization headers (e.g., `Authorization: Bearer <key>`). Standard headers are automatically scrubbed and replaced with redacted placeholders by the proxy.