# Shipped Workflow Sources

AbstractGateway serves a set of workflow bundles out of the box, so users get a
working coder, deep research, and co-scientist without authoring anything. This
page maps each shipped bundle back to the editable VisualFlow JSON and the
generator that packs it, so you can study, fork, or extend them here.

For what those workflows do and how to run them, see
[AbstractGateway's shipped workflows](https://github.com/lpalbou/AbstractGateway/blob/main/docs/shipped-workflows.md).

## Sources

| Bundle | Editable flows (`examples/flows/`) | Generator (`scripts/`) |
| --- | --- | --- |
| `coding-agent@0.2.6` | `coder.json`, `coding-agent.json`, `coding-verify-gates.json` | `build_coding_agent_workflow.py` |
| `deep-research@0.1.7` | `deep-research.json`, `deep-plan.json`, `deep-investigate.json`, `deep-review.json`, `deep-render.json` | `build_deep_research_workflows.py`, packed by `pack_deep_research_bundle.py` |
| `co-scientist@0.2.0` | `co-scientist.json`, `deep-plan.json`, `deep-investigate.json`, `diagram-render.json` | `build_co_scientist_workflow.py` |

The generators are the source of truth for bundle id and version; each writes
its `.flow` into `abstractgateway/flows/bundles/`. Bundle versions are
immutable by sha, so publishing a changed graph means bumping the version in
the generator and updating the packaging pin in
`abstractgateway/pyproject.toml`.

`co-scientist` reuses the `deep-plan` and `deep-investigate` flows to ground
its hypotheses in real literature, which is why those files appear under two
bundles.

## Forking one

Open a flow in the editor ([web editor](web-editor.md)), change what you need,
export it with its subflows, and pack it under your own bundle id with
AbstractRuntime's bundle packer (the same function the generators here use):

```python
from abstractruntime.workflow_bundle import pack_workflow_bundle

pack_workflow_bundle(
    root_flow_json="/path/to/flows/my-agent.json",
    out_path="/path/to/bundles/my-agent@0.1.0.flow",
    bundle_id="my-agent",
    bundle_version="0.1.0",
    flows_dir="/path/to/flows",
)
```

Point `ABSTRACTGATEWAY_FLOWS_DIR` at that directory, or publish through the
Gateway API, to serve it alongside or instead of the shipped set. Keep your own
bundle id rather than reusing a shipped one — a version collision on an
immutable id is refused.

## Related

- [Production research workflow](deep-research.md) — the `deep-research` family in depth
- [Workflow authoring skill](workflow-authoring-skill.md) — conventions these flows follow
- [Workflow node catalog](workflow-node-catalog.md) — the nodes they are built from
