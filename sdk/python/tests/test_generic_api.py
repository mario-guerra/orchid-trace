import os
import pytest
import urllib.parse
from orchid.core import init, session, _should_intercept

def test_should_intercept_wildcard(monkeypatch):
    monkeypatch.setenv("ORCHID_CAPTURE_DOMAINS", "*")
    monkeypatch.delenv("ORCHID_IGNORE_DOMAINS", raising=False)
    
    # Verify standard third party domains are intercepted
    assert _should_intercept(urllib.parse.urlparse("https://api.serpapi.com/search")) is True
    assert _should_intercept(urllib.parse.urlparse("https://example.com/api")) is True
    
    # Verify loopback addresses are explicitly excluded
    assert _should_intercept(urllib.parse.urlparse("http://localhost:8080/")) is False
    assert _should_intercept(urllib.parse.urlparse("http://127.0.0.1:4321/health")) is False
    assert _should_intercept(urllib.parse.urlparse("http://::1/path")) is False

def test_should_intercept_ignore_list(monkeypatch):
    monkeypatch.setenv("ORCHID_CAPTURE_DOMAINS", "*")
    monkeypatch.setenv("ORCHID_IGNORE_DOMAINS", "telemetry.com, logs.net")
    
    # Verify non-ignored domains are captured
    assert _should_intercept(urllib.parse.urlparse("https://api.serpapi.com/search")) is True
    
    # Verify ignored domains are skipped
    assert _should_intercept(urllib.parse.urlparse("https://telemetry.com/v1/event")) is False
    assert _should_intercept(urllib.parse.urlparse("http://sub.logs.net/collect")) is False

def test_requests_wildcard_rewriting(monkeypatch):
    import requests
    import orchid.core
    
    monkeypatch.setenv("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
    monkeypatch.setenv("ORCHID_CAPTURE_DOMAINS", "*")
    monkeypatch.delenv("ORCHID_IGNORE_DOMAINS", raising=False)
    
    # Enable patching
    monkeypatch.setattr(orchid.core, "_patched", False)
    monkeypatch.setattr(orchid.core, "_offline_fallback", False)
    
    # Mock healthcheck to succeed
    class DummyResponse:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *args): pass
    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **kw: DummyResponse())
    
    init()
    
    captured_args = []
    captured_kwargs = []
    
    def dummy_requests_request(self, method, url, *args, **kwargs):
        captured_args.append((method, url))
        captured_kwargs.append(kwargs)
        resp = requests.Response()
        resp.status_code = 200
        return resp
        
    monkeypatch.setattr(orchid.core, "_original_requests_request", dummy_requests_request)
    
    session_obj = requests.Session()
    # Request to external domain should be intercepted and rewritten
    session_obj.request("GET", "https://api.serpapi.com/search?q=rust")
    
    assert len(captured_args) == 1
    method, url = captured_args[0]
    assert url == "http://127.0.0.1:4320/search?q=rust"
    
    headers = captured_kwargs[0].get("headers", {})
    assert headers.get("X-Orchid-Target-Url") == "https://api.serpapi.com"

def test_requests_fail_open_on_offline_proxy(monkeypatch):
    import requests
    import orchid.core
    
    monkeypatch.setenv("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
    monkeypatch.setenv("ORCHID_CAPTURE_DOMAINS", "*")
    
    # Mock healthcheck to succeed so it attempts proxying
    class DummyResponse:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *args): pass
    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **kw: DummyResponse())
    
    monkeypatch.setattr(orchid.core, "_patched", False)
    monkeypatch.setattr(orchid.core, "_offline_fallback", False)
    init()
    
    attempts = []
    
    def dummy_requests_request(self, method, url, *args, **kwargs):
        attempts.append((url, dict(kwargs.get("headers", {}))))
        if "127.0.0.1" in url:
            # Simulate offline proxy connection error
            raise requests.exceptions.ConnectionError("Connection refused")
        # Direct URL success
        resp = requests.Response()
        resp.status_code = 200
        return resp
        
    monkeypatch.setattr(orchid.core, "_original_requests_request", dummy_requests_request)
    
    session_obj = requests.Session()
    session_obj.request("GET", "https://api.serpapi.com/search?q=rust")
    
    # Should attempt proxy first, fail, and then attempt direct URL
    assert len(attempts) == 2
    assert attempts[0][0] == "http://127.0.0.1:4320/search?q=rust"
    assert attempts[0][1].get("X-Orchid-Target-Url") == "https://api.serpapi.com"
    
    assert attempts[1][0] == "https://api.serpapi.com/search?q=rust"
    assert "X-Orchid-Target-Url" not in attempts[1][1]

