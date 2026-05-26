from __future__ import annotations

import json
import os
import re
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
      purge_drafts: { endpoint: '/runs/purge_drafts' },
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
      audio_music_providers: '/audio/music/providers',
      audio_music_models: '/audio/music/models',
      embedding_models: '/embeddings/models',
      vision_provider_models: '/vision/provider_models',
      vision_models: '/vision/models',
      tools: '/discovery/tools',
      semantics: '/semantics',
      catalog_contract: {
        contract: 'gateway_catalog_v1',
        version: 1,
        metadata_field: 'catalog',
        primary_items_field: 'items',
      },
    },
    prompt_cache: {
      session_lifecycle: true,
      session_endpoints: { status: '/prompt-cache/{session_id}', prepare: '/prompt-cache/{session_id}/prepare' },
      durable_blocs: {
        available: true,
        route_available: true,
        lifecycle_available: true,
        endpoints: {
          record: '/blocs/record',
          list: '/blocs',
          kv_manifest: '/blocs/kv/manifest',
          kv_list: '/blocs/kv/list',
          kv_ensure: '/blocs/kv/ensure',
          kv_load: '/blocs/kv/load',
        },
        stable_identifiers: ['bloc_id', 'sha256'],
        exact_reuse_binding_param: 'prompt_cache_binding',
      },
    },
    model_residency: {
      available: true,
      route_available: true,
      endpoints: {
        loaded: '/models/loaded',
        load: '/models/load',
        unload: '/models/unload',
      },
      tasks: ['text_generation', 'image_generation', 'text_to_video', 'image_to_video', 'music_generation', 'tts', 'stt'],
      supports: { text_generation: true, image_generation: true, text_to_video: true, image_to_video: true, music_generation: true, tts: true, stt: true },
    },
    memory: { available: true, endpoint: '/kg/query' },
    execution: {
      code: {
        contract: 'code_execution_policy_v1',
        version: 1,
        default_mode: 'sandbox',
        simulate: { available: true, endpoint: '/visualflows/code/simulate' },
        modes: [
          { id: 'sandbox', label: 'Sandbox', available: true, default: true },
          { id: 'full_access', label: 'Full access', available: false, disabled_reason: 'Disabled by execution-host policy.' },
        ],
      },
    },
    readiness: {
      contract: 'gateway_surface_readiness_v1',
      version: 1,
      truth_scope: 'gateway_contract_surface',
      limitations: ['Derived from Gateway endpoint descriptors and contract wiring only.'],
      surfaces: {
        media: {
          generated_image: { available: true, route_available: true, configured: true, workflow_available: false },
          edited_image: { available: true, route_available: true, configured: true, workflow_available: false },
          generated_video: { available: true, route_available: true, configured: true, workflow_available: false },
          image_to_video: { available: true, route_available: true, configured: true, workflow_available: false },
          generated_voice: { available: false, route_available: false, workflow_available: true },
          generated_music: { available: true, route_available: true, configured: true, workflow_available: false },
        },
        model_residency: {
          available: false,
          route_available: true,
          supports: { text_generation: true, image_generation: true, text_to_video: true, image_to_video: true, music_generation: true, tts: true, stt: true },
        },
      },
    },
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
      generated_image: { direct_endpoint: { endpoint: '/media/images', available: true } },
      edited_image: { direct_endpoint: { endpoint: '/media/images/edit', available: true } },
      generated_video: {
        direct_endpoint: {
          endpoint: '/runs/{run_id}/videos/generate',
          available: true,
          configured: true,
          route_available: true,
          provider_models_endpoint: '/vision/provider_models',
          provider_models_task: 'text_to_video',
          progress_event_name: 'abstract.progress',
          progress_scope: 'child_run_ledger',
        },
      },
      image_to_video: {
        direct_endpoint: {
          endpoint: '/runs/{run_id}/videos/from_image',
          available: true,
          configured: true,
          route_available: true,
          provider_models_endpoint: '/vision/provider_models',
          provider_models_task: 'image_to_video',
          progress_event_name: 'abstract.progress',
          progress_scope: 'child_run_ledger',
        },
      },
      generated_voice: { workflow: { available: true } },
      generated_music: {
        direct_endpoint: {
          endpoint: '/runs/{run_id}/music/generate',
          available: true,
          configured: true,
          route_available: true,
        },
      },
    },
  },
};
const ready = client.getGatewayFlowEditorReadiness(complete);
assert.equal(ready.operations.save.ready, true);
assert.equal(ready.operations.run.ready, true);
assert.equal(ready.operations.history.ready, true);
assert.equal(ready.optional.kgMemory, true);
assert.equal(ready.optional.promptCacheSessions, true);
assert.equal(ready.optional.promptCacheDurableBlocs, true);
assert.equal(ready.optional.generatedImage, true);
assert.equal(ready.optional.editedImage, true);
assert.equal(ready.optional.generatedVideo, true);
assert.equal(ready.optional.imageToVideo, true);
assert.equal(ready.optional.generatedMusic, true);
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
assert.equal(client.getCodeExecutionContract(complete).contract, 'code_execution_policy_v1');
assert.equal(
  client.endpointFromDescriptor(complete.common.runs.purge_drafts, '/fallback'),
  '/api/gateway/runs/purge_drafts'
);
assert.deepEqual(
  client.codePermissionOptions(complete, 'full_access').map((o) => [o.value, o.disabled === true]),
  [['sandbox', false], ['full_access', true]]
);
assert.match(client.codePermissionUnavailableReason(complete, 'full_access'), /Disabled/);
assert.equal(client.codePermissionUnavailableReason(complete, 'sandbox'), '');
assert.deepEqual(
  client.codePermissionOptions({ version: 1 }, '').map((o) => [o.value, o.disabled === true]),
  [['sandbox', false]]
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

const unsupportedVersion = JSON.parse(JSON.stringify(complete));
unsupportedVersion.version = 2;
const versionMismatch = client.getGatewayFlowEditorReadiness(unsupportedVersion);
assert.equal(versionMismatch.ready, false);
assert.equal(versionMismatch.operations.run.ready, false);
assert.match(versionMismatch.operations.run.reason, /version 2 is not supported/);

const missingRunStart = JSON.parse(JSON.stringify(complete));
delete missingRunStart.common.runs.start;
const missingRunStartReady = client.getGatewayFlowEditorReadiness(missingRunStart);
assert.equal(missingRunStartReady.ready, false);
assert.equal(missingRunStartReady.operations.run.ready, false);
assert(missingRunStartReady.operations.run.missing.includes('Run start'));
assert.match(missingRunStartReady.operations.run.reason, /Run start endpoint is missing from Gateway discovery/);

const unavailableRunStart = JSON.parse(JSON.stringify(complete));
unavailableRunStart.common.runs.start = {
  available: false,
  endpoint: '/runs/start',
  install_hint: 'Upgrade AbstractGateway.',
};
const descriptorMismatch = client.getGatewayFlowEditorReadiness(unavailableRunStart);
assert.equal(descriptorMismatch.ready, false);
assert.equal(descriptorMismatch.operations.run.ready, false);
assert.match(descriptorMismatch.operations.run.reason, /Upgrade AbstractGateway/);

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

const noDurableBlocs = JSON.parse(JSON.stringify(complete));
noDurableBlocs.common.prompt_cache.durable_blocs.available = false;
const noDurableReady = client.getGatewayFlowEditorReadiness(noDurableBlocs);
assert.equal(noDurableReady.operations.run.ready, true);
assert.equal(noDurableReady.optional.promptCacheSessions, true);
assert.equal(noDurableReady.optional.promptCacheDurableBlocs, false);
assert.equal(client.durableBlocPromptCacheAvailable(complete.common.prompt_cache.durable_blocs), true);
assert.equal(
  client.gatewayPath(complete.common.prompt_cache.durable_blocs.endpoints.kv_load),
  '/api/gateway/blocs/kv/load'
);

const musicUnavailable = JSON.parse(JSON.stringify(complete));
musicUnavailable.assistant.media.generated_music.direct_endpoint.available = false;
musicUnavailable.assistant.media.generated_music.direct_endpoint.configured = true;
assert.equal(client.getGatewayFlowEditorReadiness(musicUnavailable).optional.generatedMusic, false);

const musicUnconfigured = JSON.parse(JSON.stringify(complete));
musicUnconfigured.assistant.media.generated_music.direct_endpoint.configured = false;
assert.equal(client.getGatewayFlowEditorReadiness(musicUnconfigured).optional.generatedMusic, false);

const musicRouteUnavailable = JSON.parse(JSON.stringify(complete));
musicRouteUnavailable.assistant.media.generated_music.direct_endpoint.route_available = false;
assert.equal(client.getGatewayFlowEditorReadiness(musicRouteUnavailable).optional.generatedMusic, false);

const videoRouteUnavailable = JSON.parse(JSON.stringify(complete));
videoRouteUnavailable.assistant.media.generated_video.direct_endpoint.route_available = false;
assert.equal(client.getGatewayFlowEditorReadiness(videoRouteUnavailable).optional.generatedVideo, false);

const imageToVideoReadinessUnavailable = JSON.parse(JSON.stringify(complete));
imageToVideoReadinessUnavailable.common.readiness.surfaces.media.image_to_video = {
  available: false,
  route_available: true,
  configured: true,
  workflow_available: false,
};
assert.equal(client.getGatewayFlowEditorReadiness(imageToVideoReadinessUnavailable).optional.imageToVideo, false);

const musicReadinessUnavailable = JSON.parse(JSON.stringify(complete));
musicReadinessUnavailable.common.readiness.surfaces.media.generated_music = {
  available: false,
  route_available: false,
  configured: true,
  workflow_available: false,
};
assert.equal(client.getGatewayFlowEditorReadiness(musicReadinessUnavailable).optional.generatedMusic, false);

const voiceWorkflowReadinessUnavailable = JSON.parse(JSON.stringify(complete));
voiceWorkflowReadinessUnavailable.common.readiness.surfaces.media.generated_voice.workflow_available = false;
assert.equal(client.getGatewayFlowEditorReadiness(voiceWorkflowReadinessUnavailable).optional.generatedVoice, false);

const residencyReadinessUnavailable = JSON.parse(JSON.stringify(complete));
residencyReadinessUnavailable.common.readiness.surfaces.model_residency.route_available = false;
assert.equal(client.getGatewayFlowEditorReadiness(residencyReadinessUnavailable).optional.modelResidency, false);

const legacyWithoutReadiness = JSON.parse(JSON.stringify(complete));
delete legacyWithoutReadiness.common.readiness;
assert.equal(client.getGatewayFlowEditorReadiness(legacyWithoutReadiness).optional.generatedMusic, true);

const legacyDirectMediaDescriptor = JSON.parse(JSON.stringify(complete));
delete legacyDirectMediaDescriptor.common.readiness;
delete legacyDirectMediaDescriptor.assistant.media.generated_music.direct_endpoint.available;
assert.equal(client.getGatewayFlowEditorReadiness(legacyDirectMediaDescriptor).optional.generatedMusic, true);
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


def test_ledger_progress_events_do_not_complete_running_nodes() -> None:
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

const src = fs.readFileSync('web/frontend/src/utils/ledgerEvents.ts', 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, require, console });
const ledger = module.exports;

const state = ledger.createLedgerMappingState();
const start = ledger.mapLedgerRecordToEvents({
  run_id: 'run-1',
  node_id: 'video-node',
  step_id: 'step-video',
  status: 'started',
  started_at: '2026-05-26T00:00:00Z',
  effect: { type: 'llm_call' },
}, state);
assert.equal(start[0].type, 'node_start');

const progress = ledger.mapLedgerRecordToEvents({
  run_id: 'run-1',
  node_id: 'video-node',
  step_id: 'progress-1',
  status: 'completed',
  ended_at: '2026-05-26T00:00:10Z',
  effect: { type: 'emit_event', payload: { name: 'abstract.progress', payload: { node_id: 'video-node', step_id: 'step-video', frame: 12, total_frames: 41, progress: 0.29 } } },
  result: { emitted: true, name: 'abstract.progress', payload: { node_id: 'video-node', step_id: 'step-video', frame: 12, total_frames: 41, progress: 0.29 } },
}, state);
assert.deepEqual(progress.map((event) => event.type), ['node_progress', 'trace_update']);
assert.equal(progress[0].nodeId, 'video-node');
assert.equal(progress[0].stepId, 'step-video');
assert.equal(progress[0].progress.frame, 12);

const complete = ledger.mapLedgerRecordToEvents({
  run_id: 'run-1',
  node_id: 'video-node',
  step_id: 'step-video',
  status: 'completed',
  started_at: '2026-05-26T00:00:00Z',
  ended_at: '2026-05-26T00:01:00Z',
  effect: { type: 'llm_call' },
  result: { video_artifact: { artifact_id: 'vid-1', content_type: 'video/mp4', modality: 'video' } },
}, state);
assert.equal(complete[0].type, 'node_complete');
assert.equal(complete[0].nodeId, 'video-node');
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

    for node_type in (
        "generate_image",
        "edit_image",
        "image_to_image",
        "generate_video",
        "text_to_video",
        "image_to_video",
        "generate_voice",
        "generate_music",
        "transcribe_audio",
        "listen_voice",
    ):
        assert f"'{node_type}'" in flow_types
        assert f"type: '{node_type}'" in node_templates

    assert "category: 'media'" in node_templates
    assert "label: 'Media'" in node_templates
    assert "CORE_NODES.filter((n) => n.category === 'media')" in node_templates
    node_palette = (FRONTEND / "src" / "components" / "NodePalette.tsx").read_text(encoding="utf-8")
    assert "media: true" in node_palette
    assert "image_artifact" in node_templates
    assert "source_image" in node_templates
    assert "mask_artifact" in node_templates
    assert "video_artifact" in node_templates
    assert "audio_artifact" in node_templates
    assert "music_artifact" in node_templates
    assert "{ id: 'artifact_ref', label: 'artifact_ref', type: 'artifact' }" in node_templates
    flow_types = (FRONTEND / "src" / "types" / "flow.ts").read_text(encoding="utf-8")
    assert "artifact_text: '#D946EF'" in flow_types
    assert "label: 'Artifacts'" in node_templates
    for artifact_label in ("Text Artifact", "Image Artifact", "Voice Artifact", "Music Artifact", "Video Artifact"):
        assert artifact_label in node_templates
    assert "artifactLiteralDefault" in node_templates
    assert "$artifact" in node_templates
    assert "image_provider" in flow_types
    assert "image_model" in flow_types
    assert "tts_model" in flow_types
    assert "stt_model" in flow_types
    assert "music_provider" in flow_types
    assert "music_model" in flow_types
    assert "video_provider" in flow_types
    assert "video_model" in flow_types
    assert "music_backend" not in flow_types
    assert "strength" in flow_types
    assert "enhance_prompt" in flow_types
    assert "composition_plan" in flow_types
    assert "runtime_provider" in flow_types
    assert "runtime_model" in flow_types
    assert "{ id: 'image_provider'" in node_templates
    assert "{ id: 'image_model'" in node_templates
    assert "{ id: 'tts_model'" in node_templates
    assert "{ id: 'stt_model'" in node_templates
    assert "{ id: 'music_provider'" in node_templates
    assert "{ id: 'music_model'" in node_templates
    assert "{ id: 'video_provider'" in node_templates
    assert "{ id: 'video_model'" in node_templates
    assert "{ id: 'music_backend'" not in node_templates
    assert "{ id: 'enhance_prompt'" in node_templates
    assert "{ id: 'structure_prompt', label: 'structure', type: 'boolean' }" in node_templates
    assert "{ id: 'composition_plan'" in node_templates
    properties_panel = (FRONTEND / "src" / "components" / "PropertiesPanel.tsx").read_text(encoding="utf-8")
    assert "data.effectConfig?.image_provider" in properties_panel
    assert "Gateway Media" not in properties_panel
    assert "MEDIA_PIN_DEFAULT_IDS" in properties_panel
    assert "patchMediaDefaults" in properties_panel
    assert "image_model: cleanModel" in properties_panel
    assert "data.effectConfig?.tts_model" in properties_panel
    assert "data.effectConfig?.stt_model" in properties_panel
    assert "data.effectConfig?.music_model" in properties_panel
    assert "data.effectConfig?.music_backend" not in properties_panel
    assert "ArtifactLiteralPanel" in properties_panel
    assert "Select a local file to upload it into Gateway artifacts." in properties_panel
    assert "'/api/gateway/attachments/upload'" in properties_panel
    assert "ArtifactPlayer" in properties_panel
    assert "editedImageProviderModelsTask" in properties_panel
    assert "Search STT models…" in properties_panel
    assert "Search music models…" in properties_panel
    assert "Optional media/voice provider id." in node_templates
    assert "Optional audio/STT provider id." in node_templates
    assert "Optional Gateway music backend/provider." in node_templates
    run_modal = (FRONTEND / "src" / "components" / "RunFlowModal.tsx").read_text(encoding="utf-8")
    assert "Search music providers…" in run_modal
    assert "Search music models…" in run_modal
    assert "abstract.media.video.generated" in run_modal
    assert "Generated video" in run_modal
    assert "node_progress" in run_modal
    assert "abstract.media.music.generated" in run_modal
    assert "Generated music" in run_modal
    assert "payloadRaw.artifact_ref" in run_modal
    base_node = (FRONTEND / "src" / "components" / "nodes" / "BaseNode.tsx").read_text(encoding="utf-8")
    assert "currentImageProviderModelsTask" in base_node
    assert "currentVideoProviderModelsTask" in base_node
    assert "currentVisionProviderModelsTask" in base_node
    assert "Search video providers…" in base_node
    assert "Search video models…" in base_node
    assert "addImageProvidersFromCatalog" in base_node
    assert "record.models_by_provider" in base_node
    assert "record.available_providers" in base_node
    assert "advancedMusicInputPins" not in base_node
    assert "mediaPinDisclosure" in base_node
    assert "showAdvancedMediaPins" in base_node
    assert "pin-disclosure-button" in base_node
    artifact_player = (FRONTEND / "src" / "components" / "ArtifactPlayer.tsx").read_text(encoding="utf-8")
    assert "export function ArtifactPlayer" in artifact_player
    assert "export function useArtifactObjectUrl" in artifact_player
    assert "'/api/gateway/runs/{run_id}/artifacts/{artifact_id}/content'" in artifact_player
    palette_css = (FRONTEND / "src" / "styles" / "palette.css").read_text(encoding="utf-8")
    assert ".artifact-literal-editor" in palette_css
    assert ".artifact-player-image" in palette_css
    use_flow = (FRONTEND / "src" / "hooks" / "useFlow.ts").read_text(encoding="utf-8")
    assert "const reorderOutputs = (canonical: Pin[]): Pin[]" in use_flow
    assert "getNodeTemplate(data.nodeType)?.outputs" in use_flow
    assert "type: 'artifact_image' as const" in use_flow
    assert "type: 'artifact_audio' as const" in use_flow


def test_frontend_media_nodes_use_shared_advanced_pin_presentation() -> None:
    if not shutil.which("node"):
        pytest.skip("node is not installed")
    typescript = FRONTEND / "node_modules" / "typescript"
    if not typescript.exists():
        pytest.skip("frontend TypeScript dependency is not installed")

    helper = (FRONTEND / "src" / "utils" / "mediaPinDisclosure.ts").read_text(encoding="utf-8")
    base_node = (FRONTEND / "src" / "components" / "nodes" / "BaseNode.tsx").read_text(encoding="utf-8")
    properties_panel = (FRONTEND / "src" / "components" / "PropertiesPanel.tsx").read_text(encoding="utf-8")
    nodes_css = (FRONTEND / "src" / "styles" / "nodes.css").read_text(encoding="utf-8")
    app_css = (FRONTEND / "src" / "styles" / "index.css").read_text(encoding="utf-8")

    for node_type in (
        "generate_image",
        "edit_image",
        "image_to_image",
        "generate_video",
        "text_to_video",
        "image_to_video",
        "generate_voice",
        "generate_music",
        "transcribe_audio",
        "listen_voice",
    ):
        assert node_type in helper

    assert "advancedMusicInputPins" not in base_node
    assert "getVisibleMediaPins" in base_node
    assert "countHiddenAdvancedMediaPins" in base_node
    assert "connectedOutputPinIds" in base_node
    assert "renderedPinKey" in base_node
    assert "updateNodeInternals(id);" in base_node
    assert "isTtsSpeedPin" in base_node
    assert "pin-disclosure-button" in base_node
    assert "Show optional tuning and diagnostic pins" in base_node
    assert "imageProviderPinConnected" in base_node
    assert "|| imageProviderPinConnected) return;" in base_node
    assert "Gateway Media" not in properties_panel
    assert "Media capability properties" not in properties_panel
    assert "MEDIA_PIN_DEFAULT_IDS" in properties_panel
    assert "patchMediaDefaults" in properties_panel
    assert "Search image providers…" in properties_panel
    assert "Search TTS providers…" in properties_panel
    assert "Search STT providers…" in properties_panel
    assert "Search music providers…" in properties_panel
    assert "Search video providers…" in properties_panel
    assert "Search video models…" in properties_panel
    assert ".pin-disclosure-row" in nodes_css
    assert ".pin-disclosure-count" in nodes_css
    assert "backdrop-filter: blur" not in app_css

    script = r"""
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require(path.resolve('web/frontend/node_modules/typescript'));

const src = fs.readFileSync('web/frontend/src/utils/mediaPinDisclosure.ts', 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, require, console });
const media = module.exports;

const inputs = [
  { id: 'exec-in', type: 'execution' },
  { id: 'prompt', type: 'string' },
  { id: 'music_provider', type: 'provider_music' },
  { id: 'music_model', type: 'model' },
  { id: 'duration_s', type: 'number' },
  { id: 'seed', type: 'number' },
  { id: 'guidance_scale', type: 'number' },
];
assert.equal(media.isMediaNodeType('generate_music'), true);
assert.equal(media.isAdvancedMediaPin('generate_music', 'seed', 'input'), true);
assert.equal(media.isAdvancedMediaPin('generate_music', 'prompt', 'input'), false);
assert.deepEqual(
  media.getVisibleMediaPins('generate_music', 'input', inputs, new Set(), false).map((pin) => pin.id),
  ['exec-in', 'prompt', 'music_provider', 'music_model', 'duration_s']
);
assert.deepEqual(
  media.getVisibleMediaPins('generate_music', 'input', inputs, new Set(['seed']), false).map((pin) => pin.id),
  ['exec-in', 'prompt', 'music_provider', 'music_model', 'duration_s', 'seed']
);
assert.deepEqual(
  media.getVisibleMediaPins('generate_music', 'input', inputs, new Set(), true).map((pin) => pin.id),
  ['exec-in', 'prompt', 'music_provider', 'music_model', 'duration_s', 'seed', 'guidance_scale']
);
assert.equal(media.countHiddenAdvancedMediaPins('generate_music', 'input', inputs, new Set(['seed']), false), 1);

const videoInputs = [
  { id: 'exec-in', type: 'execution' },
  { id: 'prompt', type: 'string' },
  { id: 'video_provider', type: 'provider_video' },
  { id: 'video_model', type: 'model_video' },
  { id: 'format', type: 'string' },
  { id: 'frames', type: 'number' },
  { id: 'fps', type: 'number' },
  { id: 'seed', type: 'number' },
  { id: 'guidance_scale', type: 'number' },
];
assert.equal(media.isMediaNodeType('generate_video'), true);
assert.equal(media.isAdvancedMediaPin('generate_video', 'seed', 'input'), true);
assert.equal(media.isAdvancedMediaPin('generate_video', 'frames', 'input'), false);
assert.deepEqual(
  media.getVisibleMediaPins('generate_video', 'input', videoInputs, new Set(), false).map((pin) => pin.id),
  ['exec-in', 'prompt', 'video_provider', 'video_model', 'format', 'frames', 'fps']
);
assert.deepEqual(
  media.getVisibleMediaPins('generate_video', 'input', videoInputs, new Set(), true).map((pin) => pin.id),
  ['exec-in', 'prompt', 'video_provider', 'video_model', 'format', 'frames', 'fps', 'seed', 'guidance_scale']
);

const voiceInputs = [
  { id: 'exec-in', type: 'execution' },
  { id: 'text', type: 'string' },
  { id: 'tts_provider', type: 'provider_voice' },
  { id: 'tts_model', type: 'model' },
  { id: 'voice', type: 'string' },
  { id: 'profile', type: 'string' },
  { id: 'quality_preset', type: 'string' },
  { id: 'format', type: 'string' },
  { id: 'speed', type: 'number' },
  { id: 'instructions', type: 'string' },
];
assert.equal(media.isAdvancedMediaPin('generate_voice', 'speed', 'input'), false);
assert.equal(media.isAdvancedMediaPin('generate_voice', 'profile', 'input'), true);
assert.deepEqual(
  media.getVisibleMediaPins('generate_voice', 'input', voiceInputs, new Set(), false).map((pin) => pin.id),
  ['exec-in', 'text', 'tts_provider', 'tts_model', 'voice', 'quality_preset', 'format', 'speed']
);

const outputs = [
  { id: 'exec-out', type: 'execution' },
  { id: 'music_artifact', type: 'object' },
  { id: 'artifact_id', type: 'string' },
  { id: 'meta', type: 'object' },
  { id: 'success', type: 'boolean' },
];
assert.deepEqual(
  media.getVisibleMediaPins('generate_music', 'output', outputs, new Set(), false).map((pin) => pin.id),
  ['exec-out', 'music_artifact', 'success']
);
assert.deepEqual(
  media.getVisibleMediaPins('generate_music', 'output', outputs, new Set(['artifact_id']), false).map((pin) => pin.id),
  ['exec-out', 'music_artifact', 'artifact_id', 'success']
);
assert.deepEqual(inputs.map((pin) => pin.id), ['exec-in', 'prompt', 'music_provider', 'music_model', 'duration_s', 'seed', 'guidance_scale']);
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr + result.stdout


def test_frontend_code_node_editor_layout_and_contract_are_explicit() -> None:
    node_templates = (FRONTEND / "src" / "types" / "nodes.ts").read_text(encoding="utf-8")
    code_modal = (FRONTEND / "src" / "components" / "CodeEditorModal.tsx").read_text(encoding="utf-8")
    base_node = (FRONTEND / "src" / "components" / "nodes" / "BaseNode.tsx").read_text(encoding="utf-8")
    css = (FRONTEND / "src" / "styles" / "index.css").read_text(encoding="utf-8")

    assert "label: 'Code'" in node_templates
    assert "Python Code" not in node_templates
    assert "id: 'permissions'" in node_templates
    assert "{ id: 'output', label: 'output', type: 'any'" in node_templates
    assert "{ id: 'success', label: 'success', type: 'boolean'" in node_templates
    assert "id: 'execution'" in node_templates
    assert "title=\"Edit Python code\"" not in base_node
    assert "title=\"Edit code\"" in base_node
    assert "result-open" in code_modal
    assert "formatSimulationResult" in code_modal
    assert "showRawResult" in code_modal
    assert "paramsSignature" in code_modal
    assert "af-code-editor-open" in code_modal
    assert "code-result-terminal" in code_modal
    assert "code-result-terminal" in css
    assert "body.af-code-editor-open .af-tooltip-bubble" in css
    assert "z-index: 100000;" in css
    assert "grid-template-rows: minmax(140px, 1fr) max-content;" in css
    assert "grid-template-rows: minmax(0, 1fr) clamp(180px, 24vh, 280px);" in css
    assert "resize: none;" in css


def test_frontend_tooltips_dismiss_hover_state_on_editor_interaction() -> None:
    tooltip = (FRONTEND / "src" / "components" / "AfTooltip.tsx").read_text(encoding="utf-8")

    assert "const dismissHover = useCallback" in tooltip
    assert "setHovering(false);" in tooltip
    assert "_hoverLeave(tooltipId);" in tooltip
    assert "onPointerDownCapture" in tooltip
    assert "document.addEventListener('pointerdown', onPointerDown, true);" in tooltip
    assert "document.addEventListener('focusin', onFocusIn, true);" in tooltip
    assert "window.addEventListener('scroll', onCanvasInteraction, true);" in tooltip


def test_frontend_variable_name_selector_avoids_native_browser_prompt() -> None:
    base_node = (FRONTEND / "src" / "components" / "nodes" / "BaseNode.tsx").read_text(encoding="utf-8")
    af_select = (FRONTEND / "src" / "components" / "inputs" / "AfSelect.tsx").read_text(encoding="utf-8")
    variable_names = (FRONTEND / "src" / "utils" / "variableNames.ts").read_text(encoding="utf-8")
    ui_kit = ROOT.parent / "abstractuic" / "ui-kit"
    ui_kit_select = (ui_kit / "src" / "af_select.tsx").read_text(encoding="utf-8")
    ui_kit_theme = (ui_kit / "src" / "theme.css").read_text(encoding="utf-8")
    frontend_sources = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (FRONTEND / "src").rglob("*")
        if path.suffix in {".ts", ".tsx"}
    )

    assert "window.prompt" not in frontend_sources
    assert "window.confirm" not in frontend_sources
    assert "window.alert" not in frontend_sources
    assert "__af_create_var__" not in base_node
    assert "Create new…" not in base_node
    assert 'key="var-name"' in base_node
    assert "allowCustom" in base_node
    assert "Search or type variable…" in base_node
    assert "onChange={(v) => setVariableName(v || '')}" in base_node
    assert "validateCustomValue={(v) => validateVariableName(v)}" in base_node
    assert "variableNameCustomOptionLabel" in base_node
    assert "af-bool-var-names" not in base_node
    assert "af-var-decl-names" not in base_node
    assert "<datalist" not in base_node[base_node.index("const BoolVarInline") : base_node.index("const VarDeclInline")]
    assert "<datalist" not in base_node[base_node.index("const VarDeclInline") : base_node.index("export const BaseNode")]
    assert "validateCustomValue" in af_select
    assert "customOptionLabel" in af_select
    assert "af-select-custom-error" in af_select
    assert "af-select-option-reason" in af_select
    assert "aria-disabled" in af_select
    assert "validateVariableName" in variable_names
    assert "VARIABLE_SEGMENT_RE" in variable_names
    assert "validateCustomValue" in ui_kit_select
    assert "customOptionLabel" in ui_kit_select
    assert "af-select-custom-error" in ui_kit_theme
    assert "af-select-option--disabled" in ui_kit_theme


def test_frontend_variable_name_validation_contract() -> None:
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

const src = fs.readFileSync('web/frontend/src/utils/variableNames.ts', 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, require, console });
const vars = module.exports;

for (const value of ['state', 'user_name', 'state.user_name', 'state.user_2']) {
  assert.equal(vars.validateVariableName(value), null, value);
}
for (const value of ['', '   ', '_temp', '123name', 'user name', 'state..name', '.state', 'state.', 'state-name']) {
  assert.equal(typeof vars.validateVariableName(value), 'string', value);
}
assert.equal(vars.normalizeVariableName(' state.user '), 'state.user');
assert.equal(vars.variableNameCustomOptionLabel('state.user'), 'Create variable "state.user"');
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr + result.stdout


def test_gateway_catalog_helpers_accept_canonical_catalog_envelope() -> None:
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

const src = fs.readFileSync('web/frontend/src/utils/gatewayCatalog.ts', 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, require, console });
const catalog = module.exports;

const payload = {
  catalog: {
    contract: 'gateway_catalog_v1',
    version: 1,
    kind: 'model_catalog',
    primary_items_field: 'items',
  },
  items: [
    {
      id: 'ACE-Step/Ace-Step1.5',
      provider_id: 'acestep',
      display_name: 'ACE-Step 1.5 Turbo',
      model_id: 'ACE-Step/Ace-Step1.5',
      tasks: ['text_to_music'],
    },
    {
      id: 'ACE-Step/acestep-v15-base',
      provider_id: 'acestep',
      display_name: 'ACE-Step 1.5 Base',
      model_id: 'ACE-Step/acestep-v15-base',
      tasks: ['text_to_music'],
    },
    {
      id: 'ACE-Step/acestep-v15-sft',
      provider_id: 'acestep',
      display_name: 'ACE-Step 1.5 SFT',
      model_id: 'ACE-Step/acestep-v15-sft',
      tasks: ['text_to_music'],
    },
    {
      id: 'ACE-Step/acestep-v15-xl-turbo-diffusers',
      provider_id: 'acestep',
      display_name: 'ACE Step XL Turbo',
      model_id: 'ACE-Step/acestep-v15-xl-turbo-diffusers',
      tasks: ['text_to_music'],
    },
    {
      id: 'stabilityai/stable-audio-3-small-music',
      provider_id: 'stable-audio-3',
      display_name: 'Stable Audio 3 Small Music',
      model_id: 'stabilityai/stable-audio-3-small-music',
      tasks: ['text_to_music'],
    },
  ],
};

assert.equal(catalog.isGatewayCatalogV1(payload), true);
assert.deepEqual(
  catalog.providerOptionsFromGatewayCatalog(payload).map((option) => option.value),
  ['acestep', 'stable-audio-3']
);
assert.deepEqual(
  catalog.modelOptionsFromGatewayCatalog(payload, 'acestep').map((option) => option.value),
  [
    'ACE-Step/Ace-Step1.5',
    'ACE-Step/acestep-v15-base',
    'ACE-Step/acestep-v15-sft',
    'ACE-Step/acestep-v15-xl-turbo-diffusers',
  ]
);
assert.deepEqual(
  catalog.modelOptionsFromGatewayCatalog(payload, 'stable-audio-3').map((option) => option.value),
  ['stabilityai/stable-audio-3-small-music']
);

const legacy = {
  providers: ['lmstudio'],
  models_by_provider: {
    lmstudio: [{ id: 'qwen/qwen3.5-35b-a3b', label: 'Qwen 3.5 35B' }],
  },
};
assert.deepEqual(catalog.providerOptionsFromGatewayCatalog(legacy, ['providers']).map((option) => option.value), ['lmstudio']);
assert.deepEqual(
  catalog.modelOptionsFromGatewayCatalog(legacy, 'lmstudio', [], ['models_by_provider']).map((option) => option.value),
  ['qwen/qwen3.5-35b-a3b']
);
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr + result.stdout


def test_generate_music_serialization_stays_native_and_imports_legacy_lowering() -> None:
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

assert.equal(fs.existsSync('web/frontend/src/utils/runtimeMusicCompat.ts'), false);
const serializationSrc = fs.readFileSync('web/frontend/src/utils/serialization.ts', 'utf8');
assert.equal(serializationSrc.includes('lowerGenerateMusicNodesForRuntime'), false);
const useFlowSrc = fs.readFileSync('web/frontend/src/hooks/useFlow.ts', 'utf8');
assert(useFlowSrc.includes('const edges: Edge[] = rawEdges.map'));
assert(useFlowSrc.includes("getNodeTemplate('generate_music')?.inputs"));

const src = fs.readFileSync('web/frontend/src/utils/visualFlowCompat.ts', 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, require, console });
const compat = module.exports;

const nodes = [
  {
    id: 'start',
    type: 'on_flow_start',
    position: { x: 0, y: 0 },
    data: { nodeType: 'on_flow_start' },
  },
  {
    id: 'music__af_output_spec',
    type: 'make_object',
    position: { x: 180, y: 160 },
    data: {
      nodeType: 'make_object',
      _abstractflowRuntimeCompat: {
        kind: 'abstractflow.runtime_compat.generate_music.output_spec.v1',
        forNodeId: 'music',
      },
      pinDefaults: {
        modality: 'music',
        task: 'music_generation',
        format: 'wav',
      },
    },
  },
  {
    id: 'music',
    type: 'llm_call',
    position: { x: 200, y: 0 },
    data: {
      nodeType: 'generate_music',
      label: 'Generate Music',
      _abstractflowRuntimeCompat: {
        kind: 'abstractflow.runtime_compat.generate_music.facade.v1',
      },
      effectConfig: {
        output: {
          modality: 'music',
          task: 'music_generation',
          format: 'wav',
          provider: 'stability-ai',
          model: 'stabilityai/stable-audio-3-small-music',
          backend: 'stable-audio-3',
          duration_s: 10,
          instrumental: true,
        },
      },
      inputs: [],
      outputs: [],
    },
  },
];
const edges = [
  { id: 'exec', source: 'start', sourceHandle: 'exec-out', target: 'music', targetHandle: 'exec-in' },
  { id: 'prompt', source: 'start', sourceHandle: 'prompt', target: 'music', targetHandle: 'prompt' },
  { id: 'duration', source: 'start', sourceHandle: 'duration', target: 'music__af_output_spec', targetHandle: 'duration_s' },
  { id: 'backend', source: 'start', sourceHandle: 'backend', target: 'music__af_output_spec', targetHandle: 'backend' },
  { id: 'output', source: 'music__af_output_spec', sourceHandle: 'result', target: 'music', targetHandle: 'output' },
  { id: 'artifact', source: 'music', sourceHandle: 'artifact_ref', target: 'end', targetHandle: 'result' },
];

const normalized = compat.normalizeLegacyMusicCompatVisualFlow(nodes, edges);
assert.equal(normalized.nodes.some((node) => compat.isLegacyMusicCompatNode(node)), false);
assert.equal(normalized.nodes.some((node) => node.id === 'music__af_output_spec'), false);

const music = normalized.nodes.find((node) => node.id === 'music');
assert.equal(music.type, 'generate_music');
assert.equal(music.data.nodeType, 'generate_music');
assert.equal(music.data.effectConfig.output, undefined);
assert.equal(music.data.effectConfig.music_provider, 'stable-audio-3');
assert.equal(music.data.effectConfig.music_model, 'stabilityai/stable-audio-3-small-music');
assert.equal(music.data.effectConfig.music_backend, undefined);
assert.equal(music.data.effectConfig.duration_s, 10);
assert.equal(music.data.effectConfig.instrumental, true);
assert(music.data.outputs.some((pin) => pin.id === 'music_artifact'));
assert(music.data.outputs.some((pin) => pin.id === 'audio_artifact'));
assert(normalized.edges.some((edge) => edge.id === 'duration' && edge.target === 'music' && edge.targetHandle === 'duration_s'));
assert(normalized.edges.some((edge) => edge.id === 'backend' && edge.target === 'music' && edge.targetHandle === 'music_provider'));
assert(normalized.edges.some((edge) => edge.id === 'artifact' && edge.source === 'music' && edge.sourceHandle === 'music_artifact'));
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr + result.stdout


def test_frontend_exposes_model_residency_controls() -> None:
    flow_types = (FRONTEND / "src" / "types" / "flow.ts").read_text(encoding="utf-8")
    node_templates = (FRONTEND / "src" / "types" / "nodes.ts").read_text(encoding="utf-8")
    gateway_client = (FRONTEND / "src" / "utils" / "gatewayClient.ts").read_text(encoding="utf-8")
    toolbar = (FRONTEND / "src" / "components" / "Toolbar.tsx").read_text(encoding="utf-8")
    panel = (FRONTEND / "src" / "components" / "ModelResidencyPanel.tsx").read_text(encoding="utf-8")
    base_node = (FRONTEND / "src" / "components" / "nodes" / "BaseNode.tsx").read_text(encoding="utf-8")
    af_select = (FRONTEND / "src" / "components" / "inputs" / "AfSelect.tsx").read_text(encoding="utf-8")
    graph_util = (FRONTEND / "src" / "utils" / "modelResidencyGraph.ts").read_text(encoding="utf-8")
    css = (FRONTEND / "src" / "styles" / "index.css").read_text(encoding="utf-8")

    assert "'model_residency'" in flow_types
    assert "type: 'model_residency'" in node_templates
    assert "Model Residency" in node_templates
    assert "listing, loading, and unloading" in node_templates
    assert "operation: 'load'" in node_templates
    assert "task: 'text_generation'" in node_templates
    assert "affected_models" in node_templates
    assert "keep_loaded" not in node_templates
    assert "common?.model_residency" in gateway_client
    assert "modelResidency" in gateway_client
    assert "embedding_models" in gateway_client
    assert "ModelResidencyPanel" in toolbar
    assert "Model Residency" in panel
    assert "Provider-loaded models and execution defaults are tracked separately." in panel
    assert "window.confirm" not in panel
    assert "Keep loaded" not in panel
    assert "model-residency-confirm" in panel
    assert "Loaded models" in panel
    assert "Defaults" in panel
    assert "providerResidentRows" in panel
    assert "defaultConfigRows" in panel
    assert "useLoadedModels" in panel
    assert "descriptorEndpointAvailable" in panel
    assert "residencyEndpointAvailable" in panel
    assert "residencyControlsAvailable" in panel
    assert "capabilityDefaultsAvailable" in panel
    assert "loadAvailable" in panel
    assert "unloadAvailable" in panel
    assert "Gateway does not advertise model residency or capability-default controls." in panel
    assert "Loaded-model listing is not available on this Gateway runtime." in panel
    assert "Speech provider" in panel
    assert "Transcription provider" in panel
    assert "Music provider" in panel
    assert "task === 'tts'" in panel
    assert "task === 'stt'" in panel
    assert "task === 'music_generation'" in panel
    assert "'text_to_video'" in panel
    assert "'image_to_video'" in panel
    assert "function isVisionCatalogTask" in panel
    assert "function visionProviderModelsTask" in panel
    assert "task: selectedVisionTask" in panel
    assert "Video provider" in panel
    assert "Video model" in panel
    assert "runtime client cached" in panel
    assert "provider not loaded" in panel
    assert "Capability route defaults are execution-host configuration" in panel
    assert "capabilityDefaultsQuery" in panel
    assert "partial config" in panel
    assert "Set Execution Default" in panel
    assert "defaultCatalogTask" in panel
    assert "embedding_text" in panel
    assert "kind === 'embedding' && modality === 'text'" in panel
    assert "defaultProviderOptions" in panel
    assert "defaultModelOptions" in panel
    assert "defaultEmbeddingProviderCatalogQuery" in panel
    assert "defaultEmbeddingModelsQuery" in panel
    assert "providers_only: true" in panel
    assert "defaultTtsProviderCatalogQuery" in panel
    assert "defaultTtsVoiceProviderCatalogQuery" not in panel
    assert "defaultTtsProviderModelCatalogQuery" not in panel
    assert "ttsVoiceCatalogQuery" not in panel
    assert "defaultProviderPlaceholder" in panel
    assert "defaultModelPlaceholder" in panel
    assert "provider: value, model: ''" in panel
    assert "placeholder=\"lmstudio\"" not in panel
    assert "Runtime configuration/cache records" in panel
    assert "canUnloadRow" in panel
    assert "residencyResultMessage" in panel
    assert "model-residency-tabs" in css
    assert "model-residency-defaults-table" in css
    assert "model-residency-confirm" in css
    assert "max-width: min(1080px, calc(100vw - 48px));" in css
    properties_panel = (FRONTEND / "src" / "components" / "PropertiesPanel.tsx").read_text(encoding="utf-8")
    assert "Model Residency" in properties_panel
    assert "Add load step before" in properties_panel
    assert "Add unload step after" in properties_panel
    assert "generate_voice" in properties_panel
    assert "transcribe_audio" in properties_panel
    assert "residencyProviderOptions" in properties_panel
    assert "Search providers…" in properties_panel
    assert "Search models…" in properties_panel
    assert "data.effectConfig?.tts_model, data.pinDefaults?.tts_model, data.effectConfig?.model" not in properties_panel
    assert "data.effectConfig?.stt_model, data.pinDefaults?.stt_model, data.effectConfig?.model" not in properties_panel
    assert "data.effectConfig?.music_model, data.pinDefaults?.music_model, data.effectConfig?.model" not in properties_panel
    assert "data.effectConfig?.image_model, data.pinDefaults?.image_model, data.effectConfig?.model" not in properties_panel
    assert "Load before" in base_node
    assert "Unload after" in base_node
    assert "{ value: 'tts', label: 'speech' }" in base_node
    assert "{ value: 'stt', label: 'transcription' }" in base_node
    assert "{ value: 'music_generation', label: 'music' }" in base_node
    assert "insertModelResidencyStep" in base_node
    assert "Dynamic provider/model is wired from pins." in base_node
    assert "loading && displayedOptions.length === 0" in af_select
    assert "Loading…" in af_select
    assert "request.providersOnly ? ttsProviderListQuery : ttsQuery" in base_node
    assert "!ttsModelsEndpoint" in base_node
    assert "request.scope === 'stt' && Boolean(sttModelsEndpoint)" in base_node
    assert "requestMediaCatalog('tts', { providersOnly: true });" in base_node
    assert "data.effectConfig?.tts_model, pinDefaults.tts_model, data.effectConfig?.model" not in base_node
    assert "data.effectConfig?.stt_model, pinDefaults.stt_model, data.effectConfig?.model" not in base_node
    assert "data.effectConfig?.music_model, pinDefaults.music_model, data.effectConfig?.model" not in base_node
    assert "data.effectConfig?.image_model, pinDefaults.image_model, data.effectConfig?.model" not in base_node
    assert "export function insertModelResidencyStep" in graph_util
    assert "Load Model" in graph_util
    assert "Unload Model" in graph_util
    assert "modelResidencyTaskUnsupportedReason" in graph_util
    assert "modelResidencyTaskUnsupportedReason(gatewayContracts, 'image_generation')" in base_node
    assert "Gateway default ${residencyAuthoringTarget.task.replace(/_/g, ' ')}" in base_node
    assert "supports[clean] === false" not in properties_panel
    assert "supports[t] === false" not in panel
    assert "supports as Record<string, unknown>)[cleanTask] === false" not in graph_util
    node_palette = (FRONTEND / "src" / "components" / "NodePalette.tsx").read_text(encoding="utf-8")
    assert "n.description.toLowerCase().includes(term)" in node_palette
    assert 'key={`${template.type}:${template.label}`}' in node_palette


def test_run_modal_media_preview_source_guards_are_modality_aware() -> None:
    run_modal = (FRONTEND / "src" / "components" / "RunFlowModal.tsx").read_text(encoding="utf-8")

    assert "artifactLooksLikeImage" in run_modal
    assert "artifactLooksLikeAudio" in run_modal
    assert "payloadRaw.image_artifact ??" in run_modal
    assert "payloadRaw.audio_artifact ||" in run_modal
    assert "artifactLooksLikeImage(genericArtifact)" in run_modal
    assert "artifactLooksLikeAudio(genericAudioRecord)" in run_modal
    assert "fallbackSrcs" in run_modal
    artifact_player = (FRONTEND / "src" / "components" / "ArtifactPlayer.tsx").read_text(encoding="utf-8")
    assert "gatewayFetch(url, { timeoutMs: 0 })" in artifact_player


def test_run_modal_artifact_summary_preserves_loop_invocations() -> None:
    run_modal = (FRONTEND / "src" / "components" / "RunFlowModal.tsx").read_text(encoding="utf-8")
    artifact_player = (FRONTEND / "src" / "components" / "ArtifactPlayer.tsx").read_text(encoding="utf-8")

    assert "stepId: string; stepLabel: string" in run_modal
    assert "const key = `audio:${step.id}`" in run_modal
    assert "const key = `image:${step.id}`" in run_modal
    assert "const key = `video:${step.id}`" in run_modal
    assert "key={`${item.kind}:${item.stepId}:${item.preview.artifactId}`}" in run_modal
    assert "instanceKey={item.stepId}" in run_modal
    assert "instanceKey={selectedStep.id}" in run_modal
    assert "cacheKey?: string" in artifact_player
    assert "}, [cacheKey, contentType, fallbackSrcs, src]);" in artifact_player


def test_frontend_preflight_catches_required_media_inputs() -> None:
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

const cache = {};
function loadTs(rel) {
  const key = path.normalize(rel);
  if (cache[key]) return cache[key].exports;
  const src = fs.readFileSync(path.join('web/frontend/src', key), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = { exports: {} };
  cache[key] = module;
  const localRequire = (name) => {
    if (name === '../types/flow') {
      return { isEntryNodeType: (nodeType) => String(nodeType || '').startsWith('on_') };
    }
    if (name.startsWith('.')) {
      const next = `${path.normalize(path.join(path.dirname(key), name))}.ts`;
      return loadTs(next);
    }
    return require(name);
  };
  vm.runInNewContext(js, { module, exports: module.exports, require: localRequire, console });
  return module.exports;
}
const preflight = loadTs('utils/preflight.ts');

const nodes = [
  {
    id: 'start',
    type: 'custom',
    data: {
      nodeType: 'on_flow_start',
      label: 'Start',
      inputs: [],
      outputs: [{ id: 'exec-out', type: 'execution' }],
    },
  },
  {
    id: 'edit',
    type: 'custom',
    data: {
      nodeType: 'edit_image',
      label: 'Edit Image',
      inputs: [
        { id: 'exec-in', type: 'execution' },
        { id: 'prompt', type: 'string' },
        { id: 'image_artifact', type: 'artifact_image' },
      ],
      outputs: [{ id: 'exec-out', type: 'execution' }],
      effectConfig: { prompt: 'make it watercolor' },
    },
  },
];
const edges = [{ id: 'e', source: 'start', sourceHandle: 'exec-out', target: 'edit', targetHandle: 'exec-in' }];
const issues = preflight.computeRunPreflightIssues(nodes, edges);
assert(issues.some((issue) => issue.message === 'Missing required input: image_artifact'));

nodes[1].data.nodeType = 'image_to_video';
nodes[1].data.label = 'Image To Video';
nodes[1].data.effectConfig = { prompt: 'animate it' };
const videoIssues = preflight.computeRunPreflightIssues(nodes, edges);
assert(videoIssues.some((issue) => issue.message === 'Missing required input: source_image'));
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr + result.stdout


def test_frontend_gateway_authoring_capabilities_gate_palette_and_preflight() -> None:
    if not shutil.which("node"):
        pytest.skip("node is not installed")
    typescript = FRONTEND / "node_modules" / "typescript"
    if not typescript.exists():
        pytest.skip("frontend TypeScript dependency is not installed")

    node_templates = (FRONTEND / "src" / "types" / "nodes.ts").read_text(encoding="utf-8")
    node_palette = (FRONTEND / "src" / "components" / "NodePalette.tsx").read_text(encoding="utf-8")

    assert "gatewayCapability?: GatewayAuthoringCapability" in node_templates
    assert "gatewayCapability: NODE_GATEWAY_CAPABILITIES.generate_voice" in node_templates
    assert "gatewayCapability: NODE_GATEWAY_CAPABILITIES.generate_video" in node_templates
    assert "gatewayCapability: NODE_GATEWAY_CAPABILITIES.image_to_video" in node_templates
    assert "gatewayCapability: NODE_GATEWAY_CAPABILITIES.model_residency" in node_templates
    assert "gatewayAuthoringCapabilityStatus" in node_palette
    assert "data-gateway-capability" in node_palette
    assert "draggable={!disabled}" in node_palette
    assert "status && !status.available && !status.checking" in node_palette

    script = r"""
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require(path.resolve('web/frontend/node_modules/typescript'));

const cache = {};
function loadTs(rel) {
  const key = path.normalize(rel);
  if (cache[key]) return cache[key].exports;
  const src = fs.readFileSync(path.join('web/frontend/src', key), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = { exports: {} };
  cache[key] = module;
  const localRequire = (name) => {
    if (name === '../types/flow') {
      return { isEntryNodeType: (nodeType) => String(nodeType || '').startsWith('on_') };
    }
    if (name.startsWith('.')) {
      return loadTs(`${path.normalize(path.join(path.dirname(key), name))}.ts`);
    }
    return require(name);
  };
  vm.runInNewContext(js, { module, exports: module.exports, require: localRequire, console });
  return module.exports;
}

const preflight = loadTs('utils/preflight.ts');
const capabilities = loadTs('utils/nodeCapabilities.ts');
const client = loadTs('utils/gatewayClient.ts');

assert.equal(capabilities.gatewayCapabilityForNodeType('generate_voice'), 'generated_voice');
assert.equal(capabilities.gatewayCapabilityForNodeType('generate_video'), 'generated_video');
assert.equal(capabilities.gatewayCapabilityForNodeType('image_to_video'), 'image_to_video');
assert.equal(capabilities.gatewayCapabilityForNodeType('model_residency'), 'model_residency');

const optional = {
  providers: true,
  providerModels: true,
  tools: true,
  semantics: true,
  workspacePolicy: true,
  promptCacheSessions: true,
  promptCacheDurableBlocs: true,
  kgMemory: true,
  generatedImage: true,
  editedImage: true,
  generatedVideo: false,
  imageToVideo: true,
  generatedVoice: false,
  generatedMusic: true,
  attachmentsUpload: true,
  modelResidency: true,
};
const readiness = {
  ready: true,
  checks: [],
  operations: {},
  optional,
};

const status = client.gatewayAuthoringCapabilityStatus(readiness, 'generated_voice', { known: true });
assert.equal(status.available, false);
assert.equal(status.checking, false);
assert.equal(status.reason, 'Generate Voice is unavailable on this Gateway.');

const checking = client.gatewayAuthoringCapabilityStatus(readiness, 'generated_voice', { loading: true, known: true });
assert.equal(checking.available, true);
assert.equal(checking.checking, true);

const start = {
  id: 'start',
  data: {
    nodeType: 'on_flow_start',
    label: 'Start',
    inputs: [],
    outputs: [{ id: 'exec-out', label: '', type: 'execution' }],
  },
};
const voice = {
  id: 'voice',
  data: {
    nodeType: 'generate_voice',
    label: 'Generate Voice',
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'text', label: 'text', type: 'string' },
    ],
    outputs: [{ id: 'exec-out', label: '', type: 'execution' }],
    effectConfig: { text: 'hello' },
  },
};
const execEdges = [{ id: 'e1', source: 'start', sourceHandle: 'exec-out', target: 'voice', targetHandle: 'exec-in' }];

const issues = preflight.computeRunPreflightIssues([start, voice], execEdges, {
  gatewayReadiness: readiness,
  gatewayCapabilitiesKnown: true,
});
assert(issues.some((issue) => issue.message === 'Generate Voice is unavailable on this Gateway.'));

const loadingIssues = preflight.computeRunPreflightIssues([start, voice], execEdges, {
  gatewayReadiness: readiness,
  gatewayCapabilitiesKnown: true,
  gatewayCapabilitiesLoading: true,
});
assert(!loadingIssues.some((issue) => issue.message === 'Generate Voice is unavailable on this Gateway.'));

const unreachableIssues = preflight.computeRunPreflightIssues([start, voice], [], {
  gatewayReadiness: readiness,
  gatewayCapabilitiesKnown: true,
});
assert(!unreachableIssues.some((issue) => issue.message === 'Generate Voice is unavailable on this Gateway.'));
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr + result.stdout


def test_frontend_draft_run_lifecycle_is_explicit_and_testable() -> None:
    if not shutil.which("node"):
        pytest.skip("node is not installed")
    typescript = FRONTEND / "node_modules" / "typescript"
    if not typescript.exists():
        pytest.skip("frontend TypeScript dependency is not installed")

    use_websocket = (FRONTEND / "src" / "hooks" / "useWebSocket.ts").read_text(encoding="utf-8")
    toolbar = (FRONTEND / "src" / "components" / "Toolbar.tsx").read_text(encoding="utf-8")
    run_modal = (FRONTEND / "src" / "components" / "RunFlowModal.tsx").read_text(encoding="utf-8")
    run_history = (FRONTEND / "src" / "components" / "RunHistoryModal.tsx").read_text(encoding="utf-8")
    run_switcher = (FRONTEND / "src" / "components" / "RunSwitcherDropdown.tsx").read_text(encoding="utf-8")

    assert "draftBundleVersion" in use_websocket
    assert "run_lifecycle: args.runLifecycle" in use_websocket
    assert "_run_lifecycle" not in use_websocket
    assert "_abstractflow" not in use_websocket
    assert "bundle_version: 'dev'" not in use_websocket
    assert "'Run'" in toolbar
    assert "Open current run" in toolbar
    assert "Run Published" not in toolbar
    assert "resolveLatestPublishedBundleForFlow" not in toolbar
    assert "runPublishedFlow" in use_websocket
    assert "buildPublishedRunMetadata" in use_websocket
    assert "startBundleRun" in use_websocket
    assert "Gateway cannot run VisualFlows" in toolbar
    assert "▶ {runTitle}" in run_modal
    assert "Test Run" not in run_modal
    assert "Run Published" not in run_modal
    assert "New Run" in run_modal
    assert "New Test Run" not in run_modal
    assert "New Published Run" not in run_modal
    assert "Run Flow mini bar" not in run_modal
    assert "Show authoring tests" not in run_history
    assert "runs.filter((r) => !isDraftRunSummary(r))" not in run_history
    assert "include_drafts: true" in run_history
    assert "@dev" not in run_history
    assert "authoring test" not in run_history
    assert "isDraftRunSummary" not in run_switcher
    assert "include_drafts: true" in run_switcher

    script = r"""
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require(path.resolve('web/frontend/node_modules/typescript'));

const cache = {};
function loadTs(rel) {
  const key = path.normalize(rel);
  if (cache[key]) return cache[key].exports;
  const src = fs.readFileSync(path.join('web/frontend/src', key), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = { exports: {} };
  cache[key] = module;
  const localRequire = (name) => {
    if (name.startsWith('.')) {
      return loadTs(`${path.normalize(path.join(path.dirname(key), name))}.ts`);
    }
    return require(name);
  };
  vm.runInNewContext(js, { module, exports: module.exports, require: localRequire, console });
  return module.exports;
}

const lifecycle = loadTs('utils/runLifecycle.ts');
const gatewayRuns = loadTs('utils/gatewayRuns.ts');
const workflowBundles = loadTs('utils/workflowBundles.ts');

assert.equal(lifecycle.draftBundleVersion('Session ABC/123'), 'draft.session-abc-123');

const meta = lifecycle.buildDraftRunMetadata({
  editorSessionId: 'session-1',
  flowId: 'flow-1',
  bundleVersion: 'draft.session-1',
});
assert.deepEqual(meta, {
  source: 'abstractflow.editor',
  purpose: 'draft_test',
  visibility: 'private',
  retention: { mode: 'ephemeral' },
  editor_session_id: 'session-1',
  flow_id: 'flow-1',
  bundle_version: 'draft.session-1',
});

const publishedMeta = lifecycle.buildPublishedRunMetadata({
  flowId: 'flow-1',
  bundleId: 'bundle',
  bundleVersion: '1.2.3',
  bundleRef: 'bundle@1.2.3',
});
assert.deepEqual(publishedMeta, {
  source: 'abstractflow.editor',
  purpose: 'published_run',
  visibility: 'normal',
  retention: { mode: 'durable' },
  flow_id: 'flow-1',
  bundle_id: 'bundle',
  bundle_version: '1.2.3',
  bundle_ref: 'bundle@1.2.3',
});

assert.equal(workflowBundles.isDraftBundleVersion('draft.session-1'), true);
assert.equal(workflowBundles.isDraftBundleVersion('1.2.3'), false);
const selected = workflowBundles.selectLatestPublishedBundleForFlow([
  {
    bundle_id: 'agent',
    bundle_version: 'draft.session',
    bundle_ref: 'agent@draft.session',
    is_draft: true,
    latest_published_version: '1.2.3',
    metadata: { source: { root_flow_id: 'flow-1' } },
    entrypoints: [{ flow_id: 'flow-1', workflow_id: 'agent@draft.session:flow-1' }],
  },
  {
    bundle_id: 'agent',
    bundle_version: '1.2.2',
    bundle_ref: 'agent@1.2.2',
    is_draft: false,
    latest_published_version: '1.2.3',
    metadata: { source: { root_flow_id: 'flow-1' } },
    entrypoints: [{ flow_id: 'flow-1', workflow_id: 'agent@1.2.2:flow-1' }],
  },
  {
    bundle_id: 'agent',
    bundle_version: '1.2.3',
    bundle_ref: 'agent@1.2.3',
    is_draft: false,
    latest_published_version: '1.2.3',
    metadata: { source: { root_flow_id: 'flow-1' } },
    entrypoints: [{ flow_id: 'flow-1', workflow_id: 'agent@1.2.3:flow-1' }],
  },
], 'flow-1');
assert.deepEqual(selected, {
  flowId: 'flow-1',
  bundleId: 'agent',
  bundleVersion: '1.2.3',
  bundleRef: 'agent@1.2.3',
  createdAt: undefined,
});

const byWorkflow = gatewayRuns.mapGatewayRunSummary({
  run_id: 'r1',
  workflow_id: 'bundle@draft.session-1:flow-1',
  status: 'completed',
});
assert.equal(byWorkflow.is_draft, false);
assert.equal(gatewayRuns.isDraftRunSummary(byWorkflow), false);

const byLifecycle = gatewayRuns.mapGatewayRunSummary({
  run_id: 'r2',
  workflow_id: 'bundle@1.0.0:flow-1',
  status: 'completed',
  run_lifecycle: { purpose: 'draft_test' },
});
assert.equal(byLifecycle.is_draft, true);
assert.equal(gatewayRuns.isDraftRunSummary(byLifecycle), true);

const published = gatewayRuns.mapGatewayRunSummary({
  run_id: 'r3',
  workflow_id: 'bundle@1.0.0:flow-1',
  status: 'completed',
});
assert.equal(published.is_draft, false);
assert.equal(gatewayRuns.isDraftRunSummary(published), false);
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr + result.stdout


def test_frontend_media_artifact_validation_is_modality_aware() -> None:
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

const cache = {};
function loadTs(rel) {
  const key = path.normalize(rel);
  if (cache[key]) return cache[key].exports;
  const src = fs.readFileSync(path.join('web/frontend/src', key), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = { exports: {} };
  cache[key] = module;
  const localRequire = (name) => {
    if (name === '../types/flow') {
      return { isEntryNodeType: (nodeType) => String(nodeType || '').startsWith('on_') };
    }
    if (name.startsWith('.')) {
      return loadTs(`${path.normalize(path.join(path.dirname(key), name))}.ts`);
    }
    return require(name);
  };
  vm.runInNewContext(js, { module, exports: module.exports, require: localRequire, console });
  return module.exports;
}

const validation = loadTs('utils/validation.ts');
const preflight = loadTs('utils/preflight.ts');

const start = {
  id: 'start',
  data: {
    nodeType: 'on_flow_start',
    label: 'Start',
    inputs: [],
    outputs: [{ id: 'exec-out', label: '', type: 'execution' }],
  },
};
const image = {
  id: 'image',
  data: {
    nodeType: 'generate_image',
    label: 'Generate Image',
    inputs: [{ id: 'exec-in', label: '', type: 'execution' }],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'image_artifact', label: 'image_artifact', type: 'artifact_image' },
      { id: 'outputs', label: 'outputs', type: 'object' },
    ],
  },
};
const voice = {
  id: 'voice',
  data: {
    nodeType: 'generate_voice',
    label: 'Generate Voice',
    inputs: [{ id: 'exec-in', label: '', type: 'execution' }],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'audio_artifact', label: 'audio_artifact', type: 'artifact_audio' },
    ],
  },
};
const edit = {
  id: 'edit',
  data: {
    nodeType: 'edit_image',
    label: 'Edit Image',
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'image_artifact', label: 'image_artifact', type: 'artifact_image' },
    ],
    outputs: [{ id: 'exec-out', label: '', type: 'execution' }],
  },
};
const transcribe = {
  id: 'transcribe',
  data: {
    nodeType: 'transcribe_audio',
    label: 'Transcribe Audio',
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'audio_artifact', label: 'audio_artifact', type: 'artifact_audio' },
    ],
    outputs: [{ id: 'exec-out', label: '', type: 'execution' }],
  },
};

const nodes = [start, image, voice, edit, transcribe];
const connect = (source, sourceHandle, target, targetHandle) => ({ source, sourceHandle, target, targetHandle });

assert.equal(validation.validateConnection(nodes, [], connect('image', 'image_artifact', 'edit', 'image_artifact')), true);
assert.equal(validation.validateConnection(nodes, [], connect('voice', 'audio_artifact', 'transcribe', 'audio_artifact')), true);
assert.equal(validation.validateConnection(nodes, [], connect('image', 'image_artifact', 'transcribe', 'audio_artifact')), false);
assert.match(
  validation.getConnectionError(nodes, [], connect('image', 'image_artifact', 'transcribe', 'audio_artifact')),
  /Needs audio artifact, got image artifact/
);
assert.equal(validation.validateConnection(nodes, [], connect('voice', 'audio_artifact', 'edit', 'image_artifact')), false);
assert.equal(validation.validateConnection(nodes, [], connect('image', 'outputs', 'edit', 'image_artifact')), false);
assert.match(
  validation.getConnectionError(nodes, [], connect('image', 'outputs', 'edit', 'image_artifact')),
  /Needs image artifact, got object payload/
);

const edgeMismatch = preflight.computeRunPreflightIssues(
  [start, image, transcribe],
  [
    { id: 'e1', source: 'start', sourceHandle: 'exec-out', target: 'image', targetHandle: 'exec-in' },
    { id: 'e2', source: 'image', sourceHandle: 'exec-out', target: 'transcribe', targetHandle: 'exec-in' },
    { id: 'bad', source: 'image', sourceHandle: 'image_artifact', target: 'transcribe', targetHandle: 'audio_artifact' },
  ]
);
assert(edgeMismatch.some((issue) => issue.message === 'audio_artifact: Needs audio artifact, got image artifact.'));

const defaultMismatch = preflight.computeRunPreflightIssues(
  [
    start,
    {
      ...transcribe,
      data: {
        ...transcribe.data,
        effectConfig: { audio_artifact: { $artifact: 'img-1', content_type: 'image/png', modality: 'image' } },
      },
    },
  ],
  [{ id: 'e1', source: 'start', sourceHandle: 'exec-out', target: 'transcribe', targetHandle: 'exec-in' }]
);
assert(defaultMismatch.some((issue) => issue.message === 'audio_artifact: Needs audio artifact, got image artifact.'));
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr + result.stdout


def test_frontend_live_connection_feedback_uses_validation_contract() -> None:
    if not shutil.which("node"):
        pytest.skip("node is not installed")
    typescript = FRONTEND / "node_modules" / "typescript"
    if not typescript.exists():
        pytest.skip("frontend TypeScript dependency is not installed")

    canvas = (FRONTEND / "src" / "components" / "Canvas.tsx").read_text(encoding="utf-8")
    base_node = (FRONTEND / "src" / "components" / "nodes" / "BaseNode.tsx").read_text(encoding="utf-8")
    nodes_css = (FRONTEND / "src" / "styles" / "nodes.css").read_text(encoding="utf-8")
    helper = (FRONTEND / "src" / "utils" / "connectionPreview.ts").read_text(encoding="utf-8")

    assert "onConnectStart={handleConnectStart}" in canvas
    assert "onConnectEnd={handleConnectEnd}" in canvas
    assert "isValidConnection={handleIsValidConnection}" in canvas
    assert "buildConnectionPreviewForNode" in canvas
    assert "connectionEndHandle" in canvas
    assert "hoveredConnectionFeedback" in canvas
    assert "connection-feedback-hint" in canvas
    assert "connectionLineStyle={connectionLineStyle}" in canvas
    assert "setSelectedNode({ ...node, data: cleanData })" in canvas
    assert "connectionHoverKeyRef" not in canvas
    assert "connectionPreview?.inputs?.[pin.id]" in base_node
    assert "connectionPreview?.outputs?.[pin.id]" in base_node
    assert "pin-feedback-valid" in base_node
    assert "pin-feedback-invalid" in base_node
    assert ".pin-row.pin-feedback-valid" in nodes_css
    assert ".pin-row.pin-feedback-invalid" in nodes_css
    assert ".connection-feedback-hint" in nodes_css
    assert "validateConnection" in helper
    assert "getConnectionError" in helper

    script = r"""
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require(path.resolve('web/frontend/node_modules/typescript'));

const cache = {};
function loadTs(rel) {
  const key = path.normalize(rel);
  if (cache[key]) return cache[key].exports;
  const src = fs.readFileSync(path.join('web/frontend/src', key), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = { exports: {} };
  cache[key] = module;
  const localRequire = (name) => {
    if (name === '../types/flow') {
      return { isEntryNodeType: (nodeType) => String(nodeType || '').startsWith('on_') };
    }
    if (name.startsWith('.')) {
      return loadTs(`${path.normalize(path.join(path.dirname(key), name))}.ts`);
    }
    return require(name);
  };
  vm.runInNewContext(js, { module, exports: module.exports, require: localRequire, console });
  return module.exports;
}

const preview = loadTs('utils/connectionPreview.ts');

const start = { id: 'start', data: { nodeType: 'on_flow_start', label: 'Start', inputs: [], outputs: [{ id: 'exec-out', type: 'execution' }] } };
const image = {
  id: 'image',
  data: {
    nodeType: 'generate_image',
    label: 'Generate Image',
    inputs: [{ id: 'exec-in', type: 'execution' }],
    outputs: [
      { id: 'exec-out', type: 'execution' },
      { id: 'image_artifact', label: 'image_artifact', type: 'artifact_image' },
      { id: 'outputs', label: 'outputs', type: 'object' },
    ],
  },
};
const voice = {
  id: 'voice',
  data: {
    nodeType: 'generate_voice',
    label: 'Generate Voice',
    inputs: [{ id: 'exec-in', type: 'execution' }],
    outputs: [
      { id: 'exec-out', type: 'execution' },
      { id: 'audio_artifact', label: 'audio_artifact', type: 'artifact_audio' },
    ],
  },
};
const edit = {
  id: 'edit',
  data: {
    nodeType: 'edit_image',
    label: 'Edit Image',
    inputs: [
      { id: 'exec-in', type: 'execution' },
      { id: 'image_artifact', label: 'image_artifact', type: 'artifact_image' },
    ],
    outputs: [{ id: 'exec-out', type: 'execution' }],
  },
};
const transcribe = {
  id: 'transcribe',
  data: {
    nodeType: 'transcribe_audio',
    label: 'Transcribe Audio',
    inputs: [
      { id: 'exec-in', type: 'execution' },
      { id: 'audio_artifact', label: 'audio_artifact', type: 'artifact_audio' },
    ],
    outputs: [{ id: 'exec-out', type: 'execution' }],
  },
};
const nodes = [start, image, voice, edit, transcribe];

const imageDragToEdit = preview.buildConnectionPreviewForNode(
  nodes,
  [],
  { nodeId: 'image', handleId: 'image_artifact', handleType: 'source', pinType: 'artifact_image' },
  edit
);
assert.equal(imageDragToEdit.inputs.image_artifact.status, 'valid');

const imageDragToTranscribe = preview.buildConnectionPreviewForNode(
  nodes,
  [],
  { nodeId: 'image', handleId: 'image_artifact', handleType: 'source', pinType: 'artifact_image' },
  transcribe
);
assert.equal(imageDragToTranscribe.inputs.audio_artifact.status, 'invalid');
assert.match(imageDragToTranscribe.inputs.audio_artifact.message, /Needs audio artifact, got image artifact/);

const voiceDragToTranscribe = preview.buildConnectionPreviewForNode(
  nodes,
  [],
  { nodeId: 'voice', handleId: 'audio_artifact', handleType: 'source', pinType: 'artifact_audio' },
  transcribe
);
assert.equal(voiceDragToTranscribe.inputs.audio_artifact.status, 'valid');

const reverseTargetDrag = preview.buildConnectionPreviewForNode(
  nodes,
  [],
  { nodeId: 'transcribe', handleId: 'audio_artifact', handleType: 'target', pinType: 'artifact_audio' },
  voice
);
assert.equal(reverseTargetDrag.outputs.audio_artifact.status, 'valid');

const occupiedInput = preview.buildConnectionPreviewForNode(
  nodes,
  [{ id: 'existing', source: 'image', sourceHandle: 'image_artifact', target: 'edit', targetHandle: 'image_artifact' }],
  { nodeId: 'voice', handleId: 'audio_artifact', handleType: 'source', pinType: 'artifact_audio' },
  edit
);
assert.equal(occupiedInput.inputs.image_artifact.status, 'invalid');
assert.match(occupiedInput.inputs.image_artifact.message, /already connected/);
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr + result.stdout


def test_frontend_node_pin_widgets_are_catalog_scoped() -> None:
    if not shutil.which("node"):
        pytest.skip("node is not installed")
    typescript = FRONTEND / "node_modules" / "typescript"
    if not typescript.exists():
        pytest.skip("frontend TypeScript dependency is not installed")

    base_node = (FRONTEND / "src" / "components" / "nodes" / "BaseNode.tsx").read_text(encoding="utf-8")
    pin_catalog = (FRONTEND / "src" / "utils" / "pinCatalog.ts").read_text(encoding="utf-8")

    assert "providerCatalogScopeForPin" in base_node
    assert "modelCatalogScopeForPin" in base_node
    assert "providerOptionsForCatalogScope" in base_node
    assert "modelOptionsForCatalogScope" in base_node
    assert "setCatalogProviderDefault" in base_node
    primitive_fallback = base_node[base_node.index("if (!connected && isPrimitive") : base_node.index("if (isDelayNode")]
    assert "pin.type === 'provider'" not in primitive_fallback
    assert "pin.type === 'model'" not in primitive_fallback
    assert "pin.id.endsWith('_provider')" in pin_catalog
    assert "providerPinIdForModelPin" in pin_catalog

    script = r"""
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require(path.resolve('web/frontend/node_modules/typescript'));

const src = fs.readFileSync('web/frontend/src/utils/pinCatalog.ts', 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, require, console });
const catalog = module.exports;

assert.equal(catalog.providerCatalogScopeForPin({ id: 'provider', type: 'provider_text' }, 'llm_call'), 'text');
assert.equal(catalog.providerCatalogScopeForPin({ id: 'image_provider', type: 'provider_image' }, 'code'), 'image');
assert.equal(catalog.providerCatalogScopeForPin({ id: 'tts_provider', type: 'provider_voice' }, 'code'), 'tts');
assert.equal(catalog.providerCatalogScopeForPin({ id: 'stt_provider', type: 'provider_voice' }, 'code'), 'stt');
assert.equal(catalog.providerCatalogScopeForPin({ id: 'music_provider', type: 'provider_music' }, 'code'), 'music');

const imagePins = [
  { id: 'image_provider', type: 'provider_image' },
  { id: 'model', type: 'model' },
];
assert.equal(catalog.modelCatalogScopeForPin(imagePins[1], imagePins, 'code'), 'image');

const textPins = [
  { id: 'provider', type: 'provider_text' },
  { id: 'model', type: 'model' },
];
assert.equal(catalog.modelCatalogScopeForPin(textPins[1], textPins, 'llm_call'), 'text');
assert.equal(catalog.providerPinIdForModelPin(textPins[1], textPins, 'llm_call'), 'provider');

const ttsPins = [
  { id: 'tts_provider', type: 'provider_voice' },
  { id: 'tts_model', type: 'model' },
];
assert.equal(catalog.modelCatalogScopeForPin(ttsPins[1], ttsPins, 'code'), 'tts');
assert.equal(catalog.providerPinIdForModelPin(ttsPins[1], ttsPins, 'code'), 'tts_provider');
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr + result.stdout


def test_frontend_pin_contract_rejects_control_values_into_generic_inputs() -> None:
    if not shutil.which("node"):
        pytest.skip("node is not installed")
    typescript = FRONTEND / "node_modules" / "typescript"
    if not typescript.exists():
        pytest.skip("frontend TypeScript dependency is not installed")

    base_node = (FRONTEND / "src" / "components" / "nodes" / "BaseNode.tsx").read_text(encoding="utf-8")
    canvas = (FRONTEND / "src" / "components" / "Canvas.tsx").read_text(encoding="utf-8")
    use_flow = (FRONTEND / "src" / "hooks" / "useFlow.ts").read_text(encoding="utf-8")

    assert "targetHandle !== 'exec-in'" not in base_node
    assert "sourceHandle !== 'exec-out'" not in base_node
    assert "interactionWidth={24}" in canvas
    assert "validateConnection(nodes, structurallyValidEdges.filter" in use_flow

    script = r"""
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require(path.resolve('web/frontend/node_modules/typescript'));

const cache = {};
function loadTs(rel) {
  const key = path.normalize(rel);
  if (cache[key]) return cache[key].exports;
  const src = fs.readFileSync(path.join('web/frontend/src', key), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = { exports: {} };
  cache[key] = module;
  const localRequire = (name) => {
    if (name === '../types/flow') return {};
    if (name.startsWith('.')) {
      const joined = path.normalize(path.join(path.dirname(key), name));
      return loadTs(joined.endsWith('.ts') ? joined : `${joined}.ts`);
    }
    return require(name);
  };
  vm.runInNewContext(js, { module, exports: module.exports, require: localRequire, console });
  return module.exports;
}

const validation = loadTs('utils/validation.ts');
const start = {
  id: 'start',
  data: {
    nodeType: 'on_flow_start',
    label: 'Start',
    inputs: [],
    outputs: [
      { id: 'exec-out', type: 'execution' },
      { id: 'provider', type: 'provider_text' },
      { id: 'model', type: 'model_text' },
      { id: 'message', type: 'string' },
    ],
  },
};
const code = {
  id: 'code',
  data: {
    nodeType: 'code',
    label: 'Code',
    inputs: [
      { id: 'exec-in', type: 'execution' },
      { id: 'input', type: 'any' },
      { id: 'provider', type: 'provider_text' },
      { id: 'model', type: 'model_text' },
      { id: 'text', type: 'string' },
    ],
    outputs: [{ id: 'exec-out', type: 'execution' }],
  },
};
const nodes = [start, code];
const connect = (sourceHandle, targetHandle) => ({
  source: 'start',
  sourceHandle,
  target: 'code',
  targetHandle,
});

assert.equal(validation.validateConnection(nodes, [], connect('exec-out', 'exec-in')), true);
assert.equal(validation.validateConnection(nodes, [], connect('message', 'input')), true);
assert.equal(validation.validateConnection(nodes, [], connect('provider', 'provider')), true);
assert.equal(validation.validateConnection(nodes, [], connect('model', 'model')), true);
assert.equal(validation.validateConnection(nodes, [], connect('provider', 'input')), false);
assert.equal(validation.validateConnection(nodes, [], connect('model', 'input')), false);
assert.equal(validation.validateConnection(nodes, [], connect('provider', 'text')), false);
assert.match(validation.getConnectionError(nodes, [], connect('provider', 'input')), /Type mismatch/);
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr + result.stdout


def test_run_modal_source_marks_optional_residency_failures_as_skipped_or_unsupported() -> None:
    run_modal = (FRONTEND / "src" / "components" / "RunFlowModal.tsx").read_text(encoding="utf-8")

    assert "residencyResultStatusInfo" in run_modal
    assert "label: 'UNSUPPORTED'" in run_modal
    assert "label: 'SKIPPED'" in run_modal
    assert "s.nodeType === 'model_residency'" in run_modal
    assert "effectType === 'model_residency'" in run_modal
    assert "selectedResidencyResultStatus" in run_modal
    assert "Gateway/Runtime reported this residency operation is unsupported" in run_modal
    assert "This optional residency request completed without changing runtime state." in run_modal
    assert "media_provider" in run_modal
    assert "media_model" in run_modal


def test_frontend_exposes_durable_prompt_cache_binding_controls() -> None:
    node_templates = (FRONTEND / "src" / "types" / "nodes.ts").read_text(encoding="utf-8")
    gateway_client = (FRONTEND / "src" / "utils" / "gatewayClient.ts").read_text(encoding="utf-8")
    run_modal = (FRONTEND / "src" / "components" / "RunFlowModal.tsx").read_text(encoding="utf-8")

    assert "GatewayDurableBlocPromptCacheContract" in gateway_client
    assert "promptCacheDurableBlocs" in gateway_client
    assert "durableBlocPromptCacheAvailable" in gateway_client
    assert "durable_blocs" in gateway_client
    assert "exact_reuse_binding_param" in gateway_client
    assert "prompt_cache_binding" in node_templates
    assert "type: 'any'" in node_templates
    assert "Durable prompt cache (exact reuse)" in run_modal
    assert "Session prompt cache (volatile)" in run_modal
    assert "Load binding" in run_modal
    assert "Run input prompt_cache_binding" in run_modal
    assert "inputData.prompt_cache_binding" in run_modal
    assert "runDurableBlocOperation('kv_load')" in run_modal


def test_flow_gateway_profiles_do_not_name_core_or_runtime_direct_dependencies() -> None:
    text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")

    for profile in ("apple", "gpu"):
        match = re.search(rf"^{profile} = \[(.*?)^\]", text, flags=re.MULTILINE | re.DOTALL)
        assert match is not None
        deps = match.group(1).lower()
        assert "abstractgateway" in deps
        assert "abstractruntime" not in deps
        assert "abstractcore" not in deps


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

local_route_modules = {
    "backend.routes.flows",
    "backend.routes.memory_kg",
    "backend.routes.providers",
    "backend.routes.runs",
    "backend.routes.semantics",
    "backend.routes.tools",
    "backend.routes.ws",
}
print(json.dumps({
    "paths": sorted(getattr(route, "path", "") for route in main.app.routes),
    "local_route_modules": sorted(name for name in local_route_modules if name in sys.modules),
}))
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
    payload = json.loads(result.stdout)
    paths = set(payload["paths"])

    assert "/api/gateway/{path:path}" in paths
    assert "/api/connection/gateway" in paths
    assert "/api/ws/{flow_id}" not in paths
    assert "/api/flows" not in paths
    assert "/api/runs" not in paths
    assert "/api/providers" not in paths
    assert payload["local_route_modules"] == []


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
