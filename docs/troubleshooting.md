# Troubleshooting

Common problems and solutions when setting up or running Orchid.

## First identify the running mode

Run `orchid --version` for the macOS Desktop application, or `docker ps --filter name=orchid-proxy` for the Docker/server product. Some settings and fixes apply to only one mode.

## Unauthorized error (401) in the server Web Visualizer

* **Symptom**: The Web Visualizer displays a key-entry screen or returns `401 Unauthorized`.
* **Cause**: The Docker/server proxy has `ORCHID_API_KEY` configured, but the browser has not provided the same key.
* **Fix**: Enter the Orchid API key in the visualizer's key-entry screen. Avoid placing secrets in URLs because browser history, logs, and screenshots may expose them.

The macOS Desktop UI uses a one-use local bootstrap URL and does not require `ORCHID_API_KEY`.

## Proxy Connection Failed Warning in Logs

* **Symptom**: You see a warning in your application logs: `Orchid Proxy connection failed. Falling back to direct routing`.
* **Cause**: The Orchid Proxy is offline or unreachable mid-session.
* **Fix**: The SDK automatically fails soft and routes traffic directly to the upstream provider to prevent application failure. To restore recording, verify that the Orchid Proxy container is running and accessible at `ORCHID_PROXY_URL`.

## Outgoing Requests Bypass the Proxy

* **Symptom**: Your agent runs successfully, but no exchanges appear in the Web Visualizer.
* **Cause**: The SDK failed its startup health check and silently fell back to direct routing, or the target domain is not configured for interception.
* **Fix**: Ensure the Orchid Proxy is running before starting your application. If the proxy is running on a custom port, verify that `ORCHID_QUERY_URL` is set correctly. You can also force-apply the SDK patches by setting `ORCHID_BYPASS_HEALTHCHECK=True`.

## Critical security error on server startup

* **Symptom**: The proxy fails to start with `CRITICAL SECURITY: Cannot bind to [host] without ORCHID_API_KEY set`.
* **Cause**: The server was configured to listen on an external network interface, such as `0.0.0.0`, without an Orchid access key.
* **Fix**: Set `ORCHID_API_KEY` before starting the server, or bind only to localhost with `ORCHID_BIND_HOST=127.0.0.1`.

## Desktop says `Invalid API key`

* **Symptom**: Claude Code returns `Invalid API key` or `Fix external API key` during capture.
* **Cause**: The provider rejected the Anthropic credential. This is not an Orchid API-key error.
* **Fix**: Use a valid Claude subscription login or export an active Anthropic Console key as `ANTHROPIC_API_KEY`. API billing must be enabled for that key's workspace. Never send the key in an issue report.

## Session budget blocks a request

* **Symptom**: A captured request returns `409 Conflict` with `X-Orchid-Budget-Blocked: cost_unknown`, or `402 Payment Required` with `X-Orchid-Budget-Blocked: limit_reached`.
* **Cause**: `ORCHID_SESSION_BUDGET_USD` or `--session-budget-usd` is set. The session either contains an earlier call whose cost cannot be determined, or its known subtotal has reached the configured amount.
* **Fix**: Inspect the session in the UI or Query API. Add matching pricing or resolve the earlier usage before retrying `cost_unknown`; use a new session or raise/unset the positive budget setting for `limit_reached`. Do not assume the budget is an invoice-exact or concurrency-safe cap.

## Desktop reports `Orchid Replay Miss`

* **Symptom**: Replay ends with HTTP 404 and `No matching recorded exchange found`.
* **Cause**: The replayed request does not match a complete exchange in the selected session. A changed prompt, model, tool definition, client version, working directory, or command option can change the request.
* **Fix**: Return to the same directory and repeat the exact session name, prompt, client version, and command options used for capture. Capture a new fixture if the intended request changed.

Do not add `--replay-miss-fallback` merely to hide this error. That option permits a real provider request and can incur cost.

## Desktop prints `destination-rejected (statsig.anthropic.com)`

* **Symptom**: One or more rejection messages appear while Claude Code runs.
* **Cause**: Claude Code attempted optional telemetry traffic to a domain outside Orchid's fixed interception registry.
* **Fix**: No action is needed if the model request itself succeeds. Orchid intentionally does not expand TLS interception to unknown destinations.

## Desktop UI does not open

* **Symptom**: `orchid ui` starts, but no browser window appears.
* **Cause**: The default browser could not open the one-use URL, or port `4321` is unavailable.
* **Fix**: Read the terminal error, stop another process using port `4321` if applicable, and run `orchid ui` again. Keep the terminal process running while using the UI.