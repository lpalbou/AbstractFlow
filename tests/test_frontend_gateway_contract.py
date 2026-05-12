from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "web" / "frontend"


def test_gateway_client_path_and_readiness_helpers() -> None:
    """Exercise the real TypeScript helper module through TypeScript's transpiler."""
    if not shutil.which("node"):
        pytest.skip("node is not installed")
    typescript = FRONTEND / "node_modules" / "typescript"
    if not typescript.exists():
        pytest.skip("frontend TypeScript dependency is not installed")

    script = r"""
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require(path.resolve('web/frontend/node_modules/typescript'));

const src = fs.readFileSync('web/frontend/src/utils/gatewayClient.ts', 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(js, {
  module,
  exports: module.exports,
  require,
  console,
  URLSearchParams,
  crypto: { randomUUID: () => 'uuid-1' },
});
const client = module.exports;

assert.equal(client.gatewayPath('/discovery/capabilities'), '/api/gateway/discovery/capabilities');
assert.equal(
  client.gatewayPath('/api/gateway/runs/{run_id}', { run_id: 'run 1' }, { after: 0, empty: '' }),
  '/api/gateway/runs/run%201?after=0'
);
assert.equal(
  client.endpointFromDescriptor(
    { endpoint: '/runs/{run_id}/ledger/stream', transport: 'sse' },
    '/fallback',
    { run_id: 'abc' },
    { after: 2 }
  ),
  '/api/gateway/runs/abc/ledger/stream?after=2'
);

const complete = {
  version: 1,
  common: {
    runs: {
      input_data: { endpoint: '/runs/{run_id}/input_data' },
      history_bundle: { endpoint: '/runs/{run_id}/history_bundle' },
      start: { endpoint: '/runs/start' },
      summary: { endpoint: '/runs/{run_id}' },
      list: { endpoint: '/runs' },
      commands: { endpoint: '/commands' },
    },
    ledger: {
      replay: { endpoint: '/runs/{run_id}/ledger' },
      stream: { endpoint: '/runs/{run_id}/ledger/stream', transport: 'sse' },
    },
    artifacts: {
      list: { endpoint: '/runs/{run_id}/artifacts' },
      metadata: { endpoint: '/runs/{run_id}/artifacts/{artifact_id}' },
      content: { endpoint: '/runs/{run_id}/artifacts/{artifact_id}/content' },
    },
    attachments: { upload: { endpoint: '/attachments/upload' } },
    workspace: { policy_endpoint: '/workspace/policy' },
        discovery: {
          providers: '/discovery/providers',
          provider_models: '/discovery/providers/{provider_name}/models',
          voice_voices: '/voice/voices',
          audio_speech_models: '/audio/speech/models',
          audio_transcription_models: '/audio/transcriptions/models',
          vision_provider_models: '/vision/provider_models',
          vision_models: '/vision/models',
          tools: '/discovery/tools',
          semantics: '/semantics',
        },
    prompt_cache: {
      session_lifecycle: true,
      session_endpoints: { status: '/prompt-cache/{session_id}', prepare: '/prompt-cache/{session_id}/prepare' },
    },
    memory: { available: true, endpoint: '/kg/query' },
  },
  flow_editor: {
    available: true,
    visualflows: {
      crud: { available: true, collection_endpoint: '/visualflows', item_endpoint: '/visualflows/{flow_id}' },
      publish: { endpoint: '/visualflows/{flow_id}/publish' },
    },
    run_input_schema: { endpoint: '/bundles/{bundle_id}/flows/{flow_id}/input_schema' },
  },
  assistant: {
    media: {
      generated_image: { direct_endpoint: { endpoint: '/media/images' } },
      generated_voice: { workflow: { available: true } },
    },
  },
};
const ready = client.getGatewayFlowEditorReadiness(complete);
assert.equal(ready.operations.save.ready, true);
assert.equal(ready.operations.run.ready, true);
assert.equal(ready.operations.history.ready, true);
assert.equal(ready.optional.kgMemory, true);
assert.equal(ready.optional.promptCacheSessions, true);
assert.equal(ready.optional.generatedImage, true);

const missingInputData = client.getGatewayFlowEditorReadiness(
  (() => {
    const missing = JSON.parse(JSON.stringify(complete));
    delete missing.common.runs.input_data;
    return missing;
  })()
);
assert.equal(missingInputData.operations.run.ready, false);
assert.match(missingInputData.operations.run.reason, /Run input rehydration/);

const missingHistoryBundle = client.getGatewayFlowEditorReadiness(
  (() => {
    const missing = JSON.parse(JSON.stringify(complete));
    delete missing.common.runs.history_bundle;
    return missing;
  })()
);
assert.equal(missingHistoryBundle.operations.history.ready, false);
assert.match(missingHistoryBundle.operations.history.reason, /Run history bundle/);

const missing = client.getGatewayFlowEditorReadiness({ version: 1, common: {}, flow_editor: { available: false } });
assert.equal(missing.operations.save.ready, false);
assert.match(missing.operations.run.reason, /contracts\.flow_editor\.available/);

const badTransport = JSON.parse(JSON.stringify(complete));
badTransport.common.ledger.stream.transport = 'websocket';
const bad = client.getGatewayFlowEditorReadiness(badTransport);
assert.equal(bad.operations.run.ready, false);
assert.match(bad.operations.run.reason, /transport/);
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr + result.stdout


def test_frontend_default_transport_avoids_local_runtime_routes() -> None:
    text_by_path = {
        path: path.read_text(encoding="utf-8")
        for root in [FRONTEND / "src", FRONTEND / "bin"]
        for path in root.rglob("*")
        if path.suffix in {".ts", ".tsx", ".js"}
    }

    forbidden = [
        "/api/ws",
        "/api/flows",
        "/api/runs",
        "/api/providers",
        "/ws/",
        "/flows/{flow_id}/run",
        "new WebSocket(",
    ]
    offenders: list[str] = []
    for path, text in text_by_path.items():
        for needle in forbidden:
            if needle in text:
                offenders.append(f"{path.relative_to(ROOT)} contains {needle}")

    assert offenders == []

    run_hook = (FRONTEND / "src" / "hooks" / "useWebSocket.ts").read_text(encoding="utf-8")
    assert "EventSource" in run_hook
    assert "/api/gateway/runs/{run_id}/ledger/stream" in run_hook
    assert "/api/gateway/runs/start" in run_hook


def test_frontend_exposes_gateway_media_node_templates() -> None:
    flow_types = (FRONTEND / "src" / "types" / "flow.ts").read_text(encoding="utf-8")
    node_templates = (FRONTEND / "src" / "types" / "nodes.ts").read_text(encoding="utf-8")

    for node_type in ("generate_image", "generate_voice", "transcribe_audio", "listen_voice"):
        assert f"'{node_type}'" in flow_types
        assert f"type: '{node_type}'" in node_templates

    assert "category: 'media'" in node_templates
    assert "image_artifact" in node_templates
    assert "audio_artifact" in node_templates
    assert "image_provider" in flow_types
    assert "image_model" in flow_types
    assert "tts_model" in flow_types
    assert "stt_model" in flow_types
    assert "runtime_provider" in flow_types
    assert "runtime_model" in flow_types
    assert "{ id: 'image_provider'" in node_templates
    assert "{ id: 'image_model'" in node_templates
    assert "{ id: 'tts_model'" in node_templates
    assert "{ id: 'stt_model'" in node_templates
    properties_panel = (FRONTEND / "src" / "components" / "PropertiesPanel.tsx").read_text(encoding="utf-8")
    assert "data.effectConfig?.image_provider" in properties_panel
    assert "image_model: picked?.model" in properties_panel
    assert "data.effectConfig?.tts_model" in properties_panel
    assert "data.effectConfig?.stt_model" in properties_panel
    assert "STT model" in properties_panel
    assert "Optional media/voice provider id." in node_templates
    assert "Optional audio/STT provider id." in node_templates


def test_python_host_local_runtime_routes_are_opt_in(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ABSTRACTFLOW_ENABLE_LOCAL_RUNTIME", raising=False)

    from web.backend import main

    assert main.local_runtime_routes_enabled() is False

    monkeypatch.setenv("ABSTRACTFLOW_ENABLE_LOCAL_RUNTIME", "1")
    assert main.local_runtime_routes_enabled() is True


def test_python_host_default_routes_are_gateway_proxy_only() -> None:
    script = """
import json
import os
import sys
from pathlib import Path

root = Path.cwd()
sys.path.insert(0, str(root))
sys.path.insert(0, str(root / "web"))
os.environ.pop("ABSTRACTFLOW_ENABLE_LOCAL_RUNTIME", None)

import backend.main as main

print(json.dumps(sorted(getattr(route, "path", "") for route in main.app.routes)))
"""
    env = os.environ.copy()
    env.pop("ABSTRACTFLOW_ENABLE_LOCAL_RUNTIME", None)
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr + result.stdout
    paths = set(json.loads(result.stdout))

    assert "/api/gateway/{path:path}" in paths
    assert "/api/connection/gateway" in paths
    assert "/api/ws/{flow_id}" not in paths
    assert "/api/flows" not in paths
    assert "/api/runs" not in paths
    assert "/api/providers" not in paths


def test_python_host_local_runtime_routes_are_present_when_opt_in() -> None:
    script = """
import json
import os
import sys
from pathlib import Path

root = Path.cwd()
sys.path.insert(0, str(root))
sys.path.insert(0, str(root / "web"))
os.environ["ABSTRACTFLOW_ENABLE_LOCAL_RUNTIME"] = "1"

import backend.main as main

print(json.dumps(sorted(getattr(route, "path", "") for route in main.app.routes)))
"""
    env = os.environ.copy()
    env["ABSTRACTFLOW_ENABLE_LOCAL_RUNTIME"] = "1"
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr + result.stdout
    paths = set(json.loads(result.stdout))

    assert "/api/flows" in paths
    assert "/api/ws/{flow_id}" in paths
    assert "/api/providers" in paths
    assert "/api/runs" in paths
