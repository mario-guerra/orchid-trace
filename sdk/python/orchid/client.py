import os
import json
import functools
import inspect
import httpx
import asyncio
import time
import logging
from pathlib import Path
from .core import session

logger = logging.getLogger("orchid")

class OrchidControlClient:
    """
    Control client for managing the Orchid capture/replay database.
    Provides methods to perform health checks, export captured sessions, 
    and import fixtures into the Orchid Proxy.
    """
    def __init__(self, query_url: str = None, api_key: str = None):
        """
        Initializes the OrchidControlClient.

        :param query_url: The URL of the Orchid Query service (default: http://127.0.0.1:4321).
        :param api_key: The API key for authenticating with the control plane.
        """
        self.query_url = query_url or os.environ.get("ORCHID_QUERY_URL", "http://127.0.0.1:4321")
        self.api_key = api_key or os.environ.get("ORCHID_API_KEY")
        
    def _headers(self):
        headers = {}
        if self.api_key:
            headers["X-Orchid-Api-Key"] = self.api_key
        return headers
        
    def check_health(self) -> bool:
        """
        Checks the health of the Orchid Query service.

        :return: True if the service is online and returning 200 OK, otherwise False.
        """
        try:
            with httpx.Client() as client:
                resp = client.get(f"{self.query_url}/health", headers=self._headers(), timeout=5.0)
                return resp.status_code == 200
        except Exception as e:
            logger.warning(f"Orchid query service health check failed: {e}")
            return False
            
    def export_fixture(self, session_id: str, path: str) -> bool:
        """
        Exports all captured exchanges for a given session ID from the proxy
        and saves them to a local JSON fixture file.

        :param session_id: The ID of the session to export.
        :param path: The local file path to write the JSON fixture to.
        :return: True if successfully exported and written, otherwise False.
        """
        try:
            with httpx.Client() as client:
                resp = client.get(f"{self.query_url}/v1/sessions/{session_id}/export", headers=self._headers())
                if resp.status_code == 404:
                    logger.warning(f"Orchid session {session_id} not found to export.")
                    return False
                resp.raise_for_status()
                fixture = resp.json()
                
                fixture_path = Path(path)
                fixture_path.parent.mkdir(parents=True, exist_ok=True)
                with open(fixture_path, "w") as f:
                    json.dump(fixture, f, indent=2)
                return True
        except Exception as e:
            logger.warning(f"Failed to export Orchid fixture for session {session_id} to {path}: {e}")
            return False
            
    def import_fixture(self, path: str) -> bool:
        """
        Reads a local JSON fixture file and imports its exchanges into the
        Orchid Proxy database.

        :param path: The local file path of the JSON fixture.
        :return: True if successfully imported, otherwise False.
        :raises FileNotFoundError: If the fixture file does not exist.
        """
        fixture_path = Path(path)
        if not fixture_path.exists():
            raise FileNotFoundError(f"Fixture file not found: {path}")
        with open(fixture_path, "r") as f:
            fixture = json.load(f)
            
        try:
            with httpx.Client() as client:
                resp = client.post(f"{self.query_url}/v1/sessions/import", json=fixture, headers=self._headers())
                resp.raise_for_status()
                return resp.status_code == 201
        except Exception as e:
            logger.warning(f"Failed to import Orchid fixture from {path}: {e}")
            raise

def replay(fixture_path: str):
    """
    Decorator for functions or test cases to capture or replay HTTP requests.
    
    If `ORCHID_RECORD` environment variable is set to '1', 'true', or 'yes',
    the decorated function is run in capture mode and the session's HTTP traffic 
    is exported to the fixture path after execution. Otherwise, the local fixture
    is imported into the proxy and the function is run in replay mode.
    
    This decorator supports both synchronous and asynchronous functions.

    :param fixture_path: The local JSON file path where traffic is saved/replayed.
    """
    def decorator(func):
        path = Path(fixture_path)
        
        if inspect.iscoroutinefunction(func):
            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                record_mode = os.environ.get("ORCHID_RECORD", "").lower() in ("1", "true", "yes")
                client = OrchidControlClient()
                
                # Extract session ID from the fixture if it exists
                sess_id = None
                if path.exists():
                    try:
                        loop = asyncio.get_running_loop()
                        def read_sess_id():
                            with open(path, "r") as f:
                                data = json.load(f)
                            return data.get("session", {}).get("id")
                        sess_id = await loop.run_in_executor(None, read_sess_id)
                    except Exception:
                        pass
                
                if not sess_id:
                    sess_id = func.__name__
                
                if record_mode:
                    with session(sess_id, mode="capture"):
                        result = await func(*args, **kwargs)
                    
                    flush_sleep = float(os.environ.get("ORCHID_FLUSH_SLEEP", "0.2"))
                    if flush_sleep > 0:
                        await asyncio.sleep(flush_sleep)
                        
                    # Non-blocking executor call for sync export
                    loop = asyncio.get_running_loop()
                    await loop.run_in_executor(None, client.export_fixture, sess_id, str(path))
                    return result
                else:
                    if not path.exists():
                        raise FileNotFoundError(f"Fixture file not found: {path}")
                        
                    # Non-blocking executor call for sync import
                    loop = asyncio.get_running_loop()
                    await loop.run_in_executor(None, client.import_fixture, str(path))
                    
                    with session(sess_id, mode="replay"):
                        return await func(*args, **kwargs)
            return async_wrapper
        else:
            @functools.wraps(func)
            def sync_wrapper(*args, **kwargs):
                record_mode = os.environ.get("ORCHID_RECORD", "").lower() in ("1", "true", "yes")
                client = OrchidControlClient()
                
                # Extract session ID from the fixture if it exists
                sess_id = None
                if path.exists():
                    try:
                        with open(path, "r") as f:
                            data = json.load(f)
                        sess_id = data.get("session", {}).get("id")
                    except Exception:
                        pass
                
                if not sess_id:
                    sess_id = func.__name__
                
                if record_mode:
                    with session(sess_id, mode="capture"):
                        result = func(*args, **kwargs)
                    
                    flush_sleep = float(os.environ.get("ORCHID_FLUSH_SLEEP", "0.2"))
                    if flush_sleep > 0:
                        time.sleep(flush_sleep)
                        
                    client.export_fixture(sess_id, str(path))
                    return result
                else:
                    if not path.exists():
                        raise FileNotFoundError(f"Fixture file not found: {path}")
                    client.import_fixture(str(path))
                    
                    with session(sess_id, mode="replay"):
                        return func(*args, **kwargs)
            return sync_wrapper
    return decorator
