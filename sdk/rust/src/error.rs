use thiserror::Error;

/// Core error type for the Orchid SDK.
#[derive(Debug, Error)]
pub enum Error {
    #[error("Orchid Proxy is unreachable: {0}")]
    ProxyOffline(String),

    #[error("HTTP Request failed: {0}")]
    RequestFailed(#[from] reqwest::Error),

    #[error("Failed to resolve absolute path: {0}")]
    PathResolution(#[from] std::io::Error),

    #[error("Proxy returned error {status}: {message}")]
    ProxyApiError { status: u16, message: String },

    #[error("Invalid Header Value: {0}")]
    InvalidHeader(#[from] reqwest::header::InvalidHeaderValue),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = Error::ProxyOffline("Connection refused".to_string());
        assert_eq!(err.to_string(), "Orchid Proxy is unreachable: Connection refused");

        let err = Error::ProxyApiError {
            status: 404,
            message: "Session not found".to_string(),
        };
        assert_eq!(err.to_string(), "Proxy returned error 404: Session not found");
    }
}
