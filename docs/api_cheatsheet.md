# Orchid Demo API Cheat Sheet

This cheat sheet provides ready-to-use `curl` commands for all Orchid Query API endpoints, pre-configured with the demo API key (`orchid_demo_8675309`). 

*Note: All commands use `--noproxy "*"` to ensure they bypass any local terminal sandboxes and connect directly to the proxy query port (`4321`).*

## Session Operations

### List Sessions
```bash
curl --noproxy "*" -X GET http://localhost:4321/api/sessions \
  -H "Authorization: Bearer orchid_demo_8675309" | jq
```

### Get Session Summary
Replace `<session_id>` with your target session.
```bash
curl --noproxy "*" -X GET http://localhost:4321/api/sessions/<session_id> \
  -H "Authorization: Bearer orchid_demo_8675309" | jq
```

### List Session Exchanges
```bash
curl --noproxy "*" -X GET http://localhost:4321/api/sessions/<session_id>/exchanges \
  -H "Authorization: Bearer orchid_demo_8675309" | jq
```

### Export Session
```bash
curl --noproxy "*" -X GET http://localhost:4321/api/sessions/<session_id>/export \
  -H "Authorization: Bearer orchid_demo_8675309" | jq > exported_session.json
```

### Import Session
```bash
# Using raw JSON
curl --noproxy "*" -X POST http://localhost:4321/api/sessions/import \
  -H "Authorization: Bearer orchid_demo_8675309" \
  -H "Content-Type: application/json" \
  -d @fixture.json

# Using multipart/form-data
curl --noproxy "*" -X POST http://localhost:4321/api/sessions/import \
  -H "Authorization: Bearer orchid_demo_8675309" \
  -F "file=@fixture.json"
```

## Global Control Plane Overrides

### Get Active Session Override
```bash
curl --noproxy "*" -X GET http://localhost:4321/api/sessions/active \
  -H "Authorization: Bearer orchid_demo_8675309" | jq
```

### Set Active Session Override
```bash
curl --noproxy "*" -X POST http://localhost:4321/api/sessions/active \
  -H "Authorization: Bearer orchid_demo_8675309" \
  -H "Content-Type: application/json" \
  -d '{"session_id": "demo-override-session", "mode": "capture"}'
```

### Clear Active Session Override
```bash
curl --noproxy "*" -X POST http://localhost:4321/api/sessions/clear \
  -H "Authorization: Bearer orchid_demo_8675309"
```

## Pricing Configuration

### Get Active Pricing
```bash
curl --noproxy "*" -X GET http://localhost:4321/api/pricing \
  -H "Authorization: Bearer orchid_demo_8675309" | jq
```

### Update Pricing
```bash
curl --noproxy "*" -X POST http://localhost:4321/api/pricing \
  -H "Authorization: Bearer orchid_demo_8675309" \
  -H "Content-Type: application/json" \
  -d '{"openai": {"gpt-4o": {"prompt": 5.0, "completion": 15.0}}}'
```

### Recompute Pricing
```bash
curl --noproxy "*" -X POST http://localhost:4321/api/pricing/recompute \
  -H "Authorization: Bearer orchid_demo_8675309"
```

## Diagnostics & Stats

### Get Global Stats
```bash
curl --noproxy "*" -X GET http://localhost:4321/api/stats \
  -H "Authorization: Bearer orchid_demo_8675309" | jq
```

### Check Proxy Health
*(Auth bypasses for health checks, but included here for consistency)*
```bash
curl --noproxy "*" -X GET http://localhost:4321/health | jq
```

## Model Context Protocol (MCP)

### Initialize Streamable HTTP Transport
```bash
curl --noproxy "*" -X POST http://localhost:4321/api/mcp \
  -H "Authorization: Bearer orchid_demo_8675309" \
  -H "Content-Type: application/json" \
  -H "mcp-protocol-version: 2025-03-26" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}},"id":1}' | jq
```

### Terminate Streamable HTTP Session
Replace `<mcp_session_id>` with the ID returned during initialization.
```bash
curl --noproxy "*" -X DELETE http://localhost:4321/api/mcp \
  -H "Authorization: Bearer orchid_demo_8675309" \
  -H "mcp-session-id: <mcp_session_id>"
```

### Connect to Remote SSE Channel
```bash
curl --noproxy "*" -X GET http://localhost:4321/api/mcp/sse \
  -H "Authorization: Bearer orchid_demo_8675309" \
  -H "Accept: text/event-stream"
```

### Send MCP JSON-RPC Message via SSE
Replace `<connection_id>` with the UUID received from the SSE handshake.
```bash
curl --noproxy "*" -X POST "http://localhost:4321/api/mcp/message?connectionId=<connection_id>" \
  -H "Authorization: Bearer orchid_demo_8675309" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"ping","id":2}'
```
