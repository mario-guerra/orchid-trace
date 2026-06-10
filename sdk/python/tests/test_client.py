import os
import json
import pytest
import httpx
from pathlib import Path
from orchid.client import OrchidControlClient, replay
from orchid.context import orchid_session_id, orchid_mode

def test_control_client_headers():
    client = OrchidControlClient(api_key="my-key")
    headers = client._headers()
    assert headers.get("X-Orchid-Api-Key") == "my-key"

def test_control_client_health(monkeypatch):
    client = OrchidControlClient()
    
    called_url = None
    
    def mock_send(self, request, *args, **kwargs):
        nonlocal called_url
        called_url = str(request.url)
        return httpx.Response(200, json={})
        
    monkeypatch.setattr(httpx.Client, "send", mock_send)
    
    assert client.check_health() is True
    assert called_url == "http://127.0.0.1:4321/health"

def test_control_client_export(monkeypatch, tmp_path):
    client = OrchidControlClient(api_key="secret-key")
    fixture_path = tmp_path / "exported.json"
    
    def mock_send(self, request, *args, **kwargs):
        assert request.headers.get("X-Orchid-Api-Key") == "secret-key"
        assert str(request.url) == "http://127.0.0.1:4321/v1/sessions/s1/export"
        return httpx.Response(200, json={"session": {"id": "s1"}, "exchanges": []}, request=request)
        
    monkeypatch.setattr(httpx.Client, "send", mock_send)
    
    res = client.export_fixture("s1", str(fixture_path))
    assert res is True
    assert fixture_path.exists()
    with open(fixture_path, "r") as f:
        data = json.load(f)
    assert data == {"session": {"id": "s1"}, "exchanges": []}

def test_control_client_import(monkeypatch, tmp_path):
    client = OrchidControlClient()
    fixture_path = tmp_path / "to_import.json"
    fixture_data = {"session": {"id": "s1"}, "exchanges": []}
    
    with open(fixture_path, "w") as f:
        json.dump(fixture_data, f)
        
    called_json = None
    
    def mock_send(self, request, *args, **kwargs):
        nonlocal called_json
        assert str(request.url) == "http://127.0.0.1:4321/v1/sessions/import"
        called_json = json.loads(request.read())
        return httpx.Response(201, request=request)
        
    monkeypatch.setattr(httpx.Client, "send", mock_send)

    
    res = client.import_fixture(str(fixture_path))
    assert res is True
    assert called_json == fixture_data

def test_replay_decorator_record(monkeypatch, tmp_path):
    monkeypatch.setenv("ORCHID_RECORD", "1")
    monkeypatch.setenv("ORCHID_FLUSH_SLEEP", "0") # disable sleep to speed up tests
    
    exported_sess = None
    exported_path = None
    
    def mock_export(self, session_id, path):
        nonlocal exported_sess, exported_path
        exported_sess = session_id
        exported_path = path
        # Write dummy file
        with open(path, "w") as f:
            json.dump({"session": {"id": session_id}}, f)
        return True
        
    monkeypatch.setattr(OrchidControlClient, "export_fixture", mock_export)
    
    fixture_file = tmp_path / "recorded_test.json"
    
    @replay(str(fixture_file))
    def my_test():
        assert orchid_session_id.get() == "my_test"
        assert orchid_mode.get() == "capture"
        return "success"
        
    res = my_test()
    assert res == "success"
    assert exported_sess == "my_test"
    assert exported_path == str(fixture_file)
    assert fixture_file.exists()

def test_replay_decorator_replay(monkeypatch, tmp_path):
    monkeypatch.delenv("ORCHID_RECORD", raising=False)
    
    fixture_data = {"session": {"id": "custom-id-from-json"}, "exchanges": []}
    fixture_file = tmp_path / "replay_test.json"
    with open(fixture_file, "w") as f:
        json.dump(fixture_data, f)
        
    imported_path = None
    
    def mock_import(self, path):
        nonlocal imported_path
        imported_path = path
        return True
        
    monkeypatch.setattr(OrchidControlClient, "import_fixture", mock_import)
    
    @replay(str(fixture_file))
    def my_test():
        assert orchid_session_id.get() == "custom-id-from-json"
        assert orchid_mode.get() == "replay"
        return "replayed"
        
    res = my_test()
    assert res == "replayed"
    assert imported_path == str(fixture_file)

def test_replay_decorator_missing_fixture_raises_error(monkeypatch, tmp_path):
    monkeypatch.delenv("ORCHID_RECORD", raising=False)
    fixture_file = tmp_path / "nonexistent.json"
    
    @replay(str(fixture_file))
    def my_test():
        pass
        
    with pytest.raises(FileNotFoundError, match="Fixture file not found"):
        my_test()

