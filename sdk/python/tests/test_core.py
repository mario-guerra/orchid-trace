import os
import pytest
import asyncio
from orchid.core import init

def test_init_reads_proxy_url_and_sets_base_url(monkeypatch):
    monkeypatch.setenv("ORCHID_PROXY_URL", "http://192.168.1.1:4320/v1")
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    
    init()
    
    assert os.environ["OPENAI_BASE_URL"] == "http://192.168.1.1:4320/v1"

def test_init_preserves_api_key(monkeypatch):
    monkeypatch.setenv("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "real_secret_key")
    
    init()
    
    assert os.environ["OPENAI_API_KEY"] == "real_secret_key"

def test_init_malformed_url_fails_fast(monkeypatch):
    monkeypatch.setenv("ORCHID_PROXY_URL", "not_a_url")
    
    with pytest.raises(ValueError, match="Malformed ORCHID_PROXY_URL: not_a_url"):
        init()

def test_integration_routing(monkeypatch):
    try:
        import openai
    except ImportError:
        pytest.skip("openai not installed")
        
    monkeypatch.setenv("ORCHID_PROXY_URL", "http://192.168.1.99:4320/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "dummy_key")
    init()
    
    client = openai.OpenAI()
    
    assert str(client.base_url) == "http://192.168.1.99:4320/v1/"

from orchid.core import init, session
from orchid.context import orchid_session_id, orchid_mode
import orchid.core

def test_session_context_manager():
    # Outside session
    assert orchid_session_id.get() is None
    assert orchid_mode.get() is None
    
    with session("my-sess", mode="replay"):
        assert orchid_session_id.get() == "my-sess"
        assert orchid_mode.get() == "replay"
        
    # Restored
    assert orchid_session_id.get() is None
    assert orchid_mode.get() is None

def test_httpx_patching(monkeypatch):
    try:
        import httpx
    except ImportError:
        pytest.skip("httpx not installed")
        
    monkeypatch.setenv("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
    monkeypatch.setenv("ORCHID_API_KEY", "proxy-secret")
    init()
    
    captured_headers = {}
    
    def dummy_send(self, request, *args, **kwargs):
        captured_headers.clear()
        captured_headers.update(request.headers)
        return httpx.Response(200, json={})
        
    monkeypatch.setattr(orchid.core, "_original_httpx_send", dummy_send)
    
    client = httpx.Client()
    
    # 1. External URL: should NOT inject headers
    client.send(httpx.Request("GET", "http://example.com"))
    assert "x-orchid-api-key" not in captured_headers
    assert "x-orchid-session-id" not in captured_headers
    assert "x-orchid-mode" not in captured_headers
    
    # 2. Proxy URL: should inject proxy key
    client.send(httpx.Request("GET", "http://127.0.0.1:4320/v1/chat/completions"))
    assert captured_headers.get("x-orchid-api-key") == "proxy-secret"
    assert "x-orchid-session-id" not in captured_headers
    assert "x-orchid-mode" not in captured_headers
    
    captured_headers.clear()
    
    # 3. Proxy URL under active session context: should inject session headers
    with session("sess-123", mode="capture"):
        client.send(httpx.Request("GET", "http://127.0.0.1:4320/v1/chat/completions"))
        
    assert captured_headers.get("x-orchid-api-key") == "proxy-secret"
    assert captured_headers.get("x-orchid-session-id") == "sess-123"
    assert captured_headers.get("x-orchid-mode") == "capture"

def test_requests_patching(monkeypatch):
    try:
        import requests
    except ImportError:
        pytest.skip("requests not installed")
        
    monkeypatch.setenv("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
    monkeypatch.setenv("ORCHID_API_KEY", "proxy-secret")
    init()
    
    captured_kwargs = {}
    
    def dummy_request(self, method, url, *args, **kwargs):
        captured_kwargs.clear()
        captured_kwargs.update(kwargs)
        resp = requests.Response()
        resp.status_code = 200
        return resp
        
    monkeypatch.setattr(orchid.core, "_original_requests_request", dummy_request)
    
    session_obj = requests.Session()
    
    # 1. External URL: should NOT inject headers
    session_obj.request("GET", "http://example.com")
    headers = captured_kwargs.get("headers", {})
    assert "X-Orchid-Api-Key" not in headers
    assert "X-Orchid-Session-Id" not in headers
    assert "X-Orchid-Mode" not in headers
    
    # 2. Proxy URL: should inject proxy key
    session_obj.request("GET", "http://127.0.0.1:4320/v1/chat/completions")
    headers = captured_kwargs.get("headers", {})
    assert headers.get("X-Orchid-Api-Key") == "proxy-secret"
    assert "X-Orchid-Session-Id" not in headers
    assert "X-Orchid-Mode" not in headers
    
    captured_kwargs.clear()
    
    # 3. Proxy URL under active session context: should inject session headers
    with session("sess-456", mode="log"):
        session_obj.request("GET", "http://127.0.0.1:4320/v1/chat/completions")
        
    headers = captured_kwargs.get("headers", {})
    assert headers.get("X-Orchid-Api-Key") == "proxy-secret"
    assert headers.get("X-Orchid-Session-Id") == "sess-456"
    assert headers.get("X-Orchid-Mode") == "log"

@pytest.mark.asyncio
async def test_aiohttp_patching(monkeypatch):
    try:
        import aiohttp
    except ImportError:
        pytest.skip("aiohttp not installed")
        
    monkeypatch.setenv("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
    monkeypatch.setenv("ORCHID_API_KEY", "proxy-secret")
    init()
    
    captured_headers = {}
    
    async def dummy_request(self, method, str_or_url, *args, **kwargs):
        captured_headers.clear()
        captured_headers.update(kwargs.get("headers", {}))
        class DummyResp:
            async def __aenter__(self): return self
            async def __aexit__(self, exc_type, exc_val, exc_tb): pass
        return DummyResp()
        
    monkeypatch.setattr(orchid.core, "_original_aiohttp_request", dummy_request)
    
    async with aiohttp.ClientSession() as session_obj:
        # 1. External URL: should NOT inject headers
        await session_obj.get("http://example.com")
        assert "X-Orchid-Api-Key" not in captured_headers
        
        # 2. Proxy URL: should inject proxy key
        await session_obj.get("http://127.0.0.1:4320/v1/chat/completions")
        assert captured_headers.get("X-Orchid-Api-Key") == "proxy-secret"

@pytest.mark.asyncio
async def test_async_contextvar_isolation(monkeypatch):
    try:
        import httpx
    except ImportError:
        pytest.skip("httpx not installed")
        
    import random
    monkeypatch.setenv("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
    init()
    
    captured = {}
    
    async def dummy_async_send(self, request, *args, **kwargs):
        headers = request.headers
        sess_id = headers.get("x-orchid-session-id")
        task_name = asyncio.current_task().get_name()
        captured[task_name] = sess_id
        return httpx.Response(200, json={})
        
    monkeypatch.setattr(orchid.core, "_original_httpx_async_send", dummy_async_send)
    
    async def run_task(task_id):
        asyncio.current_task().set_name(f"task-{task_id}")
        sess_id = f"session-{task_id}"
        with session(sess_id, mode="capture"):
            await asyncio.sleep(random.uniform(0.01, 0.05))
            async with httpx.AsyncClient() as client:
                # Must hit the proxy URL to inject headers!
                await client.get("http://127.0.0.1:4320/v1/test")
                
    tasks = [run_task(i) for i in range(10)]
    await asyncio.gather(*tasks)
    
    assert len(captured) == 10
    for task_name, sess_id in captured.items():
        task_num = task_name.split("-")[1]
        assert sess_id == f"session-{task_num}"

def test_thread_contextvar_isolation(monkeypatch):
    try:
        import requests
    except ImportError:
        pytest.skip("requests not installed")
        
    import random
    import threading
    import concurrent.futures
    monkeypatch.setenv("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
    init()
    
    captured = {}
    lock = threading.Lock()
    
    def dummy_request(self, method, url, *args, **kwargs):
        headers = kwargs.get("headers", {})
        sess_id = headers.get("X-Orchid-Session-Id")
        thread_name = threading.current_thread().name
        with lock:
            captured[thread_name] = sess_id
        resp = requests.Response()
        resp.status_code = 200
        return resp
        
    monkeypatch.setattr(orchid.core, "_original_requests_request", dummy_request)
    
    def run_thread(thread_id):
        threading.current_thread().name = f"thread-{thread_id}"
        sess_id = f"session-{thread_id}"
        with session(sess_id, mode="capture"):
            import time
            time.sleep(random.uniform(0.01, 0.05))
            session_obj = requests.Session()
            # Must hit the proxy URL to inject headers!
            session_obj.get("http://127.0.0.1:4320/v1/test")
            
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(run_thread, i) for i in range(10)]
        concurrent.futures.wait(futures)
        
    assert len(captured) == 10
    for thread_name, sess_id in captured.items():
        thread_num = thread_name.split("-")[1]
        assert sess_id == f"session-{thread_num}"


def test_httpx_clean_after_success(monkeypatch):
    try:
        import httpx
    except ImportError:
        pytest.skip("httpx not installed")

    monkeypatch.setenv("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
    monkeypatch.setenv("ORCHID_API_KEY", "proxy-secret")
    init()

    def dummy_send(self, request, *args, **kwargs):
        return httpx.Response(200, json={})

    monkeypatch.setattr(orchid.core, "_original_httpx_send", dummy_send)

    client = httpx.Client()
    req = httpx.Request("GET", "https://api.openai.com/v1/chat/completions", headers={"Authorization": "Bearer real-key"})
    client.send(req)

    assert str(req.url) == "https://api.openai.com/v1/chat/completions"
    assert req.headers.get("host") == "api.openai.com"
    assert req.headers.get("Authorization") == "Bearer real-key"
    assert not any(k.lower().startswith("x-orchid-") for k in req.headers)


def test_httpx_clean_after_fallback(monkeypatch):
    try:
        import httpx
    except ImportError:
        pytest.skip("httpx not installed")

    monkeypatch.setenv("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
    monkeypatch.setenv("ORCHID_API_KEY", "proxy-secret")
    init()

    calls = 0

    def dummy_send(self, request, *args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise httpx.ConnectError("Proxy unreachable")
        return httpx.Response(200, json={"fallback": True})

    monkeypatch.setattr(orchid.core, "_original_httpx_send", dummy_send)

    client = httpx.Client()
    req = httpx.Request("GET", "https://api.openai.com/v1/chat/completions", headers={"Authorization": "Bearer real-key"})
    resp = client.send(req)

    assert resp.json() == {"fallback": True}
    assert str(req.url) == "https://api.openai.com/v1/chat/completions"
    assert req.headers.get("host") == "api.openai.com"
    assert req.headers.get("Authorization") == "Bearer real-key"
    assert not any(k.lower().startswith("x-orchid-") for k in req.headers)


def test_httpx_clean_after_non_connection_exception(monkeypatch):
    try:
        import httpx
    except ImportError:
        pytest.skip("httpx not installed")

    monkeypatch.setenv("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
    monkeypatch.setenv("ORCHID_API_KEY", "proxy-secret")
    init()

    def dummy_send(self, request, *args, **kwargs):
        raise httpx.ReadTimeout("Timeout")

    monkeypatch.setattr(orchid.core, "_original_httpx_send", dummy_send)

    client = httpx.Client()
    req = httpx.Request("GET", "https://api.openai.com/v1/chat/completions")

    with pytest.raises(httpx.ReadTimeout):
        client.send(req)

    assert str(req.url) == "https://api.openai.com/v1/chat/completions"
    assert req.headers.get("host") == "api.openai.com"
    assert not any(k.lower().startswith("x-orchid-") for k in req.headers)


@pytest.mark.asyncio
async def test_httpx_async_clean_after_success(monkeypatch):
    try:
        import httpx
    except ImportError:
        pytest.skip("httpx not installed")

    monkeypatch.setenv("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
    monkeypatch.setenv("ORCHID_API_KEY", "proxy-secret")
    init()

    async def dummy_async_send(self, request, *args, **kwargs):
        return httpx.Response(200, json={})

    monkeypatch.setattr(orchid.core, "_original_httpx_async_send", dummy_async_send)

    async with httpx.AsyncClient() as client:
        req = httpx.Request("GET", "https://api.openai.com/v1/chat/completions", headers={"Authorization": "Bearer real-key"})
        await client.send(req)

    assert str(req.url) == "https://api.openai.com/v1/chat/completions"
    assert req.headers.get("host") == "api.openai.com"
    assert req.headers.get("Authorization") == "Bearer real-key"
    assert not any(k.lower().startswith("x-orchid-") for k in req.headers)


def test_requests_headers_not_mutated(monkeypatch):
    try:
        import requests
    except ImportError:
        pytest.skip("requests not installed")

    monkeypatch.setenv("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
    monkeypatch.setenv("ORCHID_API_KEY", "proxy-secret")
    init()

    captured_headers = {}

    def dummy_request(self, method, url, *args, **kwargs):
        captured_headers.update(kwargs.get("headers", {}))
        resp = requests.Response()
        resp.status_code = 200
        return resp

    monkeypatch.setattr(orchid.core, "_original_requests_request", dummy_request)

    session_obj = requests.Session()
    headers = {"Authorization": "Bearer key"}
    session_obj.request("GET", "https://api.openai.com/v1/chat/completions", headers=headers)

    assert headers == {"Authorization": "Bearer key"}
    assert captured_headers.get("X-Orchid-Api-Key") == "proxy-secret"


@pytest.mark.asyncio
async def test_aiohttp_headers_not_mutated(monkeypatch):
    try:
        import aiohttp
    except ImportError:
        pytest.skip("aiohttp not installed")

    monkeypatch.setenv("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
    monkeypatch.setenv("ORCHID_API_KEY", "proxy-secret")
    init()

    captured_headers = {}

    async def dummy_request(self, method, str_or_url, *args, **kwargs):
        captured_headers.update(kwargs.get("headers", {}))
        class DummyResp:
            async def __aenter__(self): return self
            async def __aexit__(self, exc_type, exc_val, exc_tb): pass
        return DummyResp()

    monkeypatch.setattr(orchid.core, "_original_aiohttp_request", dummy_request)

    async with aiohttp.ClientSession() as session_obj:
        headers = {"Authorization": "Bearer key"}
        await session_obj.get("https://api.openai.com/v1/chat/completions", headers=headers)

    assert headers == {"Authorization": "Bearer key"}
    assert captured_headers.get("X-Orchid-Api-Key") == "proxy-secret"


def test_google_client_patch_finder_full_import_hook(monkeypatch):
    import sys
    import types
    import importlib.util
    import importlib.machinery
    import orchid.core
    from orchid.core import GoogleClientPatchFinder, init

    monkeypatch.setenv("ORCHID_BYPASS_HEALTHCHECK", "True")

    class DummyClient:
        def __init__(self, *args, **kwargs):
            self.transport = kwargs.get("transport")

    mock_loader = types.SimpleNamespace()
    def mock_exec_module(mod):
        mod.PredictionServiceClient = DummyClient
    mock_loader.exec_module = mock_exec_module

    mock_spec = importlib.machinery.ModuleSpec(
        name="google.cloud.aiplatform.v1",
        loader=mock_loader
    )

    finder = GoogleClientPatchFinder()

    def mock_find_spec(fullname, path=None, target=None):
        if fullname.startswith("google.cloud.aiplatform"):
            return mock_spec
        return None

    monkeypatch.setattr(importlib.util, "find_spec", mock_find_spec)

    spec = finder.find_spec("google.cloud.aiplatform.v1", None)
    assert spec is not None
    assert spec.loader is not None

    test_mod = types.ModuleType("google.cloud.aiplatform.v1")
    spec.loader.exec_module(test_mod)

    c = test_mod.PredictionServiceClient()
    assert c.transport == "rest"

    c_grpc = test_mod.PredictionServiceClient(transport="grpc")
    assert c_grpc.transport == "rest"


def test_requests_case_insensitive_dict_headers(monkeypatch):
    try:
        import requests
        from requests.structures import CaseInsensitiveDict
    except ImportError:
        pytest.skip("requests not installed")

    monkeypatch.setenv("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
    monkeypatch.setenv("ORCHID_API_KEY", "proxy-secret")
    init()

    captured_headers = {}

    def dummy_request(self, method, url, *args, **kwargs):
        captured_headers.update(kwargs.get("headers", {}))
        resp = requests.Response()
        resp.status_code = 200
        return resp

    monkeypatch.setattr(orchid.core, "_original_requests_request", dummy_request)

    session_obj = requests.Session()
    headers = CaseInsensitiveDict({"Authorization": "Bearer key", "Custom-Header": "val"})
    session_obj.request("GET", "https://api.openai.com/v1/chat/completions", headers=headers)

    assert isinstance(headers, CaseInsensitiveDict)
    assert headers["Authorization"] == "Bearer key"
    assert "X-Orchid-Api-Key" not in headers
    assert captured_headers.get("X-Orchid-Api-Key") == "proxy-secret"


@pytest.mark.asyncio
async def test_aiohttp_cimultidict_headers(monkeypatch):
    try:
        import aiohttp
        from multidict import CIMultiDict
    except ImportError:
        pytest.skip("aiohttp or multidict not installed")

    monkeypatch.setenv("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
    monkeypatch.setenv("ORCHID_API_KEY", "proxy-secret")
    init()

    captured_headers = {}

    async def dummy_request(self, method, str_or_url, *args, **kwargs):
        captured_headers.update(kwargs.get("headers", {}))
        class DummyResp:
            async def __aenter__(self): return self
            async def __aexit__(self, exc_type, exc_val, exc_tb): pass
        return DummyResp()

    monkeypatch.setattr(orchid.core, "_original_aiohttp_request", dummy_request)

    async with aiohttp.ClientSession() as session_obj:
        headers = CIMultiDict({"Authorization": "Bearer key"})
        await session_obj.get("https://api.openai.com/v1/chat/completions", headers=headers)

    assert isinstance(headers, CIMultiDict)
    assert headers["Authorization"] == "Bearer key"
    assert "X-Orchid-Api-Key" not in headers
    assert captured_headers.get("X-Orchid-Api-Key") == "proxy-secret"


def test_httpx_stream_connection_failure_fallback(monkeypatch):
    try:
        import httpx
    except ImportError:
        pytest.skip("httpx not installed")

    monkeypatch.setenv("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
    monkeypatch.setenv("ORCHID_API_KEY", "proxy-secret")
    init()

    calls = 0

    def dummy_send(self, request, *args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise httpx.ConnectError("Proxy unreachable")
        return httpx.Response(200, json={"stream": "ok"})

    monkeypatch.setattr(orchid.core, "_original_httpx_send", dummy_send)

    client = httpx.Client()
    req = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")

    with client.stream("POST", "https://api.openai.com/v1/chat/completions") as response:
        assert response.json() == {"stream": "ok"}

    assert str(req.url) == "https://api.openai.com/v1/chat/completions"
    assert not any(k.lower().startswith("x-orchid-") for k in req.headers)



