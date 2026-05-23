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
      tasks: ['text_generation', 'image_generation', 'music_generation', 'tts', 'stt'],
      supports: { text_generation: true, image_generation: true, music_generation: true, tts: true, stt: true },
    },
    memory: { available: true, endpoint: '/kg/query' },
    readiness: {
      contract: 'gateway_surface_readiness_v1',
      version: 1,
      truth_scope: 'gateway_contract_surface',
      limitations: ['Derived from Gateway endpoint descriptors and contract wiring only.'],
      surfaces: {
        media: {
          generated_image: { available: true, route_available: true, configured: true, workflow_available: false },
          edited_image: { available: true, route_available: true, configured: true, workflow_available: false },
          generated_voice: { available: false, route_available: false, workflow_available: true },
          generated_music: { available: true, route_available: true, configured: true, workflow_available: false },
        },
        model_residency: {
          available: false,
          route_available: true,
          supports: { text_generation: true, image_generation: true, music_generation: true, tts: true, stt: true },
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
    assert "audio_artifact" in node_templates
    assert "music_artifact" in node_templates
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
    assert "{ id: 'music_backend'" not in node_templates
    assert "{ id: 'enhance_prompt'" in node_templates
    assert "{ id: 'structure_prompt', label: 'structure', type: 'boolean' }" in node_templates
    assert "{ id: 'composition_plan'" in node_templates
    properties_panel = (FRONTEND / "src" / "components" / "PropertiesPanel.tsx").read_text(encoding="utf-8")
    assert "data.effectConfig?.image_provider" in properties_panel
    assert "image_model: picked?.model" in properties_panel
    assert "data.effectConfig?.tts_model" in properties_panel
    assert "data.effectConfig?.stt_model" in properties_panel
    assert "data.effectConfig?.music_model" in properties_panel
    assert "data.effectConfig?.music_backend" not in properties_panel
    assert "ArtifactLiteralPanel" in properties_panel
    assert "Select a local file to upload it into Gateway artifacts." in properties_panel
    assert "'/api/gateway/attachments/upload'" in properties_panel
    assert "ArtifactPlayer" in properties_panel
    assert "editedImageProviderModelsTask" in properties_panel
    assert "STT model" in properties_panel
    assert "Music model" in properties_panel
    assert "Optional media/voice provider id." in node_templates
    assert "Optional audio/STT provider id." in node_templates
    assert "Optional Gateway music backend/provider." in node_templates
    run_modal = (FRONTEND / "src" / "components" / "RunFlowModal.tsx").read_text(encoding="utf-8")
    assert "Search music providers…" in run_modal
    assert "Search music models…" in run_modal
    assert "abstract.media.music.generated" in run_modal
    assert "Generated music" in run_modal
    assert "payloadRaw.artifact_ref" in run_modal
    base_node = (FRONTEND / "src" / "components" / "nodes" / "BaseNode.tsx").read_text(encoding="utf-8")
    assert "currentImageProviderModelsTask" in base_node
    assert "addImageProvidersFromCatalog" in base_node
    assert "record.models_by_provider" in base_node
    assert "record.available_providers" in base_node
    assert "advancedMusicInputPins" in base_node
    artifact_player = (FRONTEND / "src" / "components" / "ArtifactPlayer.tsx").read_text(encoding="utf-8")
    assert "export function ArtifactPlayer" in artifact_player
    assert "export function useArtifactObjectUrl" in artifact_player
    assert "'/api/gateway/runs/{run_id}/artifacts/{artifact_id}/content'" in artifact_player
    palette_css = (FRONTEND / "src" / "styles" / "palette.css").read_text(encoding="utf-8")
    assert ".artifact-literal-editor" in palette_css
    assert ".artifact-player-image" in palette_css


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
    graph_util = (FRONTEND / "src" / "utils" / "modelResidencyGraph.ts").read_text(encoding="utf-8")
    css = (FRONTEND / "src" / "styles" / "index.css").read_text(encoding="utf-8")

    assert "'model_residency'" in flow_types
    assert "type: 'model_residency'" in node_templates
    assert "Load / Unload Model" in node_templates
    assert "warming, or unloading" in node_templates
    assert "operation: 'load'" in node_templates
    assert "task: 'image_generation'" in node_templates
    assert "common?.model_residency" in gateway_client
    assert "modelResidency" in gateway_client
    assert "ModelResidencyPanel" in toolbar
    assert "Model Residency" in panel
    assert "Gateway/Runtime model state" in panel
    assert "useLoadedModels" in panel
    assert "descriptorEndpointAvailable" in panel
    assert "residencyEndpointAvailable" in panel
    assert "loadAvailable" in panel
    assert "unloadAvailable" in panel
    assert "Loaded-model listing is not available on this Gateway runtime." in panel
    assert "Speech provider" in panel
    assert "Transcription provider" in panel
    assert "Music provider" in panel
    assert "task === 'tts'" in panel
    assert "task === 'stt'" in panel
    assert "task === 'music_generation'" in panel
    assert "runtime client cached" in panel
    assert "provider not resident" in panel
    assert "runtime default config" in panel
    assert "gateway default config" in panel
    assert "canUnloadRow" in panel
    assert "residencyResultMessage" in panel
    assert "max-width: min(1080px, calc(100vw - 48px));" in css
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
    assert "{ value: 'music_generation', label: 'music' }" in base_node
    assert "insertModelResidencyStep" in base_node
    assert "Dynamic provider/model is wired from pins." in base_node
    assert "export function insertModelResidencyStep" in graph_util
    assert "Warm Model" in graph_util
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

const src = fs.readFileSync('web/frontend/src/utils/preflight.ts', 'utf8');
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
    if (name === '../types/flow') {
      return { isEntryNodeType: (nodeType) => String(nodeType || '').startsWith('on_') };
    }
    return require(name);
  },
  console,
});
const preflight = module.exports;

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
        { id: 'image_artifact', type: 'object' },
      ],
      outputs: [{ id: 'exec-out', type: 'execution' }],
      effectConfig: { prompt: 'make it watercolor' },
    },
  },
];
const edges = [{ id: 'e', source: 'start', sourceHandle: 'exec-out', target: 'edit', targetHandle: 'exec-in' }];
const issues = preflight.computeRunPreflightIssues(nodes, edges);
assert(issues.some((issue) => issue.message === 'Missing required input: image_artifact'));
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
