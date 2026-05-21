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
    model_residency: {
      available: true,
      route_available: true,
      endpoints: {
        loaded: '/models/loaded',
        load: '/models/load',
        unload: '/models/unload',
      },
      tasks: ['text_generation', 'image_generation', 'tts', 'stt'],
      supports: { text_generation: true, image_generation: true, tts: true, stt: true },
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
assert.equal(ready.optional.modelResidency, true);
assert.equal(
  client.endpointFromDescriptor(complete.common.model_residency.endpoints.loaded, '/fallback'),
  '/api/gateway/models/loaded'
);
assert.equal(
  client.endpointFromDescriptor(complete.common.model_residency.endpoints.load, '/fallback'),
  '/api/gateway/models/load'
);
assert.equal(
  client.endpointFromDescriptor(complete.common.model_residency.endpoints.unload, '/fallback'),
  '/api/gateway/models/unload'
);

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

const noResidency = JSON.parse(JSON.stringify(complete));
delete noResidency.common.model_residency;
const noResidencyReady = client.getGatewayFlowEditorReadiness(noResidency);
assert.equal(noResidencyReady.operations.run.ready, true);
assert.equal(noResidencyReady.optional.modelResidency, false);

const residencyConfiguredLater = JSON.parse(JSON.stringify(complete));
residencyConfiguredLater.common.model_residency.available = false;
const residencyConfiguredLaterReady = client.getGatewayFlowEditorReadiness(residencyConfiguredLater);
assert.equal(residencyConfiguredLaterReady.operations.run.ready, true);
assert.equal(residencyConfiguredLaterReady.optional.modelResidency, true);
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr + result.stdout


def test_model_residency_frontend_helpers_normalize_and_guard_endpoints() -> None:
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

function loadTs(file, requires = {}) {
  const src = fs.readFileSync(file, 'utf8');
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
    require: (name) => {
      if (Object.prototype.hasOwnProperty.call(requires, name)) return requires[name];
      return require(name);
    },
    console,
    URLSearchParams,
    crypto: { randomUUID: () => 'uuid-1' },
  });
  return module.exports;
}

const client = loadTs('web/frontend/src/utils/gatewayClient.ts');
const queryCalls = [];
const mutationCalls = [];
const hooks = loadTs('web/frontend/src/hooks/useModelResidency.ts', {
  '@tanstack/react-query': {
    useQuery: (config) => {
      queryCalls.push(config);
      return config;
    },
    useMutation: (config) => {
      mutationCalls.push(config);
      return config;
    },
    useQueryClient: () => ({ invalidateQueries: () => undefined }),
  },
  '../utils/gatewayClient': client,
});

async function main() {
assert.equal(hooks.modelResidencyAvailable(null), false);
assert.equal(
  hooks.modelResidencyAvailable({ common: { model_residency: { route_available: false, endpoints: { loaded: '/models/loaded' } } } }),
  false
);
assert.equal(
  hooks.modelResidencyAvailable({ common: { model_residency: { endpoints: { loaded: { available: false, endpoint: '/models/loaded' }, load: '/models/load' } } } }),
  true
);

assert.deepEqual(hooks.normalizeModelResidencyResponse([
  { runtimeId: 'r1', loadId: 'l1', loadedAt: '2026-05-19T00:00:00Z', lastUsedAt: '2026-05-19T00:01:00Z' },
]).models[0], {
  runtimeId: 'r1',
  loadId: 'l1',
  loadedAt: '2026-05-19T00:00:00Z',
  lastUsedAt: '2026-05-19T00:01:00Z',
  runtime_id: 'r1',
  load_id: 'l1',
  loaded_at: '2026-05-19T00:00:00Z',
  last_used_at: '2026-05-19T00:01:00Z',
});
assert.equal(hooks.normalizeModelResidencyResponse({ runtimes: [{ runtime_id: 'r2' }] }).models[0].runtime_id, 'r2');
assert.equal(hooks.normalizeModelResidencyResponse('bad').ok, false);

const query = hooks.useLoadedModels(null, true);
assert.equal(query.enabled, false);
await assert.rejects(() => query.queryFn(), /loaded endpoint is not advertised/);

hooks.useLoadModelResidency(null);
hooks.useUnloadModelResidency({ common: { model_residency: { endpoints: { unload: { available: false, endpoint: '/models/unload' } } } } });
await assert.rejects(() => mutationCalls[0].mutationFn({ task: 'text_generation', provider: 'mlx', model: 'm' }), /load endpoint is not advertised/);
await assert.rejects(() => mutationCalls[1].mutationFn({ runtime_id: 'r1' }), /unload endpoint is not advertised/);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
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

    static_cli = (FRONTEND / "bin" / "cli.js").read_text(encoding="utf-8")
    assert "text/event-stream" in static_cli
    assert "flushHeaders" in static_cli


def test_python_gateway_proxy_streams_sse_line_by_line() -> None:
    sys.path.insert(0, str(ROOT))
    sys.path.insert(0, str(ROOT / "web"))
    from web.backend import main

    class FakeResponse:
        headers = {"content-type": "text/event-stream; charset=utf-8"}

        def __init__(self) -> None:
            self._lines = iter([b"event: step\n", b"data: {}\n", b"\n"])
            self.read_calls: list[int] = []
            self.readline_calls = 0
            self.closed = False

        def read(self, size: int) -> bytes:
            self.read_calls.append(size)
            return b""

        def readline(self) -> bytes:
            self.readline_calls += 1
            return next(self._lines, b"")

        def close(self) -> None:
            self.closed = True

    resp = FakeResponse()

    assert main._gateway_proxy_is_event_stream(resp.headers) is True
    assert list(main._iter_gateway_proxy_response(resp, event_stream=True)) == [
        b"event: step\n",
        b"data: {}\n",
        b"\n",
    ]
    assert resp.read_calls == []
    assert resp.readline_calls == 4
    assert resp.closed is True


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


def test_frontend_exposes_model_residency_controls() -> None:
    flow_types = (FRONTEND / "src" / "types" / "flow.ts").read_text(encoding="utf-8")
    node_templates = (FRONTEND / "src" / "types" / "nodes.ts").read_text(encoding="utf-8")
    gateway_client = (FRONTEND / "src" / "utils" / "gatewayClient.ts").read_text(encoding="utf-8")
    toolbar = (FRONTEND / "src" / "components" / "Toolbar.tsx").read_text(encoding="utf-8")
    panel = (FRONTEND / "src" / "components" / "ModelResidencyPanel.tsx").read_text(encoding="utf-8")
    base_node = (FRONTEND / "src" / "components" / "nodes" / "BaseNode.tsx").read_text(encoding="utf-8")
    graph_util = (FRONTEND / "src" / "utils" / "modelResidencyGraph.ts").read_text(encoding="utf-8")

    assert "'model_residency'" in flow_types
    assert "type: 'model_residency'" in node_templates
    assert "Load / Unload Model" in node_templates
    assert "warming, or unloading" in node_templates
    assert "operation: 'load'" in node_templates
    assert "task: 'image_generation'" in node_templates
    assert "common?.model_residency" in gateway_client
    assert "modelResidency" in gateway_client
    assert "ModelResidencyPanel" in toolbar
    assert "Loaded Models" in panel
    assert "Current Gateway/Runtime state" in panel
    assert "useLoadedModels" in panel
    assert "descriptorEndpointAvailable" in panel
    assert "residencyEndpointAvailable" in panel
    assert "loadAvailable" in panel
    assert "unloadAvailable" in panel
    assert "Loaded-model listing is not available on this Gateway runtime." in panel
    assert "Speech provider" in panel
    assert "Transcription provider" in panel
    assert "task === 'tts'" in panel
    assert "task === 'stt'" in panel
    properties_panel = (FRONTEND / "src" / "components" / "PropertiesPanel.tsx").read_text(encoding="utf-8")
    assert "Model Residency" in properties_panel
    assert "Add warm-up step before" in properties_panel
    assert "Add unload step after" in properties_panel
    assert "generate_voice" in properties_panel
    assert "transcribe_audio" in properties_panel
    assert "residencyProviderOptions" in properties_panel
    assert "Search providers…" in properties_panel
    assert "Search models…" in properties_panel
    assert "Warm before" in base_node
    assert "Unload after" in base_node
    assert "{ value: 'tts', label: 'speech' }" in base_node
    assert "{ value: 'stt', label: 'transcription' }" in base_node
    assert "insertModelResidencyStep" in base_node
    assert "Dynamic provider/model is wired from pins." in base_node
    assert "export function insertModelResidencyStep" in graph_util
    assert "Warm Model" in graph_util
    assert "Unload Model" in graph_util
    node_palette = (FRONTEND / "src" / "components" / "NodePalette.tsx").read_text(encoding="utf-8")
    assert "n.description.toLowerCase().includes(term)" in node_palette


def test_run_modal_source_marks_optional_residency_failures_as_no_op() -> None:
    run_modal = (FRONTEND / "src" / "components" / "RunFlowModal.tsx").read_text(encoding="utf-8")

    assert "isResidencyNoOpResult" in run_modal
    assert "label: 'NO-OP'" in run_modal
    assert "s.nodeType === 'model_residency' && isResidencyNoOpResult(s.output)" in run_modal
    assert "effectType === 'model_residency' && isResidencyNoOpResult(result)" in run_modal
    assert "selectedResidencyNoOp" in run_modal
    assert "This residency request completed without changing runtime state." in run_modal
    assert "media_provider" in run_modal
    assert "media_model" in run_modal


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
