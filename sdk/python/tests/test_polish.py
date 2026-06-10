import os
import json
import pytest
import asyncio
import threading
import importlib.util
from unittest.mock import MagicMock, patch
from pathlib import Path

from orchid.core import _purge_orchid_headers, GoogleClientPatchFinder
from orchid.client import OrchidControlClient, replay

def test_purge_orchid_headers_dict():
    # Test dictionary-like headers (case-insensitive keys)
    headers = {
        "X-Orchid-Session-Id": "sess-123",
        "x-orchid-mode": "capture",
        "X-ORCHID-PROXY-KEY": "proxy-secret",
        "Content-Type": "application/json",
        "Authorization": "Bearer token"
    }
    _purge_orchid_headers(headers)
    assert "Content-Type" in headers
    assert "Authorization" in headers
    assert not any(k.lower().startswith("x-orchid-") for k in headers)

def test_purge_orchid_headers_list():
    # Test list of key-value pairs (tuples/lists)
    headers = [
        ("X-Orchid-Session-Id", "sess-123"),
        ["x-orchid-mode", "capture"],
        ("X-ORCHID-PROXY-KEY", "proxy-secret"),
        ("Content-Type", "application/json")
    ]
    _purge_orchid_headers(headers)
    assert len(headers) == 1
    assert headers[0] == ("Content-Type", "application/json")

def test_google_client_patch_finder_reentry(monkeypatch):
    finder = GoogleClientPatchFinder()
    
    call_count = 0
    
    def mock_find_spec(fullname, path=None):
        nonlocal call_count
        call_count += 1
        
        # Assert that the re-entry guard is active during the find_spec traversal
        assert getattr(finder._local, "active", False) is True
        
        # Try to call finder.find_spec nestedly. It should return None because active is True
        nested_spec = finder.find_spec(fullname, path)
        assert nested_spec is None
        
        # Return a dummy spec for the outer call to proceed
        mock_spec = MagicMock()
        mock_spec.loader = MagicMock()
        return mock_spec
        
    monkeypatch.setattr(importlib.util, "find_spec", mock_find_spec)
    
    # Run the outer find_spec call
    spec = finder.find_spec("google.cloud.aiplatform.v1.PredictionServiceClient", None)
    
    # Verify the outer call completed successfully and returned our mocked spec
    assert spec is not None
    assert call_count == 1
    # Verify active was reset to False after execution
    assert getattr(finder._local, "active", False) is False

@pytest.mark.asyncio
async def test_async_replay_decorator_non_blocking(monkeypatch, tmp_path):
    fixture_file = tmp_path / "async_fixture.json"
    fixture_data = {"session": {"id": "async-sess"}, "exchanges": []}
    with open(fixture_file, "w") as f:
        json.dump(fixture_data, f)
        
    # We want to check that run_in_executor was called
    executor_calls = []
    
    loop = asyncio.get_running_loop()
    original_run_in_executor = loop.run_in_executor
    
    def mock_run_in_executor(executor, func, *args, **kwargs):
        executor_calls.append((func, args))
        # Call the original to let it execute synchronously or mock it to succeed
        if func.__name__ == "import_fixture":
            return original_run_in_executor(executor, lambda: True)
        elif func.__name__ == "read_sess_id":
            return original_run_in_executor(executor, lambda: "async-sess")
        return original_run_in_executor(executor, func, *args, **kwargs)
        
    monkeypatch.setattr(loop, "run_in_executor", mock_run_in_executor)
    monkeypatch.delenv("ORCHID_RECORD", raising=False)
    
    @replay(str(fixture_file))
    async def my_async_test():
        return "async-done"
        
    res = await my_async_test()
    assert res == "async-done"
    
    # Verify that run_in_executor was indeed called for reading session ID and importing fixture
    func_names = [call[0].__name__ for call in executor_calls]
    assert "read_sess_id" in func_names
    assert "import_fixture" in func_names
