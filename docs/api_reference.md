# Orchid Query API Reference

The Orchid Proxy query and control service exposes a REST API on the query port (default `4321`). All endpoints are registered under both `/v1` and `/api` prefixes (e.g. `GET /v1/sessions` and `GET /api/sessions` are identical).

---

## Authentication

If `ORCHID_API_KEY` is configured on the proxy, you must authorize all requests using one of the following headers:
* `Authorization: Bearer <your-secure-api-key>`
* `X-Orchid-Api-Key: <your-secure-api-key>`

In local-only mode (where `ORCHID_API_KEY` is not set), authentication is bypassed and the API is open.

---

## Endpoints

### 1. Session Operations

#### `GET /sessions`
* **Description**: List the most recent LLM capture sessions with cost and token summary statistics.
* **Response**: A JSON array of sessions containing session details, aggregate tokens, and cost.

#### `GET /sessions/{session_id}`
* **Description**: Get summary metadata for a specific session ID.
* **Response**: A JSON object describing the session's overall stats. `total_cost_usd` is the known-cost subtotal and `total_cost_usd_nanos` is its fixed-point form. Check `cost_status`: `final` means every call is final, `provisional` or `estimated` means every call has a numeric cost with lower certainty, `partial` means at least one call is unpriced, `unknown` means no call is priced, and `empty` means the session has no calls. `priced_exchanges` and `unknown_cost_exchanges` give the coverage.

#### `GET /sessions/{session_id}/exchanges`
* **Description**: Retrieve the chronological list of individual request/response exchanges recorded in the session.
* **Response**: A JSON array of exchange objects.

#### `GET /sessions/{session_id}/export`
* **Description**: Export a session and all its captured exchanges as a portable JSON fixture file.
* **Response**: The complete serialized JSON fixture.

#### `POST /sessions/import`
* **Description**: Seed a session fixture file payload back into the SQLite database.
* **Request Body**: The raw serialized JSON fixture to import.
* **Response**: `200 OK` on success.

---

### 2. Global Control Plane Overrides

#### `GET /sessions/active`
* **Description**: Retrieve the current active session override.
* **Response**: A JSON object describing the active override, or `null` if no override is set.

#### `POST /sessions/active`
* **Description**: Configure a global active session ID override. Once set, the proxy forces all incoming LLM requests to record under this session name, overriding any headers passed by the SDK.
* **Request Body**:
  ```json
  {
    "session_id": "target-session-name",
    "mode": "capture"
  }
  ```
* **Response**: `200 OK` on success.

#### `POST /sessions/clear` (or `DELETE /sessions/active`)
* **Description**: Clear the active session override, returning the proxy to default header-based session routing.
* **Response**: `200 OK` on success.

---

### 3. Pricing Configuration

#### `GET /pricing`
* **Description**: Inspect the active versioned, exact-model pricing catalog used for cost calculations.
* **Response**: A document containing `version`, `currency`, and `providers`.

#### `POST /pricing`
* **Description**: Replace active pricing rates. Rates are USD per one million tokens; model IDs match exactly (case-insensitive).
* **Request Body**: A JSON document containing a non-empty `version`, `currency: "USD"`, and a `providers` map. Legacy unversioned maps remain accepted, but their results are marked `estimated_unversioned` rather than `final`.
* **Response**: `200 OK` on success.

#### `POST /pricing/recompute`
* **Description**: Backfill eligible non-final historical calls using the active catalog. Existing `final` costs retain their original version.
* **Response**: `200 OK` on success.

Each exchange includes `cost_usd_nanos`, `cost_status`, `pricing_version`, `pricing_model`, `usage_source`, and normalized `usage_json`. `final` means complete provider-reported usage was fully priced by that catalog; it does not guarantee equality with a provider invoice.

Clients may send `X-Orchid-Turn-Id` to attribute multiple provider calls to one stable application turn. Orchid stores it as `turn_id`, records `turn_source: "x-orchid-turn-id"`, and strips the control header before forwarding upstream. If the client does not provide a stable ID, both fields remain `null`; Orchid does not invent turn IDs from timestamps, sequence numbers, or provider response IDs.

Tool analysis is recorded per exchange. `tool_definition_count` and `tool_definition_bytes` describe the request's top-level `tools` array. `tool_definition_tokens_estimated` is a rough size estimate of one token per four serialized JSON bytes, not provider-reported usage and not an invoice quantity. `tool_call_count` counts structured tool calls in complete, non-streaming Anthropic, OpenAI, and Gemini/Vertex responses; it is `null` when Orchid cannot determine a reliable count, including streaming responses.

### Session budget responses

When `ORCHID_SESSION_BUDGET_USD` or `--session-budget-usd` is set, Orchid checks the current session before forwarding a captured request. It returns either:

- `409 Conflict`, `X-Orchid-Budget-Blocked: cost_unknown`, and `error.reason: "cost_unknown"` if a previous call has unknown cost; or
- `402 Payment Required`, `X-Orchid-Budget-Blocked: limit_reached`, and `error.reason: "limit_reached"` if the known subtotal is at or above the configured limit.

Both responses use `Content-Type: application/json` and contain `error.type: "session_budget"`, the configured `error.limit_usd`, and a message confirming that Orchid did not forward the request. This is a pre-request threshold, not a concurrency-safe reservation or an invoice-exact hard cap.

---

### 4. Diagnostics & Live Streams

#### `GET /health`
* **Description**: Inspect proxy health status. Bypasses authentication checks.
* **Response**: `{"status": "ok"}`

#### `GET /stats`
* **Description**: Retrieve global proxy database statistics, including sizing, limits, and aggregate token/cost stats.
* **Response**: A JSON object of stats:
  ```json
  {
    "total_sessions": 42,
    "total_exchanges": 1280,
    "total_prompt_tokens": 542001,
    "total_completion_tokens": 125032,
    "total_cost_usd": 12.35,
    "db_size_bytes": 1048576,
    "max_db_mb": 1024,
    "retention_days": 30
  }
  ```

---

### 5. Model Context Protocol (MCP) Stream & Message Endpoints

These endpoints support the Model Context Protocol (MCP) Streamable HTTP transport and SSE (Server-Sent Events) integrations.

#### `POST /mcp` (or `POST /mcp/`)
* **Description**: Streamable HTTP transport message endpoint. Receives single JSON-RPC messages (e.g., `initialize`, requests, or notifications).
* **Headers**: 
  * `mcp-protocol-version`: Negotiated version (e.g., `2024-11-05` or `2025-03-26`).
  * `mcp-session-id`: Header identifying the client session.
* **Response**: A JSON-RPC response payload on success. Spawns a new session with an `mcp-session-id` response header if sending the `initialize` method.

#### `DELETE /mcp` (or `DELETE /mcp/`)
* **Description**: Terminate the streamable HTTP session specified by the `mcp-session-id` header.
* **Response**: `204 No Content` on success.

#### `GET /mcp/sse`
* **Description**: SSE channel endpoint for the remote SSE-based MCP integration. Initializes the unidirectional server-to-client event stream.
* **Response**: Event-stream containing a handshake event `endpoint` pointing to the message target URL (including a unique `connectionId`).

#### `POST /mcp/message`
* **Description**: Accepts JSON-RPC requests from the client and dispatches them to the associated SSE transport session.
* **Query Parameters**:
  * `connectionId`: The unique connection UUID assigned during the `/mcp/sse` handshake.
* **Response**: `200 OK` on success. The actual response is pushed asynchronously through the active SSE stream.
