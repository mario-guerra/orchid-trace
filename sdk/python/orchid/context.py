import contextvars

# Context variables for the Thin SDK architecture.
# These will be utilized by transport hooks in SDK-02.
orchid_session_id = contextvars.ContextVar("orchid_session_id", default=None)
orchid_mode = contextvars.ContextVar("orchid_mode", default=None)
