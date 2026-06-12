# Orchid Rust SDK (`orchid-sdk`)

**[Visit the public website: orchidtrace.xyz](https://orchidtrace.xyz)**

The `orchid-sdk` provides a low-friction, idiomatic integration for routing outbound LLM requests through the [Orchid](https://orchid.dev) proxy. It uses the `reqwest-middleware` pattern to intercept, rewrite, and securely decorate HTTP requests with Orchid's control headers, eliminating the need for unsafe monkey-patching or complex network overrides.

## Features

- **Dynamic Interception:** Automatically intercepts traffic to core LLM providers (`api.openai.com`, `api.anthropic.com`, etc.) or custom domains configured via `ORCHID_CAPTURE_DOMAINS`.
- **Concurrency Safe Context:** Uses `tokio::task_local!` to propagate session tracking without leaking state across concurrent asynchronous tasks.
- **Resilient Fallback:** If the Orchid proxy is offline, the middleware automatically strips injected headers and routes the request directly to the upstream provider to prevent failure.
- **Control Plane API:** Includes an `OrchidControlClient` to interface seamlessly with the proxy's management port (`4321`) for global session overrides and fixture management.

## Installation

Add the following to your `Cargo.toml`:

```toml
[dependencies]
orchid-sdk = { path = "path/to/orchid-sdk" }
reqwest = "0.12"
reqwest-middleware = "0.3"
```

## Quick Start: `async-openai` Integration

The easiest way to use the SDK is to wrap your `reqwest::Client` with `OrchidMiddleware` and pass it to your LLM provider's client.

```rust
use async_openai::{Client, config::OpenAIConfig};
use reqwest_middleware::ClientBuilder;
use orchid_sdk::{OrchidMiddleware, OrchidContext, Mode, scope};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Build a reqwest client equipped with Orchid Middleware
    let reqwest_client = reqwest::Client::new();
    let client_with_middleware = ClientBuilder::new(reqwest_client)
        .with(OrchidMiddleware::new())
        .build();

    // 2. Configure the LLM SDK to use your custom HTTP client
    let config = OpenAIConfig::new().with_api_key("sk-...");
    let openai_client = Client::with_config(config)
        .with_http_client(client_with_middleware);

    // 3. Define the context you want for this execution block
    let ctx = OrchidContext {
        session_id: "my-test-session-123".to_string(),
        mode: Mode::Capture,
    };

    // 4. Wrap your application logic inside an Orchid scope.
    // Any requests made by `openai_client` inside this block are intercepted.
    scope(ctx, async {
        let request = async_openai::types::CreateChatCompletionRequestArgs::default()
            .model("gpt-4o")
            .messages([
                async_openai::types::ChatCompletionRequestUserMessageArgs::default()
                    .content("Hello Orchid!")
                    .build()?
                    .into()
            ])
            .build()?;

        let response = openai_client.chat().create(request).await?;
        println!("Response: {:?}", response);
        Ok::<(), Box<dyn std::error::Error>>(())
    }).await?;

    Ok(())
}
```

## Quick Start: `genai` Integration

The `genai` crate supports customizing the underlying HTTP client. You can inject the Orchid middleware to route all multi-model traffic through the proxy.

```rust
use genai::{Client, config::ClientConfig};
use reqwest_middleware::ClientBuilder;
use orchid_sdk::{OrchidMiddleware, OrchidContext, Mode, scope};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let reqwest_client = reqwest::Client::new();
    let client_with_middleware = ClientBuilder::new(reqwest_client)
        .with(OrchidMiddleware::new())
        .build();

    // GenAI allows setting a custom reqwest-middleware client
    let genai_client = Client::builder()
        .with_http_client(client_with_middleware)
        .build();

    let ctx = OrchidContext { session_id: "multi-model-session".into(), mode: Mode::Capture };

    scope(ctx, async {
        let response = genai_client.exec_chat("anthropic:claude-3-opus-20240229", vec![
            genai::chat::Message::user("Why is Rust so fast?")
        ]).await?;
        println!("Claude Response: {:?}", response);
        Ok::<(), Box<dyn std::error::Error>>(())
    }).await?;

    Ok(())
}
```

## Quick Start: Anthropic (`anthropic-sdk-rust`)

Any Rust SDK that allows you to provide a custom `reqwest` or `reqwest-middleware` client is automatically supported.

```rust
use anthropic::client::Client;
use reqwest_middleware::ClientBuilder;
use orchid_sdk::{OrchidMiddleware, OrchidContext, Mode, scope};

// Setup middleware
let client_with_middleware = ClientBuilder::new(reqwest::Client::new())
    .with(OrchidMiddleware::new())
    .build();

// Pass to Anthropic
let anthropic_client = Client::builder()
    .with_api_key("sk-ant-...")
    .with_http_client(client_with_middleware)
    .build()?;
```

## Configuration

The `OrchidMiddleware` reads the following environment variables upon initialization:

| Variable | Default | Description |
|---|---|---|
| `ORCHID_PROXY_URL` | `http://127.0.0.1:4320/v1` | The target proxy URL to rewrite intercepted traffic to. |
| `ORCHID_QUERY_URL` | `http://127.0.0.1:4321` | The proxy management port for the `OrchidControlClient`. |
| `ORCHID_CAPTURE_DOMAINS` | (Core Providers) | Comma-separated domains to intercept. Use `*` to catch everything. |
| `ORCHID_IGNORE_DOMAINS` | "" | Comma-separated domains to strictly ignore. |
| `ORCHID_PROXY_KEY` | None | Optional proxy authentication key. |

## Managing Global Sessions

For end-to-end tests where you cannot inject `tokio::task_local!` context (e.g., black-box testing), you can use the `OrchidControlClient` to set a global active session.

```rust
use orchid_sdk::{OrchidControlClient, Mode};

#[tokio::test]
async fn test_global_override() {
    let client = OrchidControlClient::new();
    
    // Force the proxy to record all traffic into "e2e-session-1"
    client.set_active_session("e2e-session-1", Mode::Capture).await.unwrap();

    // ... run standard tests ...

    client.clear_active_session().await.unwrap();
}
```
