# Using Orchid From Any Language (No SDK Required)

Orchid ships SDKs for Python, TypeScript, and Rust — but you don't need one. The proxy is entirely **header-driven**: any HTTP client in any language (Go, Java, Ruby, C#, Elixir, shell scripts...) can capture and replay traffic by doing two things:

1. **Point the request at the proxy** instead of the upstream API.
2. **Add a few `X-Orchid-*` headers** to control recording.

That's the whole integration. Your provider API key stays in the `Authorization` header exactly as before — the proxy forwards it untouched to the upstream and never stores it.

---

## The Headers

| Header | Required | Purpose |
| :--- | :--- | :--- |
| `X-Orchid-Proxy-Key` | If the proxy has `ORCHID_API_KEY` set | Authenticates your app to the proxy. |
| `X-Orchid-Session-Id` | Recommended | Groups exchanges under a session (e.g. `checkout-flow-test-1`). Defaults to `default-session`. |
| `X-Orchid-Mode` | Recommended | `capture` (record), `replay` (serve recorded responses, no upstream call), `log` (metadata only), or `passthrough` (default — no recording). |
| `X-Orchid-Target-Url` | For non-LLM APIs | Upstream base URL (scheme + host) for generic API capture. See below. |

Optional trace-organization tags, recorded alongside each exchange: `X-Orchid-Stage`, `X-Orchid-Step`, `X-Orchid-Job-Id`, `X-Orchid-Service`.

All `X-Orchid-*` headers (and `Authorization`) are stripped before the request is stored, so they never appear in recorded payloads.

## The Two Routing Patterns

**1. LLM providers — just change the base URL.** The proxy recognizes provider API shapes by path and routes them upstream automatically:

| Provider | Original base URL | Proxied base URL |
| :--- | :--- | :--- |
| OpenAI | `https://api.openai.com/v1` | `http://localhost:4320/v1` |
| Anthropic | `https://api.anthropic.com` | `http://localhost:4320` |

**2. Any other API — add `X-Orchid-Target-Url`.** Send the request to the proxy with the original path, and tell the proxy where it was headed:

```
GET http://localhost:4320/search?q=weather
X-Orchid-Target-Url: https://serpapi.com
```

---

## curl

```bash
# An OpenAI call, captured under session "manual-test-1"
curl http://localhost:4320/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Orchid-Proxy-Key: $ORCHID_PROXY_KEY" \
  -H "X-Orchid-Session-Id: manual-test-1" \
  -H "X-Orchid-Mode: capture" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "Hello!"}]}'
```

Replay the same call offline — identical request, one header changed:

```bash
curl http://localhost:4320/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Orchid-Proxy-Key: $ORCHID_PROXY_KEY" \
  -H "X-Orchid-Session-Id: manual-test-1" \
  -H "X-Orchid-Mode: replay" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "Hello!"}]}'
```

In replay mode the proxy matches the request by a semantic hash of the prompt and serves the recorded response — no upstream call, no API cost.

## Go

Most Go LLM clients accept a base URL override. For everything else, a custom `http.RoundTripper` adds the headers globally — the idiomatic Go equivalent of what the Orchid SDKs do:

```go
type orchidTransport struct{ base http.RoundTripper }

func (t *orchidTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req.Header.Set("X-Orchid-Proxy-Key", os.Getenv("ORCHID_PROXY_KEY"))
	req.Header.Set("X-Orchid-Session-Id", os.Getenv("ORCHID_SESSION_ID"))
	req.Header.Set("X-Orchid-Mode", os.Getenv("ORCHID_MODE"))
	return t.base.RoundTrip(req)
}

client := openai.NewClient(
	option.WithBaseURL("http://localhost:4320/v1"),
	option.WithHTTPClient(&http.Client{Transport: &orchidTransport{base: http.DefaultTransport}}),
)
```

## Java

The official OpenAI Java SDK (and Spring AI, LangChain4j, etc.) supports base URL and header configuration:

```java
OpenAIClient client = OpenAIOkHttpClient.builder()
    .baseUrl("http://localhost:4320/v1")
    .putHeader("X-Orchid-Proxy-Key", System.getenv("ORCHID_PROXY_KEY"))
    .putHeader("X-Orchid-Session-Id", "my-session")
    .putHeader("X-Orchid-Mode", "capture")
    .apiKey(System.getenv("OPENAI_API_KEY"))
    .build();
```

## Anything Else

The pattern is always the same regardless of language:

1. Set the client's base URL to the proxy (`http://localhost:4320/v1` for OpenAI-compatible clients).
2. Attach the `X-Orchid-*` headers — most HTTP stacks have a default-headers or interceptor/middleware hook.
3. Keep your real provider API key in `Authorization` as usual.

If your client offers no header hooks at all, you can set a **global session override** on the proxy's control API instead, so plain base-URL redirection is enough — see the Query & Control API in [deploy_and_setup.md](./deploy_and_setup.md).

---

## Inspecting and Exporting Sessions

Everything recorded is available in the Visualizer UI at `http://localhost:4321` and via the control API (authenticate with `X-Orchid-Api-Key` or `Authorization: Bearer`):

```bash
# Health check
curl http://localhost:4321/health

# Export a session to a JSON fixture (for replay in CI, sharing, etc.)
curl -H "X-Orchid-Api-Key: $ORCHID_API_KEY" \
  http://localhost:4321/v1/sessions/manual-test-1/export > fixture.json

# Import a fixture back into a proxy (e.g. in CI before a replay run)
curl -X POST -H "X-Orchid-Api-Key: $ORCHID_API_KEY" \
  -H "Content-Type: application/json" \
  --data @fixture.json \
  http://localhost:4321/v1/sessions/import
```

This export → commit fixture → `X-Orchid-Mode: replay` in CI loop gives you deterministic, zero-API-cost integration tests in any language — the same workflow the Python `@replay` decorator and TypeScript `withReplay()` helper automate.
