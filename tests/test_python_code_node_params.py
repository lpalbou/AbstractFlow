from __future__ import annotations

from abstractflow.visual import create_visual_runner, execute_visual_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_python_code_node_executes_with_multiple_params() -> None:
    flow = VisualFlow(
        id="flow-code-params",
        name="code params",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="a",
                type=NodeType.LITERAL_NUMBER,
                position=Position(x=0, y=0),
                data={"literalValue": 2},
            ),
            VisualNode(
                id="b",
                type=NodeType.LITERAL_NUMBER,
                position=Position(x=0, y=0),
                data={"literalValue": 3},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(_input):\n"
                        "    a = _input.get('a')\n"
                        "    b = _input.get('b')\n"
                        "    return {'sum': (a or 0) + (b or 0)}\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(
                id="e1",
                source="start",
                sourceHandle="exec-out",
                target="code",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="d1",
                source="a",
                sourceHandle="value",
                target="code",
                targetHandle="a",
            ),
            VisualEdge(
                id="d2",
                source="b",
                sourceHandle="value",
                target="code",
                targetHandle="b",
            ),
        ],
    )

    result = execute_visual_flow(flow, {}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"] == {"sum": 5.0}


def test_python_code_node_regenerates_wrapper_from_body_and_current_inputs() -> None:
    flow = VisualFlow(
        id="flow-code-body-current-inputs",
        name="code body current inputs",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "provider", "label": "provider", "type": "provider_text"},
                        {"id": "model", "label": "model", "type": "model_text"},
                    ]
                },
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "provider", "label": "provider", "type": "provider_text"},
                        {"id": "model", "label": "model", "type": "model_text"},
                        {"id": "permissions", "label": "permissions", "type": "string"},
                    ],
                    "pinDefaults": {"permissions": "sandbox"},
                    "codeBody": "return {'provider': provider, 'model': model}",
                    "code": (
                        "def transform(_input):\n"
                        "    return {'provider': provider, 'model': model}\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(
                id="e1",
                source="start",
                sourceHandle="exec-out",
                target="code",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="d1",
                source="start",
                sourceHandle="provider",
                target="code",
                targetHandle="provider",
            ),
            VisualEdge(
                id="d2",
                source="start",
                sourceHandle="model",
                target="code",
                targetHandle="model",
            ),
        ],
    )

    result = execute_visual_flow(
        flow,
        {"provider": "lmstudio", "model": "qwen/qwen3.6-35b-a3b"},
        flows={flow.id: flow},
    )
    assert result["success"] is True
    assert result["result"] == {"provider": "lmstudio", "model": "qwen/qwen3.6-35b-a3b"}


def test_python_code_node_unconnected_pin_defaults_override_ambient_exec_payload() -> None:
    flow = VisualFlow(
        id="flow-code-unconnected-provider-model-defaults",
        name="code unconnected provider model defaults",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "provider", "label": "provider", "type": "provider_text"},
                        {"id": "model", "label": "model", "type": "model_text"},
                    ]
                },
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "input", "label": "input", "type": "any"},
                        {"id": "permissions", "label": "permissions", "type": "string"},
                        {"id": "provider", "label": "provider", "type": "provider_text"},
                        {"id": "model", "label": "model", "type": "model_text"},
                    ],
                    "pinDefaults": {
                        "permissions": "sandbox",
                        "provider": "LMStudio",
                        "model": "essentialai/rnj-1",
                    },
                    "codeBody": "return {'providerX': provider, 'modelX': model}",
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(
                id="e1",
                source="start",
                sourceHandle="exec-out",
                target="code",
                targetHandle="exec-in",
            ),
        ],
    )

    result = execute_visual_flow(flow, {"provider": "", "model": ""}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"] == {"providerX": "LMStudio", "modelX": "essentialai/rnj-1"}


def test_python_code_node_supports_top_level_helpers() -> None:
    flow = VisualFlow(
        id="flow-code-helpers",
        name="code helpers",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="v",
                type=NodeType.LITERAL_NUMBER,
                position=Position(x=0, y=0),
                data={"literalValue": 41},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def _plus_one(x):\n"
                        "    return (x or 0) + 1\n"
                        "\n"
                        "def transform(_input):\n"
                        "    v = _input.get('v')\n"
                        "    return {'v': _plus_one(v)}\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(
                id="e1",
                source="start",
                sourceHandle="exec-out",
                target="code",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="d1",
                source="v",
                sourceHandle="value",
                target="code",
                targetHandle="v",
            ),
        ],
    )

    result = execute_visual_flow(flow, {}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"] == {"v": 42.0}


def test_python_code_node_exposes_standard_success_and_output_pins() -> None:
    flow = VisualFlow(
        id="flow-code-output-contract",
        name="code output contract",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="source",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(_input):\n"
                        "    return {'answer': 7}\n"
                    ),
                    "functionName": "transform",
                },
            ),
            VisualNode(
                id="sink",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(_input):\n"
                        "    return {'ok': _input.get('ok'), 'value': _input.get('value'), 'execution': _input.get('execution')}\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(
                id="e1",
                source="start",
                sourceHandle="exec-out",
                target="source",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="e2",
                source="source",
                sourceHandle="exec-out",
                target="sink",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="d1",
                source="source",
                sourceHandle="success",
                target="sink",
                targetHandle="ok",
            ),
            VisualEdge(
                id="d2",
                source="source",
                sourceHandle="output",
                target="sink",
                targetHandle="value",
            ),
            VisualEdge(
                id="d3",
                source="source",
                sourceHandle="execution",
                target="sink",
                targetHandle="execution",
            ),
        ],
    )

    result = execute_visual_flow(flow, {}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"]["ok"] is True
    assert result["result"]["value"] == {"answer": 7}
    execution = result["result"]["execution"]
    assert execution["duration_ms"] >= 0
    assert execution["cpu_time_ms"] >= 0
    assert execution["permissions"] == "sandbox"


def test_python_code_node_permissions_pin_is_not_user_payload() -> None:
    flow = VisualFlow(
        id="flow-code-permissions-control",
        name="code permissions control",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "pinDefaults": {"permissions": "sandbox"},
                    "code": (
                        "def transform(_input):\n"
                        "    return {'permissions': _input.get('permissions'), 'value': _input.get('value')}\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(
                id="e1",
                source="start",
                sourceHandle="exec-out",
                target="code",
                targetHandle="exec-in",
            ),
        ],
    )

    result = execute_visual_flow(flow, {"value": 42}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"] == {"permissions": None, "value": 42}


def test_python_code_node_full_access_runs_only_when_host_policy_enables_it(monkeypatch) -> None:
    monkeypatch.setenv("ABSTRACTRUNTIME_CODE_FULL_ACCESS", "1")
    flow = VisualFlow(
        id="flow-code-full-access",
        name="code full access",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "pinDefaults": {"permissions": "full_access"},
                    "code": (
                        "import os\n\n"
                        "def transform(_input):\n"
                        "    return {'name': os.path.basename('/tmp/example.txt')}\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(
                id="e1",
                source="start",
                sourceHandle="exec-out",
                target="code",
                targetHandle="exec-in",
            ),
        ],
    )

    result = execute_visual_flow(flow, {}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"] == {"name": "example.txt"}


def test_python_code_node_connected_permissions_control_runtime_mode(monkeypatch) -> None:
    monkeypatch.setenv("ABSTRACTRUNTIME_CODE_FULL_ACCESS", "1")
    flow = VisualFlow(
        id="flow-code-connected-permissions",
        name="code connected permissions",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="mode",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(_input):\n"
                        "    return 'full_access'\n"
                    ),
                    "functionName": "transform",
                },
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "pinDefaults": {"permissions": "sandbox"},
                    "code": (
                        "import os\n\n"
                        "def transform(_input):\n"
                        "    return {'payload_permissions': _input.get('permissions'), 'name': os.path.basename('/tmp/example.txt')}\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(
                id="e1",
                source="start",
                sourceHandle="exec-out",
                target="mode",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="e2",
                source="mode",
                sourceHandle="exec-out",
                target="code",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="d1",
                source="mode",
                sourceHandle="output",
                target="code",
                targetHandle="permissions",
            ),
        ],
    )

    result = execute_visual_flow(flow, {}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"] == {"payload_permissions": None, "name": "example.txt"}


def test_python_code_node_failure_records_standard_output_envelope() -> None:
    flow = VisualFlow(
        id="flow-code-failure-envelope",
        name="code failure envelope",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "pinDefaults": {"permissions": "sandbox"},
                    "code": (
                        "def transform(_input):\n"
                        "    return 1 / 0\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(
                id="e1",
                source="start",
                sourceHandle="exec-out",
                target="code",
                targetHandle="exec-in",
            ),
        ],
    )

    runner = create_visual_runner(flow, flows={flow.id: flow})
    result = runner.run({})
    assert result["success"] is False
    assert result["output"] is None
    assert result["result"] is None
    assert "division" in result["error"]
    assert result["execution"]["duration_ms"] >= 0
    assert result["execution"]["cpu_time_ms"] >= 0
    assert result["execution"]["permissions"] == "sandbox"
    assert runner.flow._node_outputs["code"]["success"] is False  # type: ignore[attr-defined]
    assert runner.flow._node_outputs["code"]["output"] is None  # type: ignore[attr-defined]


def test_python_code_node_full_access_fails_closed_without_host_policy(monkeypatch) -> None:
    monkeypatch.delenv("ABSTRACTRUNTIME_CODE_FULL_ACCESS", raising=False)
    flow = VisualFlow(
        id="flow-code-full-access-denied",
        name="code full access denied",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "pinDefaults": {"permissions": "full_access"},
                    "code": (
                        "import os\n\n"
                        "def transform(_input):\n"
                        "    return os.getcwd()\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(
                id="e1",
                source="start",
                sourceHandle="exec-out",
                target="code",
                targetHandle="exec-in",
            ),
        ],
    )

    runner = create_visual_runner(flow, flows={flow.id: flow})
    result = runner.run({})
    assert result["success"] is False
    assert result["output"] is None
    assert result["result"] is None
    assert "full_access code execution is disabled" in result["error"]
    assert result["execution"]["permissions"] == "full_access"
