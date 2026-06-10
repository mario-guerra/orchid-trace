use crate::context::{Mode, ORCHID_CTX};
use reqwest::{Request, Response, header::HeaderValue};
use reqwest_middleware::{Middleware, Next, Result as MiddlewareResult};
use http::Extensions;
use url::Url;

pub struct OrchidMiddleware {
    proxy_url: Url,
    proxy_key: Option<String>,
    capture_domains: Vec<String>,
    ignore_domains: Vec<String>,
}

impl Default for OrchidMiddleware {
    fn default() -> Self {
        Self::new()
    }
}

impl OrchidMiddleware {
    pub fn new() -> Self {
        let proxy_url_str = std::env::var("ORCHID_PROXY_URL").unwrap_or_else(|_| "http://127.0.0.1:4320/v1".into());
        let proxy_url = Url::parse(&proxy_url_str).expect("Invalid ORCHID_PROXY_URL");
        
        let capture_domains = std::env::var("ORCHID_CAPTURE_DOMAINS")
            .unwrap_or_else(|_| "".into())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
            
        let ignore_domains = std::env::var("ORCHID_IGNORE_DOMAINS")
            .unwrap_or_else(|_| "".into())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        Self {
            proxy_url,
            proxy_key: std::env::var("ORCHID_PROXY_KEY").ok(),
            capture_domains,
            ignore_domains,
        }
    }

    fn should_intercept(&self, host: &str) -> bool {
        // Evaluate ignore list
        if self.ignore_domains.iter().any(|d| host.contains(d)) {
            return false;
        }
        
        // Evaluate wildcard
        if self.capture_domains.iter().any(|d| d == "*") {
            return true;
        }
        
        // Evaluate capture list
        if self.capture_domains.iter().any(|d| host.contains(d)) {
            return true;
        }

        // Default core providers
        let core = ["api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com", "aiplatform.googleapis.com"];
        if core.iter().any(|c| host.contains(c)) {
            return true;
        }

        false
    }
}

#[async_trait::async_trait]
impl Middleware for OrchidMiddleware {
    async fn handle(&self, mut req: Request, extensions: &mut Extensions, next: Next<'_>) -> MiddlewareResult<Response> {
        let original_url = req.url().clone();
        let host = original_url.host_str().unwrap_or("");

        eprintln!("[orchid-sdk] Middleware intercept check: url={} host={} intercept={}", original_url, host, self.should_intercept(host));

        if !self.should_intercept(host) {
            return next.run(req, extensions).await;
        }

        // --- 1. URL Rewrite ---
        // Store the original scheme://host for the X-Orchid-Target-Url header.
        let original_scheme_host = format!("{}://{}", original_url.scheme(), host);
        
        let mut rewritten = original_url.clone();
        if rewritten.set_scheme(self.proxy_url.scheme()).is_err() {
             return next.run(req, extensions).await;
        }
        if rewritten.set_host(self.proxy_url.host_str()).is_err() {
             return next.run(req, extensions).await;
        }
        if let Some(port) = self.proxy_url.port() {
            let _ = rewritten.set_port(Some(port));
        } else {
            let _ = rewritten.set_port(None);
        }
        
        // Path rewriting: match the Python SDK behavior.
        // For core providers (api.openai.com, etc.), the original URL already contains /v1/...
        // and the proxy_url is http://host:4320/v1. We must avoid doubling the /v1 prefix.
        // Strategy: if the original path already starts with the proxy's base path, keep it as-is.
        //           Otherwise, prepend the proxy's base path.
        let proxy_base_path = self.proxy_url.path().trim_end_matches('/');
        let original_path = original_url.path();
        if !proxy_base_path.is_empty() && !original_path.starts_with(proxy_base_path) {
            rewritten.set_path(&format!("{}{}", proxy_base_path, original_path));
        }
        // else: original_path already starts with /v1 (e.g. /v1/chat/completions), keep it.

        *req.url_mut() = rewritten;

        eprintln!("[orchid-sdk] Rewritten URL: {} | X-Orchid-Target-Url: {}", req.url(), original_scheme_host);

        // --- 2. Context Injection (Panic-Safe) ---
        let mut injected_mode = Mode::Passthrough;
        let mut injected_session = None;

        let _ = ORCHID_CTX.try_with(|ctx| {
            injected_mode = ctx.mode.clone();
            injected_session = Some(ctx.session_id.clone());
        });

        if let Ok(hv) = HeaderValue::from_str(&original_scheme_host) {
            req.headers_mut().insert("X-Orchid-Target-Url", hv);
        }
        if let Ok(hv) = HeaderValue::from_str(injected_mode.as_str()) {
            req.headers_mut().insert("X-Orchid-Mode", hv);
        }
        
        if let Some(session_id) = injected_session {
            if let Ok(hv) = HeaderValue::from_str(&session_id) {
                req.headers_mut().insert("X-Orchid-Session-Id", hv);
            }
        }

        if let Some(ref key) = self.proxy_key {
            if let Ok(hv) = HeaderValue::from_str(key) {
                req.headers_mut().insert("X-Orchid-Proxy-Key", hv);
            }
        }

        // Need to clone the request in case we need to fallback
        // We can't clone reqwest::Request completely if it has a streaming body,
        // but typically LLM SDKs don't use streaming bodies for outbound requests.
        // We will fallback by stripping headers from the failed request instance.
        let fallback_req = req.try_clone();

        // --- 3. Execution & Fallback ---
        match next.run(req, extensions).await {
            Ok(resp) => Ok(resp),
            Err(middleware_err) => {
                // If it's a reqwest error and specifically a connection issue
                if let reqwest_middleware::Error::Reqwest(req_err) = &middleware_err {
                    if req_err.is_connect() || req_err.is_timeout() {
                        // Attempt fallback if we were able to clone the request
                        if let Some(mut req_fallback) = fallback_req {
                            // Strip Orchid headers
                            let keys_to_remove: Vec<_> = req_fallback.headers().keys()
                                .filter(|k| k.as_str().starts_with("x-orchid-"))
                                .cloned()
                                .collect();
                            for k in keys_to_remove {
                                req_fallback.headers_mut().remove(k);
                            }
                            
                            // Re-execute directly
                            // reqwest_middleware does not let us easily restart the pipeline cleanly from inside a middleware 
                            // without a recursive Next or using the raw client.
                            // We will use the raw client for the fallback to guarantee we bypass the dead proxy.
                            let client = reqwest::Client::new();
                            match client.execute(req_fallback).await {
                                Ok(resp) => return Ok(resp),
                                Err(e) => return Err(reqwest_middleware::Error::Reqwest(e)),
                            }
                        }
                    }
                }
                Err(middleware_err)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_intercept_core_domains() {
        let middleware = OrchidMiddleware {
            proxy_url: Url::parse("http://127.0.0.1:4320").unwrap(),
            proxy_key: None,
            capture_domains: vec![],
            ignore_domains: vec![],
        };

        assert!(middleware.should_intercept("api.openai.com"));
        assert!(middleware.should_intercept("api.anthropic.com"));
        assert!(middleware.should_intercept("generativelanguage.googleapis.com"));
        assert!(middleware.should_intercept("us-central1-aiplatform.googleapis.com"));
        
        assert!(!middleware.should_intercept("api.github.com"));
    }

    #[test]
    fn test_should_intercept_custom_domains() {
        let middleware = OrchidMiddleware {
            proxy_url: Url::parse("http://127.0.0.1:4320").unwrap(),
            proxy_key: None,
            capture_domains: vec!["my-custom-llm.internal".into()],
            ignore_domains: vec!["ignore.openai.com".into()],
        };

        assert!(middleware.should_intercept("api.openai.com")); // Core still works
        assert!(middleware.should_intercept("my-custom-llm.internal")); // Custom works
        assert!(!middleware.should_intercept("ignore.openai.com")); // Ignore overrides
    }

    #[test]
    fn test_should_intercept_wildcard() {
        let middleware = OrchidMiddleware {
            proxy_url: Url::parse("http://127.0.0.1:4320").unwrap(),
            proxy_key: None,
            capture_domains: vec!["*".into()],
            ignore_domains: vec!["ignored.com".into()],
        };

        assert!(middleware.should_intercept("api.github.com")); // Everything is captured
        assert!(middleware.should_intercept("random-api.com"));
        assert!(!middleware.should_intercept("api.ignored.com")); // Except ignores
    }
}
