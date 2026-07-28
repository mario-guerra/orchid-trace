import os
import urllib.parse
import urllib.request
import contextlib
import threading
import importlib.util
from importlib.abc import MetaPathFinder
from .context import orchid_session_id, orchid_mode

_patched = False
_offline_fallback = False

def _should_intercept(url_parsed):
    if _offline_fallback:
        return False
        
    host = url_parsed.hostname or ""
    netloc = url_parsed.netloc or ""
    # Safe list: never proxy localhost/VPC loops
    if any(h in host or h in netloc for h in ["localhost", "127.0.0.1", "::1"]):
        return False
        
    # Check ignore lists
    ignore_list = os.environ.get("ORCHID_IGNORE_DOMAINS", "")
    if ignore_list:
        ignores = [d.strip() for d in ignore_list.split(",") if d.strip()]
        if any(i in host for i in ignores):
            return False
            
    # In replay mode, intercept all non-ignored external hosts so the proxy can match them against the DB
    mode = orchid_mode.get() or os.environ.get("ORCHID_MODE")
    if mode == "replay":
        return True

    # Check core LLM providers
    if any(h in host for h in ["api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com", "aiplatform.googleapis.com"]):
        return True
        
    # Check capture list / wildcard
    capture_domains = os.environ.get("ORCHID_CAPTURE_DOMAINS", "")
    if capture_domains == "*":
        return True
    elif capture_domains:
        domains = [d.strip() for d in capture_domains.split(",") if d.strip()]
        if any(d in host for d in domains):
            return True
            
    return False


def _is_core_provider(host):
    return any(h in host for h in ["api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com", "aiplatform.googleapis.com"])


def _rewrite_url(original_url_str, proxy_url):
    """
    Rewrites an upstream LLM request URL to route through the Orchid proxy.
    e.g., https://api.openai.com/v1/chat/completions -> http://127.0.0.1:4320/v1/chat/completions
          https://us-central1-aiplatform.googleapis.com/v1/projects/... -> http://127.0.0.1:4320/v1/projects/...
    """
    orig_parsed = urllib.parse.urlparse(original_url_str)
    proxy_parsed = urllib.parse.urlparse(proxy_url)
    
    path = orig_parsed.path
    if _is_core_provider(orig_parsed.hostname or ""):
        proxy_path = proxy_parsed.path.rstrip('/')
        if proxy_path and path.startswith(proxy_path):
            pass
        else:
            path = proxy_path + path
        
    rewritten = orig_parsed._replace(
        scheme=proxy_parsed.scheme,
        netloc=proxy_parsed.netloc,
        path=path
    )
    return urllib.parse.urlunparse(rewritten)

def _inject_headers(headers, url_str, original_url_str=None):
    # Only inject headers if the request is destined for the Orchid proxy.
    proxy_url = os.environ.get("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
    proxy_parsed = urllib.parse.urlparse(proxy_url)
    
    # Safely handle yarl.URL or string
    req_parsed = urllib.parse.urlparse(str(url_str))
    
    # Check if target host and port match the proxy URL
    if req_parsed.netloc == proxy_parsed.netloc:
        api_key = os.environ.get("ORCHID_API_KEY")
        if api_key:
            headers["X-Orchid-Api-Key"] = api_key
            
        session_id = orchid_session_id.get() or os.environ.get("ORCHID_SESSION_ID")
        mode = orchid_mode.get() or os.environ.get("ORCHID_MODE")
        
        if session_id:
            headers["X-Orchid-Session-Id"] = session_id
            if not mode:
                mode = "capture"
        if mode:
            headers["X-Orchid-Mode"] = mode

        # Target URL Injection
        if original_url_str:
            orig_parsed = urllib.parse.urlparse(str(original_url_str))
            if orig_parsed.netloc != proxy_parsed.netloc:
                headers["X-Orchid-Target-Url"] = f"{orig_parsed.scheme}://{orig_parsed.netloc}"

def _purge_orchid_headers(headers):
    """
    Case-insensitively purges all headers starting with 'x-orchid-' from the headers
    collection to prevent internal metadata leakage to upstream providers during fallback.
    Supports dictionary-like objects and lists of key-value tuple pairs.
    """
    if headers is None:
        return
        
    if isinstance(headers, list):
        purged = [h for h in headers if not (isinstance(h, (list, tuple)) and len(h) >= 1 and str(h[0]).lower().startswith("x-orchid-"))]
        headers.clear()
        headers.extend(purged)
    elif hasattr(headers, "keys") and hasattr(headers, "pop"):
        for k in list(headers.keys()):
            if str(k).lower().startswith("x-orchid-"):
                headers.pop(k, None)

try:
    import httpx
    _original_httpx_send = httpx.Client.send
    _original_httpx_async_send = httpx.AsyncClient.send
    
    def _patched_httpx_send(self, request, *args, **kwargs):
        proxy_url = os.environ.get("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
        original_url = str(request.url)
        req_parsed = urllib.parse.urlparse(original_url)
        
        intercepted = _should_intercept(req_parsed)
        if not intercepted:
            _inject_headers(request.headers, request.url)
            return _original_httpx_send(self, request, *args, **kwargs)

        original_host = request.headers.get("host")
        new_url_str = _rewrite_url(original_url, proxy_url)

        try:
            request.url = httpx.URL(new_url_str)
            request.headers['host'] = urllib.parse.urlparse(proxy_url).netloc
            _inject_headers(request.headers, request.url, original_url_str=original_url)
            return _original_httpx_send(self, request, *args, **kwargs)
        except (httpx.ConnectError, httpx.ConnectTimeout) as e:
            request.url = httpx.URL(original_url)
            request.headers['host'] = original_host if original_host is not None else req_parsed.netloc
            _purge_orchid_headers(request.headers)
            import logging
            logging.warning(f"Orchid Proxy connection failed: {e}. Falling back to direct routing: {original_url}")
            return _original_httpx_send(self, request, *args, **kwargs)
        finally:
            request.url = httpx.URL(original_url)
            request.headers['host'] = original_host if original_host is not None else req_parsed.netloc
            _purge_orchid_headers(request.headers)
        
    async def _patched_httpx_async_send(self, request, *args, **kwargs):
        proxy_url = os.environ.get("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
        original_url = str(request.url)
        req_parsed = urllib.parse.urlparse(original_url)
        
        intercepted = _should_intercept(req_parsed)
        if not intercepted:
            _inject_headers(request.headers, request.url)
            return await _original_httpx_async_send(self, request, *args, **kwargs)

        original_host = request.headers.get("host")
        new_url_str = _rewrite_url(original_url, proxy_url)

        try:
            request.url = httpx.URL(new_url_str)
            request.headers['host'] = urllib.parse.urlparse(proxy_url).netloc
            _inject_headers(request.headers, request.url, original_url_str=original_url)
            return await _original_httpx_async_send(self, request, *args, **kwargs)
        except (httpx.ConnectError, httpx.ConnectTimeout) as e:
            request.url = httpx.URL(original_url)
            request.headers['host'] = original_host if original_host is not None else req_parsed.netloc
            _purge_orchid_headers(request.headers)
            import logging
            logging.warning(f"Orchid Proxy connection failed: {e}. Falling back to direct routing: {original_url}")
            return await _original_httpx_async_send(self, request, *args, **kwargs)
        finally:
            request.url = httpx.URL(original_url)
            request.headers['host'] = original_host if original_host is not None else req_parsed.netloc
            _purge_orchid_headers(request.headers)
        
    def patch_httpx():
        httpx.Client.send = _patched_httpx_send
        httpx.AsyncClient.send = _patched_httpx_async_send
except ImportError:
    def patch_httpx():
        pass

try:
    import requests
    _original_requests_request = requests.Session.request
    
    def _patched_requests_request(self, method, url, *args, **kwargs):
        caller_headers = kwargs.get("headers")
        if isinstance(caller_headers, dict):
            headers = dict(caller_headers)
        elif isinstance(caller_headers, list):
            headers = list(caller_headers)
        elif caller_headers is None:
            headers = {}
        else:
            headers = dict(caller_headers)
        kwargs["headers"] = headers
            
        proxy_url = os.environ.get("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
        original_url = str(url)
        url_parsed = urllib.parse.urlparse(original_url)
        
        intercepted = _should_intercept(url_parsed)
        if intercepted:
            url = _rewrite_url(original_url, proxy_url)
            
        if isinstance(headers, dict):
            _inject_headers(headers, url, original_url_str=original_url if intercepted else None)
        elif isinstance(headers, list):
            proxy_parsed = urllib.parse.urlparse(proxy_url)
            req_parsed = urllib.parse.urlparse(str(url))
            
            if req_parsed.netloc == proxy_parsed.netloc:
                api_key = os.environ.get("ORCHID_API_KEY")
                if api_key:
                    headers.append(("X-Orchid-Api-Key", api_key))
                session_id = orchid_session_id.get() or os.environ.get("ORCHID_SESSION_ID")
                mode = orchid_mode.get() or os.environ.get("ORCHID_MODE")
                if session_id:
                    headers.append(("X-Orchid-Session-Id", session_id))
                    if not mode:
                        mode = "capture"
                if mode:
                    headers.append(("X-Orchid-Mode", mode))
                if intercepted:
                    orig_parsed = urllib.parse.urlparse(original_url)
                    headers.append(("X-Orchid-Target-Url", f"{orig_parsed.scheme}://{orig_parsed.netloc}"))
                
        try:
            return _original_requests_request(self, method, url, *args, **kwargs)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            if intercepted:
                import logging
                logging.warning(f"Orchid Proxy connection failed: {e}. Falling back to direct routing: {original_url}")
                url = original_url
                _purge_orchid_headers(headers)
                return _original_requests_request(self, method, url, *args, **kwargs)
            raise
        
    def patch_requests():
        requests.Session.request = _patched_requests_request
except ImportError:
    def patch_requests():
        pass

try:
    import aiohttp
    import asyncio
    _original_aiohttp_request = aiohttp.ClientSession._request
    
    async def _patched_aiohttp_request(self, method, str_or_url, *args, **kwargs):
        original_url = str(str_or_url)
        caller_headers = kwargs.get("headers")
        if isinstance(caller_headers, dict):
            headers = dict(caller_headers)
        elif isinstance(caller_headers, list):
            headers = list(caller_headers)
        elif caller_headers is None:
            headers = {}
        else:
            # CIMultiDict and similar Mapping types: convert to plain dict.
            headers = dict(caller_headers)
        kwargs["headers"] = headers
            
        proxy_url = os.environ.get("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
        url_parsed = urllib.parse.urlparse(original_url)
        
        intercepted = _should_intercept(url_parsed)
        if intercepted:
            url_str = _rewrite_url(original_url, proxy_url)
            import yarl
            if isinstance(str_or_url, yarl.URL):
                str_or_url = yarl.URL(url_str)
            else:
                str_or_url = url_str
        else:
            url_str = original_url
            
        if hasattr(headers, "__setitem__"):
            _inject_headers(headers, url_str, original_url_str=original_url if intercepted else None)
            
        try:
            return await _original_aiohttp_request(self, method, str_or_url, *args, **kwargs)
        except (aiohttp.ClientConnectorError, asyncio.TimeoutError) as e:
            if intercepted:
                import logging
                logging.warning(f"Orchid Proxy connection failed: {e}. Falling back to direct routing: {original_url}")
                import yarl
                if isinstance(str_or_url, yarl.URL):
                    str_or_url = yarl.URL(original_url)
                else:
                    str_or_url = original_url
                _purge_orchid_headers(headers)
                return await _original_aiohttp_request(self, method, str_or_url, *args, **kwargs)
            raise
        
    def patch_aiohttp():
        aiohttp.ClientSession._request = _patched_aiohttp_request
except ImportError:
    def patch_aiohttp():
        pass

def _patch_client_class(client_class):
    if hasattr(client_class, "_orchid_patched"):
        return
    client_class._orchid_patched = True
    
    is_async = "Async" in client_class.__name__
    original_init = client_class.__init__
    def new_init(self, *args, **kwargs):
        transport = kwargs.get("transport")
        if transport is None or transport in ("grpc", "grpc_asyncio"):
            kwargs["transport"] = "rest_asyncio" if is_async else "rest"
        original_init(self, *args, **kwargs)
        
    client_class.__init__ = new_init

class GoogleClientPatchFinder(MetaPathFinder):
    def __init__(self):
        self._local = threading.local()

    def find_spec(self, fullname, path, target=None):
        if fullname.startswith("google.cloud.aiplatform") or fullname.startswith("google.cloud.aiplatform_"):
            if getattr(self._local, "active", False):
                return None
            self._local.active = True
            try:
                spec = importlib.util.find_spec(fullname, path)
            finally:
                self._local.active = False
                
            if spec is not None and spec.loader is not None:
                if hasattr(spec.loader, "exec_module"):
                    orig_exec_module = spec.loader.exec_module
                    
                    def new_exec_module(module):
                        orig_exec_module(module)
                        if module.__name__.startswith("google.cloud.aiplatform") or module.__name__.startswith("google.cloud.aiplatform_"):
                            for attr_name in dir(module):
                                attr = getattr(module, attr_name, None)
                                if isinstance(attr, type) and attr_name.endswith("Client"):
                                    if "PredictionService" in attr_name or hasattr(attr, "_transport_class"):
                                        _patch_client_class(attr)
                                        
                    spec.loader.exec_module = new_exec_module
            return spec
        return None

def _patch_loaded_and_future_google_clients():
    import sys
    try:
        # Check if google namespace is available before paying meta path hook cost
        importlib.util.find_spec("google")
    except (ImportError, AttributeError, ValueError):
        return

    # 1. Patch already loaded modules
    for name, module in list(sys.modules.items()):
        if name.startswith("google.cloud.aiplatform") or name.startswith("google.cloud.aiplatform_"):
            for attr_name in dir(module):
                attr = getattr(module, attr_name, None)
                if isinstance(attr, type) and attr_name.endswith("Client"):
                    if "PredictionService" in attr_name or hasattr(attr, "_transport_class"):
                        _patch_client_class(attr)

    # 2. Register meta path finder for future imports
    for finder in sys.meta_path:
        if finder.__class__.__name__ == "GoogleClientPatchFinder":
            return
    sys.meta_path.insert(0, GoogleClientPatchFinder())

@contextlib.contextmanager
def session(session_id: str, mode: str = "capture"):
    """
    Context manager to set the current session ID and mode for intercepting requests.

    :param session_id: The unique identifier for the recorded/replayed trace session.
    :param mode: The interception mode. Supported values: 'capture' (record traffic),
                 'replay' (return mocks), or 'passthrough' (do nothing).
    """
    token_id = orchid_session_id.set(session_id)
    token_mode = orchid_mode.set(mode)
    try:
        yield
    finally:
        orchid_session_id.reset(token_id)
        orchid_mode.reset(token_mode)

def init():
    """
    Initializes the Orchid Thin SDK environment.
    
    Checks if the Orchid Proxy is online via health check. If online, patches 
    'httpx', 'requests', 'aiohttp', and 'google-cloud-aiplatform' (Vertex AI) 
    client classes to route LLM requests through the Orchid Proxy, and overrides
    the default OpenAI URL (`OPENAI_BASE_URL`). 
    
    If the proxy is offline, fail-soft (direct connection routing) is maintained 
    and no patches are applied.
    """
    global _patched, _offline_fallback
    _offline_fallback = False  # Reset fallback flag on every init invocation to allow retry
    
    # Mock google auth default credentials to bypass client-side GCP validation in replay mode
    if os.environ.get("ORCHID_MODE") == "replay":
        try:
            import google.auth.credentials

            class _OrchidReplayCredentials(google.auth.credentials.Credentials):
                """Dummy credentials that are always valid and never refresh.
                
                In replay mode, Orchid intercepts HTTP requests at the transport
                layer, so real auth tokens are unnecessary. This class prevents
                the Google Auth library from attempting any token refresh (which
                would fail without real credentials and happens before Orchid's
                HTTP patches can intercept the request).
                """
                def __init__(self):
                    super().__init__()
                    self.token = "orchid-replay-dummy-token"

                @property
                def valid(self):
                    return True

                @property
                def expired(self):
                    return False

                def refresh(self, request):
                    pass  # No-op: token never expires in replay mode

                def before_request(self, request, method, url, headers):
                    headers["Authorization"] = f"Bearer {self.token}"

            import google.auth
            _orchid_dummy_creds = _OrchidReplayCredentials()
            google.auth.default = lambda *args, **kwargs: (_orchid_dummy_creds, "orchid-replay-project")
        except ImportError:
            pass
    
    proxy_url = os.environ.get("ORCHID_PROXY_URL", "http://127.0.0.1:4320/v1")
    
    parsed = urllib.parse.urlparse(proxy_url)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError(f"Malformed ORCHID_PROXY_URL: {proxy_url}")

    # Determine health check query port (4321) if proxy port is 4320
    query_url = os.environ.get("ORCHID_QUERY_URL")
    if not query_url:
        netloc = parsed.netloc
        if ":" in netloc:
            host, port = netloc.rsplit(":", 1)
            if port == "4320":
                netloc = f"{host}:4321"
        query_parsed = parsed._replace(netloc=netloc, path="")
        query_url = urllib.parse.urlunparse(query_parsed)

    # Health check connection handshake (bypass in test suite context to avoid regressions)
    bypass = os.environ.get("ORCHID_BYPASS_HEALTHCHECK") == "True" or os.environ.get("PYTEST_CURRENT_TEST") is not None
    if not bypass:
        try:
            req = urllib.request.Request(f"{query_url.rstrip('/')}/health", method="GET")
            with urllib.request.urlopen(req, timeout=1.0) as response:
                if response.status != 200:
                    _offline_fallback = True
        except Exception:
            _offline_fallback = True

    if not _offline_fallback:
        os.environ["OPENAI_BASE_URL"] = proxy_url
    else:
        import sys
        print(f"⚠️  [orchid-sdk] Orchid Proxy is offline (health check failed at {query_url}). Falling back to direct routing. No traffic will be recorded.", file=sys.stderr)
        
    # Disable gRPC globally for Google Cloud APIs to force fallback to REST stubs
    os.environ["GOOGLE_CLOUD_DISABLE_GRPC"] = "True"
    
    if not _patched and not _offline_fallback:
        patch_httpx()
        patch_requests()
        patch_aiohttp()
        _patch_loaded_and_future_google_clients()
        _patched = True

