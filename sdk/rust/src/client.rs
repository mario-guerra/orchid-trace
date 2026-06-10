use crate::error::Error;
use crate::context::Mode;
use std::path::Path;
use serde::Serialize;

#[derive(Serialize)]
struct ExportRequest<'a> {
    session_id: &'a str,
    path: String,
}

#[derive(Serialize)]
struct ImportRequest {
    path: String,
}

#[derive(Serialize)]
struct SetActiveRequest<'a> {
    session_id: &'a str,
    mode: &'a str,
}

pub struct OrchidControlClient {
    client: reqwest::Client,
    query_url: String,
}

impl Default for OrchidControlClient {
    fn default() -> Self {
        Self::new()
    }
}

impl OrchidControlClient {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
            query_url: std::env::var("ORCHID_QUERY_URL").unwrap_or_else(|_| "http://127.0.0.1:4321".into()),
        }
    }

    /// Checks if the Orchid Proxy control plane is responsive.
    pub async fn check_health(&self) -> Result<bool, Error> {
        let resp = self.client.get(&format!("{}/health", self.query_url))
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await?;
        Ok(resp.status().is_success())
    }

    /// Exports a session fixture from the proxy to the local filesystem.
    pub async fn export_fixture(&self, session_id: &str, path: impl AsRef<Path>) -> Result<(), Error> {
        let abs_path = std::fs::canonicalize(&path)
            .or_else(|_| std::env::current_dir().map(|cwd| cwd.join(path)))?;
            
        let req = ExportRequest {
            session_id,
            path: abs_path.to_string_lossy().to_string(),
        };

        let resp = self.client.post(&format!("{}/api/sessions/export", self.query_url))
            .json(&req)
            .send()
            .await?;

        if !resp.status().is_success() {
            return Err(Error::ProxyApiError {
                status: resp.status().as_u16(),
                message: resp.text().await.unwrap_or_default(),
            });
        }
        Ok(())
    }

    /// Imports a session fixture from the local filesystem into the proxy.
    pub async fn import_fixture(&self, path: impl AsRef<Path>) -> Result<(), Error> {
        let abs_path = std::fs::canonicalize(path)?;
        let req = ImportRequest {
            path: abs_path.to_string_lossy().to_string(),
        };

        let resp = self.client.post(&format!("{}/api/sessions/import", self.query_url))
            .json(&req)
            .send()
            .await?;

        if !resp.status().is_success() {
            return Err(Error::ProxyApiError {
                status: resp.status().as_u16(),
                message: resp.text().await.unwrap_or_default(),
            });
        }
        Ok(())
    }

    /// Sets a global active session override in the proxy.
    pub async fn set_active_session(&self, session_id: &str, mode: Mode) -> Result<(), Error> {
        let req = SetActiveRequest {
            session_id,
            mode: mode.as_str(),
        };

        let resp = self.client.post(&format!("{}/api/sessions/active", self.query_url))
            .json(&req)
            .send()
            .await?;

        if !resp.status().is_success() {
            return Err(Error::ProxyApiError {
                status: resp.status().as_u16(),
                message: resp.text().await.unwrap_or_default(),
            });
        }
        Ok(())
    }

    /// Clears the global active session override in the proxy.
    pub async fn clear_active_session(&self) -> Result<(), Error> {
        let resp = self.client.delete(&format!("{}/api/sessions/active", self.query_url))
            .send()
            .await?;

        if !resp.status().is_success() {
            return Err(Error::ProxyApiError {
                status: resp.status().as_u16(),
                message: resp.text().await.unwrap_or_default(),
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_initialization() {
        // Just verify it doesn't panic
        let client = OrchidControlClient::new();
        assert_eq!(client.query_url, "http://127.0.0.1:4321"); // Assuming default
    }

    #[tokio::test]
    async fn test_invalid_path_resolution() {
        let client = OrchidControlClient::new();
        // Passing a path that doesn't exist to `import` should fail canonicalization BEFORE network call
        let result = client.import_fixture("/path/that/definitely/does/not/exist.json").await;
        
        match result {
            Err(Error::PathResolution(_)) => {} // Expected
            _ => panic!("Expected PathResolution error"),
        }
    }
}
