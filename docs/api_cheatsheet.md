# Orchid Demo API Cheat Sheet

This cheat sheet provides ready-to-use commands for all Orchid Query API endpoints, pre-configured with the demo API key (`orchid_demo_8675309`). 

*Note for Mac/Linux: All `curl` commands use `--noproxy "*"` to ensure they bypass any local terminal sandboxes and connect directly to the proxy query port (`4321`).*

*Note for Windows: The `Invoke-RestMethod` commands return formatted PowerShell objects by default. We pipe them to `ConvertTo-Json -Depth 10` where `jq` is used on Mac/Linux to ensure you get raw, formatted JSON strings.*

## Session Operations

### List Sessions
**Mac/Linux (curl)**
```bash
curl --noproxy "*" -X GET http://localhost:4321/api/sessions \
  -H "Authorization: Bearer orchid_demo_8675309" | jq
```
**Windows (PowerShell)**
```powershell
Invoke-RestMethod -Uri "http://localhost:4321/api/sessions" `
  -Method GET `
  -Headers @{ "Authorization" = "Bearer orchid_demo_8675309" } | ConvertTo-Json -Depth 10
```

### Get Session Summary
Replace `<session_id>` with your target session.

**Mac/Linux (curl)**
```bash
curl --noproxy "*" -X GET http://localhost:4321/api/sessions/<session_id> \
  -H "Authorization: Bearer orchid_demo_8675309" | jq
```
**Windows (PowerShell)**
```powershell
Invoke-RestMethod -Uri "http://localhost:4321/api/sessions/<session_id>" `
  -Method GET `
  -Headers @{ "Authorization" = "Bearer orchid_demo_8675309" } | ConvertTo-Json -Depth 10
```

### List Session Exchanges
**Mac/Linux (curl)**
```bash
curl --noproxy "*" -X GET http://localhost:4321/api/sessions/<session_id>/exchanges \
  -H "Authorization: Bearer orchid_demo_8675309" | jq
```
**Windows (PowerShell)**
```powershell
Invoke-RestMethod -Uri "http://localhost:4321/api/sessions/<session_id>/exchanges" `
  -Method GET `
  -Headers @{ "Authorization" = "Bearer orchid_demo_8675309" } | ConvertTo-Json -Depth 10
```

### Export Session
**Mac/Linux (curl)**
```bash
curl --noproxy "*" -X GET http://localhost:4321/api/sessions/<session_id>/export \
  -H "Authorization: Bearer orchid_demo_8675309" | jq > exported_session.json
```
**Windows (PowerShell)**
```powershell
Invoke-RestMethod -Uri "http://localhost:4321/api/sessions/<session_id>/export" `
  -Method GET `
  -Headers @{ "Authorization" = "Bearer orchid_demo_8675309" } | ConvertTo-Json -Depth 10 | Out-File "exported_session.json" -Encoding utf8
```

### Import Session
**Mac/Linux (curl)**
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
**Windows (PowerShell)**
```powershell
# Using raw JSON
$body = Get-Content -Raw -Path "fixture.json"
Invoke-RestMethod -Uri "http://localhost:4321/api/sessions/import" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer orchid_demo_8675309" } `
  -ContentType "application/json" `
  -Body $body

# Using multipart/form-data (Requires PowerShell 6.1+)
Invoke-RestMethod -Uri "http://localhost:4321/api/sessions/import" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer orchid_demo_8675309" } `
  -Form @{ file = Get-Item -Path "fixture.json" }
```

## Global Control Plane Overrides

### Get Active Session Override
**Mac/Linux (curl)**
```bash
curl --noproxy "*" -X GET http://localhost:4321/api/sessions/active \
  -H "Authorization: Bearer orchid_demo_8675309" | jq
```
**Windows (PowerShell)**
```powershell
Invoke-RestMethod -Uri "http://localhost:4321/api/sessions/active" `
  -Method GET `
  -Headers @{ "Authorization" = "Bearer orchid_demo_8675309" } | ConvertTo-Json -Depth 10
```

### Set Active Session Override
**Mac/Linux (curl)**
```bash
curl --noproxy "*" -X POST http://localhost:4321/api/sessions/active \
  -H "Authorization: Bearer orchid_demo_8675309" \
  -H "Content-Type: application/json" \
  -d '{"session_id": "demo-override-session", "mode": "capture"}'
```
**Windows (PowerShell)**
```powershell
Invoke-RestMethod -Uri "http://localhost:4321/api/sessions/active" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer orchid_demo_8675309" } `
  -ContentType "application/json" `
  -Body '{"session_id": "demo-override-session", "mode": "capture"}'
```

### Clear Active Session Override
**Mac/Linux (curl)**
```bash
curl --noproxy "*" -X POST http://localhost:4321/api/sessions/clear \
  -H "Authorization: Bearer orchid_demo_8675309"
```
**Windows (PowerShell)**
```powershell
Invoke-RestMethod -Uri "http://localhost:4321/api/sessions/clear" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer orchid_demo_8675309" }
```

## Pricing Configuration

### Get Active Pricing
**Mac/Linux (curl)**
```bash
curl --noproxy "*" -X GET http://localhost:4321/api/pricing \
  -H "Authorization: Bearer orchid_demo_8675309" | jq
```
**Windows (PowerShell)**
```powershell
Invoke-RestMethod -Uri "http://localhost:4321/api/pricing" `
  -Method GET `
  -Headers @{ "Authorization" = "Bearer orchid_demo_8675309" } | ConvertTo-Json -Depth 10
```

### Update Pricing
**Mac/Linux (curl)**
```bash
curl --noproxy "*" -X POST http://localhost:4321/api/pricing \
  -H "Authorization: Bearer orchid_demo_8675309" \
  -H "Content-Type: application/json" \
  -d '{"version":"company-rates-2026-09-06","currency":"USD","providers":{"openai":{"gpt-4o":{"prompt":2.5,"completion":10.0,"cache_read":1.25}}}}'
```
**Windows (PowerShell)**
```powershell
Invoke-RestMethod -Uri "http://localhost:4321/api/pricing" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer orchid_demo_8675309" } `
  -ContentType "application/json" `
  -Body '{"version":"company-rates-2026-09-06","currency":"USD","providers":{"openai":{"gpt-4o":{"prompt":2.5,"completion":10.0,"cache_read":1.25}}}}'
```

### Recompute Pricing
**Mac/Linux (curl)**
```bash
curl --noproxy "*" -X POST http://localhost:4321/api/pricing/recompute \
  -H "Authorization: Bearer orchid_demo_8675309"
```
**Windows (PowerShell)**
```powershell
Invoke-RestMethod -Uri "http://localhost:4321/api/pricing/recompute" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer orchid_demo_8675309" }
```

## Diagnostics & Stats

### Get Global Stats
**Mac/Linux (curl)**
```bash
curl --noproxy "*" -X GET http://localhost:4321/api/stats \
  -H "Authorization: Bearer orchid_demo_8675309" | jq
```
**Windows (PowerShell)**
```powershell
Invoke-RestMethod -Uri "http://localhost:4321/api/stats" `
  -Method GET `
  -Headers @{ "Authorization" = "Bearer orchid_demo_8675309" } | ConvertTo-Json -Depth 10
```

### Check Proxy Health
*(Auth bypasses for health checks, but included here for consistency)*

**Mac/Linux (curl)**
```bash
curl --noproxy "*" -X GET http://localhost:4321/health | jq
```
**Windows (PowerShell)**
```powershell
Invoke-RestMethod -Uri "http://localhost:4321/health" | ConvertTo-Json -Depth 10
```

## Model Context Protocol (MCP)

### Initialize Streamable HTTP Transport
**Mac/Linux (curl)**
```bash
curl --noproxy "*" -X POST http://localhost:4321/api/mcp \
  -H "Authorization: Bearer orchid_demo_8675309" \
  -H "Content-Type: application/json" \
  -H "mcp-protocol-version: 2025-03-26" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}},"id":1}' | jq
```
**Windows (PowerShell)**
```powershell
Invoke-RestMethod -Uri "http://localhost:4321/api/mcp" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer orchid_demo_8675309"; "mcp-protocol-version" = "2025-03-26" } `
  -ContentType "application/json" `
  -Body '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}},"id":1}' | ConvertTo-Json -Depth 10
```

### Terminate Streamable HTTP Session
Replace `<mcp_session_id>` with the ID returned during initialization.

**Mac/Linux (curl)**
```bash
curl --noproxy "*" -X DELETE http://localhost:4321/api/mcp \
  -H "Authorization: Bearer orchid_demo_8675309" \
  -H "mcp-session-id: <mcp_session_id>"
```
**Windows (PowerShell)**
```powershell
Invoke-RestMethod -Uri "http://localhost:4321/api/mcp" `
  -Method DELETE `
  -Headers @{ "Authorization" = "Bearer orchid_demo_8675309"; "mcp-session-id" = "<mcp_session_id>" }
```

### Connect to Remote SSE Channel
**Mac/Linux (curl)**
```bash
curl --noproxy "*" -X GET http://localhost:4321/api/mcp/sse \
  -H "Authorization: Bearer orchid_demo_8675309" \
  -H "Accept: text/event-stream"
```
**Windows (PowerShell)**
*Note: `Invoke-RestMethod` buffers SSE streams. For real-time streaming in PowerShell, you generally need to use .NET `HttpClient` directly.*
```powershell
Invoke-RestMethod -Uri "http://localhost:4321/api/mcp/sse" `
  -Method GET `
  -Headers @{ "Authorization" = "Bearer orchid_demo_8675309"; "Accept" = "text/event-stream" }
```

### Send MCP JSON-RPC Message via SSE
Replace `<connection_id>` with the UUID received from the SSE handshake.

**Mac/Linux (curl)**
```bash
curl --noproxy "*" -X POST "http://localhost:4321/api/mcp/message?connectionId=<connection_id>" \
  -H "Authorization: Bearer orchid_demo_8675309" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"ping","id":2}'
```
**Windows (PowerShell)**
```powershell
Invoke-RestMethod -Uri "http://localhost:4321/api/mcp/message?connectionId=<connection_id>" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer orchid_demo_8675309" } `
  -ContentType "application/json" `
  -Body '{"jsonrpc":"2.0","method":"ping","id":2}'
```
