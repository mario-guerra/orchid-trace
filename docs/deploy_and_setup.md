# Standalone Orchid Proxy: Deployment & Integration Guide

The standalone `orchid-proxy` is a self-contained, zero-dependency binary that embeds its own React Visualizer UI and persists telemetry to a local SQLite database. It requires no external dependencies (like ClickHouse or MinIO) to run.

---

## 1. Cloud Container Deployment

The proxy runs inside a container exposing two ports:
*   **`4320`**: Outbound LLM HTTP proxy interceptor.
*   **`4321`**: Telemetry Query API, Visualizer Web UI, and remote SSE MCP Server.

### Core Environment Variables
| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `ORCHID_API_KEY` | None | Global API Key for Zero-Trust access to query/control endpoints. |
| `ORCHID_BIND_HOST` | `127.0.0.1` | Network interface to bind. Set to `0.0.0.0` in containers. |
| `ORCHID_DB_PATH` | `~/.orchid/orchid.db` | Location of the SQLite database. Point this inside a mounted volume (e.g. `/data/orchid.db`) for persistence. |
| `ORCHID_PROXY_PORT` | `4320` | Interceptor listening port. |
| `ORCHID_QUERY_PORT` | `4321` | API / UI listening port. |
| `ORCHID_RETENTION_DAYS` | `30` | Age limit: sessions whose newest exchange is older than this are pruned automatically. Set to `0` to disable. |
| `ORCHID_MAX_DB_MB` | `1024` | Size cap: oldest sessions are pruned until the database fits under this limit (MB). Set to `0` to disable. |

> [!NOTE]
> **The database is self-limiting.** With the defaults above, the SQLite database holds at most ~30 days of sessions and stays under ~1 GB — whichever limit is hit first. The currently active session is never pruned. See [Data Retention](#3-data-retention-automatic-pruning) below for details.

> [!IMPORTANT]
> **Fail-Safe Security Rule**: If `ORCHID_BIND_HOST` is set to anything other than `127.0.0.1` (e.g. `0.0.0.0` inside a container) and `ORCHID_API_KEY` is not configured, the container will instantly fail to start.

### Docker Run (Local Verification)

#### Option A: Persistent Local Mount (Data survives container restarts)
```bash
# 1. Generate a secure, high-entropy API key
docker run --rm -it orchid-proxy generate-api-key

# 2. Start the container mapping host storage to /data
docker run -d \
  --name orchid-proxy \
  -p 4320:4320 \
  -p 4321:4321 \
  -e ORCHID_BIND_HOST=0.0.0.0 \
  -e ORCHID_API_KEY="orchid_live_your_generated_key_here" \
  -e ORCHID_DB_PATH=/data/orchid.db \
  -v ./data:/data \
  orchid-proxy:latest
```

> [!WARNING]
> Both halves are required for persistence: the `-v` mount makes `/data` live on the host, **and** `ORCHID_DB_PATH` must point inside it. If `ORCHID_DB_PATH` is omitted, the database defaults to `~/.orchid/orchid.db` *inside* the container's ephemeral filesystem and is lost when the container is removed — even if a volume is mounted.

#### Option B: Ephemeral Testing (No host storage, auto-wiped on teardown)
If you just want to run temporary tests and wipe all database records upon deletion:
```bash
# 1. Run the container without the -v volume flag
docker run -d \
  --name orchid-proxy-temp \
  -p 4320:4320 \
  -p 4321:4321 \
  -e ORCHID_BIND_HOST=0.0.0.0 \
  -e ORCHID_API_KEY="dev-key-local" \
  orchid-proxy:latest

# 2. When done, stop and delete the container (wipes the temporary database)
docker rm -fv orchid-proxy-temp
```

### Production Cloud Ingress Patterns
*   **AWS ECS**: Deploy as a Fargate Task. Map `ORCHID_API_KEY` directly from AWS Secrets Manager. Mount an EFS volume to `/data` to persist the SQLite database.
*   **AWS EC2 (Recommended Boring Pattern)**: Deploy as a single Virtual Machine with an attached SSD (gp3) volume mapped to `/data`. A ready-to-run automation template is available at [docs/user/deployments/aws/](./deployments/aws/) containing the Terraform and Cloud-Init files.
*   **GCP Cloud Run**: Deploy as a service. Mount a secret reference from Google Secret Manager to the `ORCHID_API_KEY` environment variable. Enable Cloud Storage volume mount or utilize a persistent network volume for database state.
*   **GCP Compute Engine (Recommended Boring Pattern)**: Deploy as a single Virtual Machine with an attached SSD persistent disk mapped to `/data`. A ready-to-run automation template is available at [docs/user/deployments/gcp/](./deployments/gcp/) containing the Terraform and Cloud-Init files.
*   **Azure Container Apps (ACA)**: Deploy as a Container App. Reference the API key from Azure Key Vault using a Container App Secret mapped to the `ORCHID_API_KEY` environment variable. Mount an Azure Files share to `/data` to persist the SQLite database.
*   **Azure VM (Recommended Boring Pattern)**: Deploy as a single Virtual Machine with an attached Premium SSD managed disk mapped to `/data`. A ready-to-run automation template is available at [docs/user/deployments/azure/](./deployments/azure/) containing the Terraform and Cloud-Init files.

### Accessing the Deployed Proxy (SSH Tunnel — Recommended)

Do **not** expose ports `4320`/`4321` to the public internet. The recommended access pattern is an encrypted SSH tunnel; on GCP, use Identity-Aware Proxy (IAP) so the VM needs **no** public ingress rules at all:

```bash
# GCP: allow SSH only from Google's IAP range (one-time setup, per VPC)
gcloud compute firewall-rules create allow-iap-ssh \
  --network=<YOUR_VPC> \
  --direction=INGRESS --action=ALLOW \
  --rules=tcp:22 \
  --source-ranges=35.235.240.0/20

# Open the tunnel (leave this running while you work)
gcloud compute ssh <VM_NAME> --zone <ZONE> --tunnel-through-iap \
  -- -L 4321:localhost:4321 -L 4320:localhost:4320
```

With the tunnel up:
*   **Dashboard / Query API**: browse `http://localhost:4321`
*   **Agents / SDK**: point `ORCHID_PROXY_URL` at `http://localhost:4320` and `ORCHID_QUERY_URL` at `http://localhost:4321`
*   **MCP clients**: use `http://localhost:4321/v1/mcp/sse`

> [!TIP]
> If `http://localhost:4321` serves something unexpected, check for a local process already bound to the port with `lsof -nP -iTCP:4321 -sTCP:LISTEN` before starting the tunnel.

On AWS/Azure, the equivalent is a plain SSH tunnel to the VM (`ssh -L 4321:localhost:4321 -L 4320:localhost:4320 user@<vm>`) with ports 4320/4321 closed in the security group / NSG.

---

### Compute & Storage Sizing Guide

Because `orchid-proxy` is compiled as a native, single-threaded/async Rust binary, its resource consumption is extremely low compared to Node.js or Python equivalents.

#### 1. Compute Allocation (CPU & RAM)
*   **Minimum Baseline**: `0.25 vCPU` and `512 MB RAM`. This is sufficient for small teams or local testing.
*   **Production Standard**: `0.5 vCPU` and `1 GB RAM`. This can easily handle hundreds of concurrent proxy connections and visualizer sessions.
*   **Scaling Policy**: Run exactly **1 instance**. The proxy stores all telemetry in an embedded SQLite database, which only supports safe concurrent writes from a single process — multiple container instances writing to the same database file on a network share can cause locking errors or corruption. Do not configure auto-scaling beyond 1 replica.

#### 2. Storage Estimation
SQLite database growth depends directly on your request/response size and your retention rules:
*   **Average Exchange Size**: ~25 KB (including system prompts, completions, token usage metadata, and latencies).
*   **10,000 Exchanges**: ~250 MB
*   **100,000 Exchanges**: ~2.5 GB
*   **Default cap**: With the default `ORCHID_MAX_DB_MB=1024`, the database never exceeds ~1 GB regardless of traffic — oldest sessions are pruned first (see [Data Retention](#3-data-retention-automatic-pruning)).
*   **Recommendation**: Allocate persistent storage of at least **2× your `ORCHID_MAX_DB_MB` value** (default: a few GB is ample; raise the cap and the allocation together if you need longer history).

#### 3. Data Retention (Automatic Pruning)
The proxy enforces two retention limits in the background as exchanges are written. Whichever limit is hit first wins:

| Limit | Variable | Default | Behavior when exceeded |
| :--- | :--- | :--- | :--- |
| **Age** | `ORCHID_RETENTION_DAYS` | `30` | Sessions whose newest exchange is older than the window are deleted. |
| **Size** | `ORCHID_MAX_DB_MB` | `1024` | Oldest sessions are deleted one at a time until the database fits. |

Key behaviors:
*   Pruning operates on **whole sessions**, never individual exchanges — a retained session is always complete and replayable.
*   The **currently active session is never pruned**, even if it exceeds the limits on its own.
*   Set a variable to `0` to disable that limit. Setting both to `0` disables pruning entirely — only do this with monitoring on disk usage, since the database will then grow without bound.
*   If the disk fills despite the caps (e.g. other processes consume it), recording fails gracefully: the proxy continues forwarding traffic to upstreams and logs storage errors — you lose new recordings, not availability.

#### 4. Persistent Volume Requirement (Ephemeral Storage Warning)
> [!CAUTION]
> **Ephemeral Container Storage**: Standard serverless container hostings (Azure Container Apps, GCP Cloud Run, AWS Fargate) run on ephemeral filesystems. If the container crashes, restarts, or scales down to zero, **all data written to the container's internal storage is permanently lost**.
>
> You **must** configure a persistent volume mount mapping to `/data` (using AWS EFS, GCP Filestore, or Azure Files). Container platforms do not grow these mounts dynamically; you must provision the network share with a minimum storage quota.

---

## 2. Project Integration

The client application integrates with the proxy using the **Thin SDK** pattern. The SDK patches the HTTP transport layer globally (`httpx`, `requests`, and `aiohttp`) and routes client requests through the proxy interceptor.

This design **avoids code instrumentation** inside your application logic. You do not need to wrap your LLM calls in context managers or decorators; session groupings and execution modes are controlled entirely via standard environment variables.

### 1. Environment Configuration
Define the following environment variables to control telemetry capture and routing without changing your application code:

```bash
# 1. Proxy routing (interceptor endpoint)
export ORCHID_PROXY_URL="http://your-proxy-domain-or-ip:4320"
export ORCHID_PROXY_KEY="orchid_live_your_generated_key_here"

# 2. Session grouping — all proxied LLM exchanges are tagged with this ID
export ORCHID_SESSION_ID="my-app-run-001"

# 3. Capture mode: "capture" (log to DB), "replay" (serve from cache), or "passthrough"
export ORCHID_MODE="capture"

# 4. Query endpoint (required for fixture import/export via MCP)
export ORCHID_QUERY_URL="http://your-proxy-domain-or-ip:4321"
export ORCHID_API_KEY="orchid_live_your_generated_key_here"
```

### 2. Bootstrapping the SDK
Call `orchid.init()` at the **entry point** of your application, before importing any LLM client libraries. This registers transport-level hooks that automatically intercept all outbound AI API calls.

```python
import orchid

# One-line setup — patches httpx, requests, and aiohttp globally
orchid.init()
```

After initialization, use your LLM clients exactly as you normally would — no code changes required:

#### OpenAI
```python
from openai import OpenAI

client = OpenAI()  # API key and base URL are automatically redirected through the proxy
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Explain quantum computing in 5 words."}]
)
```

#### Anthropic
```python
import anthropic

client = anthropic.Anthropic()
message = client.messages.create(
    model="claude-opus-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Explain quantum computing in 5 words."}]
)
```

#### Google Generative AI (Gemini)
```python
import google.generativeai as genai

# The SDK patches the underlying httpx transport, so genai calls are captured automatically
model = genai.GenerativeModel("gemini-2.5-flash")
response = model.generate_content("Explain quantum computing in 5 words.")
```

#### Any framework built on top of standard clients
If you use a higher-level framework (LangChain, LlamaIndex, CrewAI, AutoGen, etc.) that uses `openai`, `anthropic`, or `google-generativeai` under the hood, those calls are captured automatically — no framework-specific configuration needed.

### 3. Telemetry Inspection
Once your session completes:
*   **Visualizer UI**: Open `http://your-proxy-domain-or-ip:4321` in your browser to inspect the exchange timeline, token usage (including thought tokens), request/response payloads, and latency.
*   **IDE MCP Integration**: Use the `orchid-proxy` MCP tools to query recorded session exchanges directly inside Cursor, VS Code, or Claude Desktop.

### 4. Zero-Instrumentation Replay
To run your application locally or in CI/CD without hitting live upstream APIs, set `ORCHID_MODE=replay` before running:

```bash
export ORCHID_SESSION_ID="my-app-run-001"
export ORCHID_MODE="replay"
python your_app.py
```

The proxy intercepts all outbound calls and returns the recorded responses from the SQLite database, matched by a semantic hash of the prompt. Your application code is unchanged.

### 5. (Optional) Unit Testing with Replay Decorators
For formal test suites (`pytest`), the `@orchid.replay` decorator binds a test function to a fixture file. Run with `ORCHID_RECORD=true` to capture live responses; subsequent runs replay from the fixture:

```python
import pytest
import orchid
from openai import OpenAI

@orchid.replay("tests/fixtures/my_app_test.json")
def test_completion_logic():
    client = OpenAI()
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "Hello"}]
    )
    assert response.choices[0].message.content

```

---

## 3. Remote IDE / MCP Client Connection

To connect AI coding tools (such as **Cursor**, **VS Code**, or **Claude Desktop**) to the containerized proxy's Model Context Protocol (MCP) server, configure them to use the Server-Sent Events (SSE) channel on port `4321`.

### Cursor / VS Code Setup
In your IDE settings, add a new MCP Server with the following configuration:
*   **Type**: `sse`
*   **URL**: `http://<YOUR_CONTAINER_IP_OR_DOMAIN>:4321/v1/mcp/sse`
*   **Headers**:
    *   `Authorization`: `Bearer orchid_live_your_generated_key_here`

### Claude Desktop Configuration
Add the following configuration block to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "orchid-proxy": {
      "url": "http://<YOUR_CONTAINER_IP_OR_DOMAIN>:4321/v1/mcp/sse",
      "headers": {
        "Authorization": "Bearer orchid_live_your_generated_key_here"
      }
    }
  }
}
```
