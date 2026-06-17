# Configuration

Configure Orchid using environment variables or command-line flags to customize proxy routing, security, and data retention.

## Proxy and Routing Settings

| Variable / Flag | Description | Allowed Values | Default | Required / Optional |
| :--- | :--- | :--- | :--- | :--- |
| `ORCHID_PROXY_URL` | Base URL of the Orchid interceptor proxy. | URL string | `http://127.0.0.1:4320/v1` | Optional |
| `ORCHID_QUERY_URL` | Base URL of the Orchid Query and Control service. | URL string | Derived (`http://127.0.0.1:4321`) | Optional |
| `ORCHID_CAPTURE_DOMAINS` | Comma-separated list of domains to proxy. Use `*` to capture all outgoing HTTP requests. | Comma-separated domains, or `*` | Core providers | Optional |
| `ORCHID_IGNORE_DOMAINS` | Comma-separated list of domains to explicitly bypass. | Comma-separated domains | Empty | Optional |
| `ORCHID_MODE` | Interception mode for the proxy and SDK client. | `capture`, `replay`, `passthrough` | `capture` | Optional |
| `ORCHID_RECORD` | Runs replay block testing in capture/record mode. | `0`, `1`, `true`, `false`, `yes`, `no` | `0` | Optional |
| `ORCHID_SESSION_ID` | Session ID for grouping LLM/API exchanges under a single timeline. | String | None | Optional |


## Credential and Security Settings

| Variable / Flag | Description | Allowed Values | Default | Required / Optional |
| :--- | :--- | :--- | :--- | :--- |
| `ORCHID_API_KEY` | Global API key required to authenticate to the Orchid Proxy and Control Client (injected as `X-Orchid-Api-Key`). | String | None | Optional (Required if binding to non-localhost) |

> [!IMPORTANT]
> **API Key in Docker**: The docker image binds to `0.0.0.0` by default. As a result, you must supply `ORCHID_API_KEY` on container startup. Leaving it empty causes a crash-exit (`CRITICAL SECURITY: Cannot bind to 0.0.0.0 without ORCHID_API_KEY set`).
>
> **Exempt Endpoints**: The health check endpoint (`/health`) and the static visualizer assets are open/unauthenticated. This allows the visualizer UI to load in your browser, but it requires the key to query session data (the screen will prompt you for your key). All other paths (the proxy port and the data query endpoints) are auth-gated.


## Storage and Retention Settings

| Variable / Flag | Description | Allowed Values | Default | Required / Optional |
| :--- | :--- | :--- | :--- | :--- |
| `ORCHID_DB_PATH` | Path to the SQLite database file. | File path | `~/.orchid/orchid.db` | Optional |
| `ORCHID_RETENTION_DAYS` | Delete sessions older than this many days (0 = keep forever). | Integer | `30` | Optional |
| `ORCHID_MAX_DB_MB` | Prune oldest sessions when the database exceeds this size in MB (0 = unlimited). | Integer | `1024` | Optional |

## Additional Configuration Variables

| Variable | Status | Default | Notes |
|---|---|---|---|
| `GOOGLE_CLOUD_DISABLE_GRPC` | discovered | Not set | Discovered in source or CI configuration. |
| `OPENAI_API_KEY` | discovered | Not set | Discovered in source or CI configuration. |
| `OPENAI_BASE_URL` | discovered | Not set | Discovered in source or CI configuration. |
