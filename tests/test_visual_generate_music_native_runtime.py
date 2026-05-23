from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOCAL_RUNTIME_SRC = ROOT.parent / "abstractruntime" / "src"


def test_generate_music_native_node_compiles_to_music_output() -> None:
    """Guard the Runtime-side contract used by Flow's native Generate Music node."""

    if LOCAL_RUNTIME_SRC.is_dir():
        sys.path.insert(0, str(LOCAL_RUNTIME_SRC))

    from abstractruntime.core.models import EffectType, RunState, RunStatus
    from abstractruntime.visualflow_compiler import compile_visualflow

    vf = {
        "id": "vf_generate_music_native",
        "name": "Generate Music (Native)",
        "entryNode": "start",
        "nodes": [
            {
                "id": "start",
                "type": "on_flow_start",
                "position": {"x": 0, "y": 0},
                "data": {"nodeType": "on_flow_start"},
            },
            {
                "id": "prompt",
                "type": "literal_string",
                "position": {"x": 0, "y": 0},
                "data": {"literalValue": "a heroic fantasy grandiose music cue"},
            },
            {
                "id": "music",
                "type": "generate_music",
                "position": {"x": 0, "y": 0},
                "data": {
                    "nodeType": "generate_music",
                    "effectConfig": {
                        "format": "wav",
                        "music_provider": "stable-audio-3",
                        "music_model": "stabilityai/stable-audio-3-small-music",
                        "duration_s": 10,
                        "instrumental": True,
                        "enhance_prompt": True,
                        "num_inference_steps": 12,
                        "guidance_scale": 3.5,
                    },
                },
            },
            {
                "id": "end",
                "type": "on_flow_end",
                "position": {"x": 0, "y": 0},
                "data": {"nodeType": "on_flow_end"},
            },
        ],
        "edges": [
            {
                "id": "e1",
                "source": "start",
                "sourceHandle": "exec-out",
                "target": "music",
                "targetHandle": "exec-in",
            },
            {
                "id": "e2",
                "source": "music",
                "sourceHandle": "exec-out",
                "target": "end",
                "targetHandle": "exec-in",
            },
            {
                "id": "d1",
                "source": "prompt",
                "sourceHandle": "value",
                "target": "music",
                "targetHandle": "prompt",
            },
        ],
    }

    spec = compile_visualflow(vf)
    run = RunState(
        run_id="run",
        workflow_id=str(spec.workflow_id),
        status=RunStatus.RUNNING,
        current_node="music",
        vars={"_temp": {}},
    )

    plan = spec.nodes["music"](run, {})
    assert plan.effect is not None
    assert plan.effect.type == EffectType.LLM_CALL

    payload = plan.effect.payload
    assert isinstance(payload, dict)
    assert payload.get("type") == "llm_call"
    assert payload.get("prompt") == "a heroic fantasy grandiose music cue"

    output = payload.get("output")
    assert isinstance(output, dict)
    assert output.get("modality") == "music"
    assert output.get("task") == "music_generation"
    assert output.get("format") == "wav"
    assert output.get("provider") == "stable-audio-3"
    assert output.get("model") == "stabilityai/stable-audio-3-small-music"
    assert "backend" not in output
    assert output.get("duration_s") == 10
    assert output.get("instrumental") is True
    assert output.get("enhance_prompt") is True
    assert output.get("num_inference_steps") == 12
    assert output.get("guidance_scale") == 3.5


def test_visual_runner_accepts_ui_authored_media_provider_model_defaults() -> None:
    """Flow's local compatibility runner should read scoped media provider/model fields."""

    source = (ROOT / "abstractflow" / "visual" / "executor.py").read_text(encoding="utf-8")
    assert '"generate_music": "music_provider"' in source
    assert '"generate_music": "music_model"' in source
    assert '"generate_image": "image_provider"' in source
    assert '"generate_voice": "tts_provider"' in source
    assert '"transcribe_audio": "stt_provider"' in source


def test_edit_image_native_node_compiles_to_image_edit_output() -> None:
    """Guard the Runtime-side contract used by Flow's native Edit Image node."""

    if LOCAL_RUNTIME_SRC.is_dir():
        sys.path.insert(0, str(LOCAL_RUNTIME_SRC))

    from abstractruntime.core.models import EffectType, RunState, RunStatus
    from abstractruntime.visualflow_compiler import compile_visualflow

    vf = {
        "id": "vf_edit_image_native",
        "name": "Edit Image (Native)",
        "entryNode": "edit",
        "nodes": [
            {
                "id": "edit",
                "type": "edit_image",
                "position": {"x": 0, "y": 0},
                "data": {
                    "nodeType": "edit_image",
                    "effectConfig": {
                        "prompt": "turn the source into a watercolor poster",
                        "image_artifact": "artifact-source-image",
                        "mask_artifact": "artifact-mask-image",
                        "image_provider": "stability-ai",
                        "image_model": "stabilityai/stable-image-edit",
                        "format": "png",
                        "strength": 0.65,
                    },
                },
            }
        ],
        "edges": [],
    }

    spec = compile_visualflow(vf)
    run = RunState(
        run_id="run",
        workflow_id=str(spec.workflow_id),
        status=RunStatus.RUNNING,
        current_node="edit",
        vars={"_temp": {}},
    )

    plan = spec.nodes["edit"](run, {})
    assert plan.effect is not None
    assert plan.effect.type == EffectType.LLM_CALL

    payload = plan.effect.payload
    assert isinstance(payload, dict)
    assert payload.get("prompt") == "turn the source into a watercolor poster"

    output = payload.get("output")
    assert isinstance(output, dict)
    assert output.get("modality") == "image"
    assert output.get("task") == "image_edit"
    assert output.get("provider") == "stability-ai"
    assert output.get("model") == "stabilityai/stable-image-edit"
    assert output.get("format") == "png"
    assert output.get("strength") == 0.65

    media = payload.get("media")
    assert isinstance(media, list)
    assert {"type": "image", "role": "source", "$artifact": "artifact-source-image"} in media
    assert {"type": "image", "role": "mask", "$artifact": "artifact-mask-image"} in media
