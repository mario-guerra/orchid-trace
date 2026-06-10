use std::future::Future;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Mode {
    Capture,
    Replay,
    Passthrough,
}

impl Mode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Mode::Capture => "capture",
            Mode::Replay => "replay",
            Mode::Passthrough => "passthrough",
        }
    }
}

#[derive(Clone, Debug)]
pub struct OrchidContext {
    pub session_id: String,
    pub mode: Mode,
}

tokio::task_local! {
    pub(crate) static ORCHID_CTX: OrchidContext;
}

/// Run an asynchronous task within an Orchid context.
/// Any requests intercepted by `OrchidMiddleware` within this future
/// will automatically be tagged with this context.
pub async fn scope<F: Future>(ctx: OrchidContext, f: F) -> F::Output {
    ORCHID_CTX.scope(ctx, f).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_context_scoping() {
        let ctx = OrchidContext {
            session_id: "test-session-123".into(),
            mode: Mode::Capture,
        };

        let result = scope(ctx, async {
            let inner_session = ORCHID_CTX.try_with(|c| c.session_id.clone()).unwrap();
            let inner_mode = ORCHID_CTX.try_with(|c| c.mode.clone()).unwrap();
            (inner_session, inner_mode)
        }).await;

        assert_eq!(result.0, "test-session-123");
        assert_eq!(result.1, Mode::Capture);
    }

    #[tokio::test]
    async fn test_context_isolation() {
        let ctx1 = OrchidContext { session_id: "session-1".into(), mode: Mode::Capture };
        let ctx2 = OrchidContext { session_id: "session-2".into(), mode: Mode::Replay };

        let t1 = tokio::spawn(scope(ctx1, async {
            ORCHID_CTX.try_with(|c| c.session_id.clone()).unwrap()
        }));

        let t2 = tokio::spawn(scope(ctx2, async {
            ORCHID_CTX.try_with(|c| c.session_id.clone()).unwrap()
        }));

        assert_eq!(t1.await.unwrap(), "session-1");
        assert_eq!(t2.await.unwrap(), "session-2");
    }

    #[tokio::test]
    async fn test_out_of_scope() {
        // Accessing outside of scope should safely return an Error, not panic.
        let result = ORCHID_CTX.try_with(|c| c.session_id.clone());
        assert!(result.is_err());
    }
}
