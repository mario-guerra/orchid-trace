# Rust Integration Guide

Orchid does not require a dedicated SDK to work with Rust applications. Because Rust compiles to static machine code and does not support runtime monkeypatching, routing your traffic through Orchid is done natively using standard, open-source HTTP client middleware (`reqwest-middleware`).

This guide provides a complete, copy-pasteable recipe to write your own Orchid integration in Rust.

---

## 1. Project Setup

Add the following crates to your `Cargo.toml`:

```toml
[dependencies]
reqwest = { version = "0.12", default-features = false, features = ["rustls", "json"] }
reqwest-middleware = "0.3"
async-trait = "0.1"
tokio = { version = "1.0", features = ["full"] }
url = "2.5"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
```

---

## 2. Implementing the Middleware

Create a file named `orchid_middleware.rs` (or add it directly to your source tree). This custom middleware handles URL rewriting, header injection (propagating session ID and mode), and automatically falls back to direct connection if the Orchid proxy is down:

```rust
use async_trait::async_trait;
use reqwest::{Request, Response, header::HeaderValue};
use reqwest_middleware::{Middleware, Next, Result as MiddlewareResult};
use task_local_extensions::Extensions;
use url::Url;

// Task-local storage to pass the session ID and mode through your application.
tokio::task_local! {
    pub static ORCHID_CTX: OrchidContext;
}

#[derive(Clone, Debug)]
pub struct OrchidContext {
    pub session_id: String,
    pub mode: String, // "capture", "replay", or "passthrough"
}

pub struct OrchidMiddleware {
    proxy_url: Url,
    proxy_key: Option<String>,
}

impl Default for OrchidMiddleware {
    fn default() -> Self {
        let proxy_url_str = std::env::var("ORCHID_PROXY_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:4320/v1".to_string());
        let proxy_url = Url::parse(&proxy_url_str).expect("Invalid ORCHID_PROXY_URL");
        let proxy_key = std::env::var("ORCHID_PROXY_KEY").ok();
        Self { proxy_url, proxy_key }
    }
}

impl OrchidMiddleware {
    fn should_intercept(&self, host: &str) -> bool {
        // Safe list: never proxy localhost loopbacks
        if host == "localhost" || host == "127.0.0.1" || host == "::1" {
            return false;
        }

        // Evaluate ignore list
        if let Ok(ignore) = std::env::var("ORCHID_IGNORE_DOMAINS") {
            if ignore.split(',').any(|d| !d.trim().is_empty() && host.contains(d.trim())) {
                return false;
            }
        }

        // Evaluate capture list/wildcard
        if let Ok(capture) = std::env::var("ORCHID_CAPTURE_DOMAINS") {
            if capture.split(',').any(|d| d.trim() == "*") {
                return true;
            }
            if capture.split(',').any(|d| !d.trim().is_empty() && host.contains(d.trim())) {
                return true;
            }
        }

        // Default intercept: standard LLM providers
        let providers = [
            "api.openai.com",
            "api.anthropic.com",
            "generativelanguage.googleapis.com",
            "aiplatform.googleapis.com",
        ];
        providers.iter().any(|p| host.contains(p))
    }
}

#[async_trait]
impl Middleware for OrchidMiddleware {
    async fn handle(
        &self,
        mut req: Request,
        extensions: &mut Extensions,
        next: Next<'_>,
    ) -> MiddlewareResult<Response> {
        let original_url = req.url().clone();
        let host = original_url.host_str().unwrap_or("");

        if !self.should_intercept(host) {
            return next.run(req, extensions).await;
        }

        // --- 1. Rewrite URL ---
        let mut rewritten = original_url.clone();
        let _ = rewritten.set_scheme(self.proxy_url.scheme());
        let _ = rewritten.set_host(self.proxy_url.host_str());
        let _ = rewritten.set_port(self.proxy_url.port());

        // Avoid doubling base path (e.g. /v1) if the proxy base path is set
        let proxy_base = self.proxy_url.path().trim_end_matches('/');
        let original_path = original_url.path();
        if !proxy_base.is_empty() && !original_path.starts_with(proxy_base) {
            rewritten.set_path(&format!("{}{}", proxy_base, original_path));
        }
        *req.url_mut() = rewritten;

        // --- 2. Inject Headers ---
        let original_target = format!("{}://{}", original_url.scheme(), host);
        if let Ok(hv) = HeaderValue::from_str(&original_target) {
            req.headers_mut().insert("X-Orchid-Target-Url", hv);
        }

        // Extract context properties with env var fallbacks
        let mut session_id = None;
        let mut mode = None;

        let _ = ORCHID_CTX.try_with(|ctx| {
            session_id = Some(ctx.session_id.clone());
            mode = Some(ctx.mode.clone());
        });

        let resolved_session = session_id.or_else(|| std::env::var("ORCHID_SESSION_ID").ok());
        let mut resolved_mode = mode.or_else(|| std::env::var("ORCHID_MODE").ok());
        if resolved_session.is_some() && resolved_mode.is_none() {
            resolved_mode = Some("capture".to_string());
        }

        if let Some(s) = resolved_session {
            if let Ok(hv) = HeaderValue::from_str(&s) {
                req.headers_mut().insert("X-Orchid-Session-Id", hv);
            }
        }
        if let Some(m) = resolved_mode {
            if let Ok(hv) = HeaderValue::from_str(&m) {
                req.headers_mut().insert("X-Orchid-Mode", hv);
            }
        }
        if let Some(ref key) = self.proxy_key {
            if let Ok(hv) = HeaderValue::from_str(key) {
                req.headers_mut().insert("X-Orchid-Proxy-Key", hv);
            }
        }

        // Keep a clone for fallback in case the proxy server is offline
        let fallback_req = req.try_clone();

        match next.run(req, extensions).await {
            Ok(resp) => Ok(resp),
            Err(e) => {
                // If it is a connection error, fall back to direct routing
                if let Some(mut req_fallback) = fallback_req {
                    eprintln!("[orchid] Proxy connection failed. Falling back to direct routing: {}", original_url);
                    *req_fallback.url_mut() = original_url;
                    
                    // Strip internal X-Orchid headers
                    let keys: Vec<_> = req_fallback.headers().keys()
                        .filter(|k| k.as_str().starts_with("x-orchid-"))
                        .cloned()
                        .collect();
                    for k in keys {
                        req_fallback.headers_mut().remove(k);
                    }

                    // Execute request directly bypassing the proxy
                    let direct_client = reqwest::Client::new();
                    match direct_client.execute(req_fallback).await {
                        Ok(resp) => return Ok(resp),
                        Err(direct_err) => return Err(reqwest_middleware::Error::Reqwest(direct_err)),
                    }
                }
                Err(e)
            }
        }
    }
}
```

---

## 3. Registering the Middleware

Register `OrchidMiddleware` in your `reqwest` client stack using `reqwest-middleware`:

```rust
use reqwest_middleware::ClientBuilder;

let reqwest_client = reqwest::Client::new();
let client = ClientBuilder::new(reqwest_client)
    .with(OrchidMiddleware::default())
    .build();
```

Use `client` to make your LLM calls. If your LLM SDK (like `async-openai`) allows specifying a custom HTTP client, pass this wrapped client to it.

---

## 4. Writing Replay Tests

To run integration tests completely offline with local JSON fixtures, implement this simple asynchronous helper in your test suite:

```rust
use std::path::Path;

/// Simple control client to interact with the Orchid Proxy query server.
pub struct OrchidControlClient {
    client: reqwest::Client,
    query_url: String,
    api_key: Option<String>,
}

impl Default for OrchidControlClient {
    fn default() -> Self {
        let query_url = std::env::var("ORCHID_QUERY_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:4321".to_string());
        let api_key = std::env::var("ORCHID_API_KEY").ok();
        Self {
            client: reqwest::Client::new(),
            query_url,
            api_key,
        }
    }
}

impl OrchidControlClient {
    fn headers(&self) -> reqwest::header::HeaderMap {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Some(ref key) = self.api_key {
            headers.insert("X-Orchid-Api-Key", reqwest::header::HeaderValue::from_str(key).unwrap());
        }
        headers
    }

    /// Import fixture file content directly into the proxy
    pub async fn import_fixture(&self, path: &Path) -> Result<(), Box<dyn std::error::Error>> {
        let file_content = std::fs::read_to_string(path)?;
        let resp = self.client.post(&format!("{}/v1/sessions/import", self.query_url))
            .headers(self.headers())
            .header("Content-Type", "application/json")
            .body(file_content)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(format!("Import failed: {}", resp.status()).into());
        }
        Ok(())
    }

    /// Export fixture from proxy to local path
    pub async fn export_fixture(&self, session_id: &str, path: &Path) -> Result<(), Box<dyn std::error::Error>> {
        let resp = self.client.get(&format!("{}/v1/sessions/{}/export", self.query_url, session_id))
            .headers(self.headers())
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(format!("Export failed: {}", resp.status()).into());
        }
        let payload = resp.text().await?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, payload)?;
        Ok(())
    }
}

/// Helper function to retrieve the recorded session ID from an existing fixture.
fn get_fixture_session_id(path: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(path).ok()?;
    let val: serde_json::Value = serde_json::from_str(&raw).ok()?;
    val.get("session")?.get("id")?.as_str().map(|s| s.to_string())
}

/// Deterministic test wrapper to manage capture/replay fixture life-cycle.
/// Panics if importing or exporting proxy configurations fails.
pub async fn with_replay<P, F, Fut, T>(
    fixture_path: P,
    session_id_override: Option<&str>,
    run_test: F,
) -> T
where
    P: AsRef<Path>,
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = T>,
{
    let path = fixture_path.as_ref();
    let client = OrchidControlClient::default();

    let resolved_session = match session_id_override {
        Some(s) => s.to_string(),
        None => get_fixture_session_id(path).unwrap_or_else(|| {
            path.file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "test_session".to_string())
        }),
    };

    let rec_env = std::env::var("ORCHID_RECORD").unwrap_or_default().to_lowercase();
    let is_record = rec_env == "1" || rec_env == "true" || rec_env == "yes";

    if is_record {
        // Run live test under ORCHID_CTX
        let ctx = OrchidContext {
            session_id: resolved_session.clone(),
            mode: "capture".to_string(),
        };
        let result = ORCHID_CTX.scope(ctx, run_test()).await;

        // Sleep to let async chunks flush in the proxy database
        let sleep_sec = std::env::var("ORCHID_FLUSH_SLEEP")
            .ok()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.2);
        if sleep_sec > 0.0 {
            tokio::time::sleep(tokio::time::Duration::from_secs_f64(sleep_sec)).await;
        }

        // Export session traffic
        client.export_fixture(&resolved_session, path).await.expect("Failed to export fixture");
        result
    } else {
        // Replay mode: Import fixture mock data first
        assert!(path.exists(), "Fixture file not found: {}", path.display());
        client.import_fixture(path).await.expect("Failed to import fixture mock data");

        let ctx = OrchidContext {
            session_id: resolved_session,
            mode: "replay".to_string(),
        };
        ORCHID_CTX.scope(ctx, run_test()).await
    }
}
```

### Usage in a Test Case:

```rust
#[tokio::test]
async fn test_openai_interaction() {
    with_replay("tests/fixtures/test_openai.json", None, || async {
        let client = ClientBuilder::new(reqwest::Client::new())
            .with(OrchidMiddleware::default())
            .build();

        let response = client.post("https://api.openai.com/v1/chat/completions")
            .json(&serde_json::json!({
                "model": "gpt-4o",
                "messages": [{"role": "user", "content": "ping"}]
            }))
            .send()
            .await
            .unwrap();

        assert_eq!(response.status(), 200);
    }).await;
}
```
