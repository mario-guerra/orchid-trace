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
* **Response**: A JSON object describing the session's overall stats.

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
* **Description**: Inspect the active LLM provider model pricing map used for cost calculations.
* **Response**: The loaded model prompt/completion pricing JSON.

#### `POST /pricing`
* **Description**: Upload a new model pricing config JSON payload to override active pricing rates.
* **Request Body**: A pricing map JSON payload.
* **Response**: `200 OK` on success.

#### `POST /pricing/recompute`
* **Description**: Backfill cost calculations across historically recorded sessions in the database based on the active pricing map.
* **Response**: `200 OK` on success.

---

### 4. Diagnostics & Live Streams

#### `GET /health`
* **Description**: Inspect proxy health status. Bypasses authentication checks.
* **Response**: `{"status": "ok"}`
