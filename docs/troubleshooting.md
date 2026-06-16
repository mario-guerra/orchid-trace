# Troubleshooting

Common problems and solutions when setting up or running Orchid.

## Unauthorized Error (401) in Web Visualizer

* **Symptom**: The Web Visualizer displays a styled key-entry screen or returns a 401 Unauthorized status code.
* **Cause**: The Orchid Proxy is running with `ORCHID_API_KEY` configured, but the browser or client has not provided a valid key.
* **Fix**: Enter the correct API key in the styled key-entry screen in the Web Visualizer, or pass it via the `key` or `api_key` query parameter in the URL (e.g., `http://localhost:4321/?key=your_api_key`).

## Proxy Connection Failed Warning in Logs

* **Symptom**: You see a warning in your application logs: `Orchid Proxy connection failed. Falling back to direct routing`.
* **Cause**: The Orchid Proxy is offline or unreachable mid-session.
* **Fix**: The SDK automatically fails soft and routes traffic directly to the upstream provider to prevent application failure. To restore recording, verify that the Orchid Proxy container is running and accessible at `ORCHID_PROXY_URL`.

## Outgoing Requests Bypass the Proxy

* **Symptom**: Your agent runs successfully, but no exchanges appear in the Web Visualizer.
* **Cause**: The SDK failed its startup health check and silently fell back to direct routing, or the target domain is not configured for interception.
* **Fix**: Ensure the Orchid Proxy is running before starting your application. If the proxy is running on a custom port, verify that `ORCHID_QUERY_URL` is set correctly. You can also force-apply the SDK patches by setting `ORCHID_BYPASS_HEALTHCHECK=True`.

## Critical Security Error on Startup

* **Symptom**: The proxy fails to start with the error: `CRITICAL SECURITY: Cannot bind to [host] without ORCHID_API_KEY set`.
* **Cause**: You configured the proxy to bind to an external network interface (like `0.0.0.0`) instead of `127.0.0.1` without setting an API key.
* **Fix**: Set the `ORCHID_API_KEY` environment variable to secure your endpoints, or bind only to localhost by setting `ORCHID_BIND_HOST=127.0.0.1`.