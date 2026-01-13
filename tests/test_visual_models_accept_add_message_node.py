from abstractflow.visual.models import Position, VisualNode


def test_visual_models_accept_add_message_node_type_string() -> None:
    node = VisualNode(id="n1", type="add_message", position=Position(x=0, y=0), data={})
    assert node.type.value == "add_message"

