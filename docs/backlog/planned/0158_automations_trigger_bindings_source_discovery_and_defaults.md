# 0158 — Automations: trigger-source discovery, trigger bindings and `automation_defaults`

- Status: PLANNED 2026-09-26 (operator ruling 7: every package writes its
  PLANNED items before the Automations v1 minor wave).
- Owner: flow (mission F of the Automations plan).
- Design: untracked/design/automations-PLAN.md (2026-09-26)
- Related: `abstractframework backlog 0928` (root Automations item);
  `proposed/0119_event_webhook_schedule_triggers_start_runs.md` (direction
  superseded for Flow, see "Conflicts" below).

## Summary

Flow becomes the authoring surface for automation triggers, without becoming
a scheduler:

1. a discovery client for the gateway's `GET /trigger-sources`;
2. a trigger-binding editor that binds an entrypoint flow to a discovered
   source and edits its `config` from the source's own `config_schema`;
3. export of the flow's defaults to `manifest.metadata.automation_defaults[flow_id]`
   when the flow is published;
4. an optional `trigger` output pin on On Flow Start when the flow declares the
   `abstractframework.triggerable.v1` interface.

The existing `on_schedule` / `on_event` / `wait_event` / `emit_event` /
`wait_until` nodes stay as they are: they time and signal work INSIDE a run.
They are not how automations are scheduled; the runtime automation controller
is (PLAN §3-D).

## Why

Operator constraint (untracked/design/astra/turn1.md, 2026-09-26), verbatim:

> i think i want the equivalent of a "Triggerable" interface, so that we can
> later bind Automation to different triggers (eg file changed; run finished or
> failed; email received; search completed; program built; critical decision
> gated to human; etc). we don't want them all now, but i think this may be
> useful if we declare it so that whenever we create new "triggerable"
> objects, they are automatically accessible to the framework.

PLAN §1, verbatim:

> **Extensible triggers.** “Trigger” is the user concept. Runtime
> `TriggerSource` adapters register once and become discoverable to hosts and
> apps.

> **One system.** An Automation is its root run. Gateway APIs and indexes
> project runtime truth; they do not independently schedule or execute work.

Operator rulings (appendix to the PLAN), verbatim:

> 3. Schedule + manual first; external triggers in the next phase: **agreed**,
>    but the next phase is a PLANNED backlog item, not proposed.

> 7. Release: the staged patch wave ships NOW (clean release); Automations v1
>    is the next minor wave; every package writes its PLANNED backlog items
>    first, in its own backlog structure.

Consequence for Flow: the list of trigger sources is runtime truth served by
the gateway. A new runtime `TriggerSource` adapter (entry-point group
`abstractruntime.trigger_sources`) must appear in the editor with no Flow code
or vocabulary change.

## Scope

In:
- `src/utils/triggerSources.ts` (name indicative): fetch + parse
  `GET /trigger-sources` → `{items:[TriggerSource+{available,unavailable_reason?}]}`;
  endpoint taken from the gateway capabilities contract like the other
  `flow_editor` endpoints (`endpointFromDescriptor`). A gateway that does not
  advertise the route shows "trigger sources unavailable on this gateway"; no
  local fallback list.
- `src/utils/triggerBindings.ts` (name indicative): pure functions — build a
  binding draft from a source, validate `config` against `config_schema`,
  detect stale bindings (`source_version` no longer served, source missing or
  `available:false`), normalize `automation_defaults`.
- Binding editor (Flow Library / flow properties area): pick an entrypoint
  flow (`isExecutableFlow`), pick a source, render a form from
  `config_schema` (JSON Schema subset already used by the Run modal input
  forms), edit context mode (`independent` default, `growing`) and default
  `input_data`. Unavailable sources are listed disabled with
  `unavailable_reason`.
- Persist defaults on the VisualFlow document (`VisualFlow.automation_defaults`,
  new optional field next to `interfaces`, src/types/flow.ts:487-507) and
  export them through publish into `manifest.metadata.automation_defaults[flow_id]`.
- `abstractframework.triggerable.v1` added to the interface vocabulary with ONE
  optional On Flow Start output pin `trigger` (type `object`) carrying the
  `TriggerEnvelope`. Declaring the interface adds the pin through the existing
  interface-pins path; preflight does not require it to be wired.
- Fix the `schedule` field comment (src/types/flow.ts:342) and the On Schedule /
  On Event node descriptions so they say "inside a run", not "entry point
  triggered by".

Out:
- Scheduling, firing, admission, pause/resume, occurrences, Discuss: runtime
  (R) and gateway (G). Automation management UI: Observer (O) / abstractuic (U).
- Any Flow-local list of trigger sources, or a source added to
  `KNOWN_INTERFACES`.
- Creating automations from the editor (`POST /automations`) in v1; the editor
  exports defaults, O creates automations from them.
- Changing the semantics of `on_schedule`/`on_event`/`wait_event`/`emit_event`/
  `wait_until`; external/event sources beyond schedule@1 and manual@1 (v2).
- Migration of flows whose entry is `on_schedule` (no automatic legacy migration,
  PLAN §5).

## Contracts (verbatim, PLAN §3-C)

```text
TriggerSource={
 id:string,version:int>=1,label:string,config_schema:JSONSchema,
 event_schema:JSONSchema,capabilities:{kind:"time"|"manual"|"event"}
}
TriggerBinding={
 binding_id:UUID,source_id:string,source_version:int,config:JSON
}
TriggerEnvelope={
 event_id:string,source_id:string,source_version:int,
 fired_at:timestamp,payload:JSON,binding_id:UUID
}
```

```text
schedule@1:{start_at?:timestamp,every?:string,until?:timestamp,
            count?:int>=1,anchor?:timestamp}
manual@1:{}
```

> Persist defaults `start_at=creation_time`, `anchor=start_at`; initially
> require equal values. `every` is a positive integer duration `[smhd]`; absent
> means one-shot. `count>1` requires `every`. Count scheduled admissions only;
> one coalesced firing counts once. `until` is exclusive.

Discovery route (PLAN §3-F):

```text
GET /trigger-sources → {items:[TriggerSource+{available,unavailable_reason?}]}
```

Catalog defaults (PLAN §3-F, verbatim):

> Catalog defaults: `manifest.metadata.automation_defaults[flow_id]`; trigger
> pin optional, prompt rendering only for compatible inputs.

The PLAN names the location but not the value shape. Proposed shape (to be
ratified with G, which projects it into the catalog):

```text
automation_defaults[flow_id] = {
 schema_version:1,
 title?:string,
 trigger:{source_id:string,source_version:int,config:JSON},  // TriggerBinding minus binding_id (server-owned)
 context?:{mode:"independent"|"growing"="independent"},
 input_data?:JSON={}
}
```

`binding_id`, timestamps and revisions are server-owned (PLAN §3-A); the
editor never mints them. `context.growing.summary` is not exported
(`unsupported_feature` in v1).

## Current code reality (verified 2026-09-26 at 1543c43)

- `src/types/nodes.ts:43-54` On Flow Start template: outputs `exec-out` only;
  data pins come from declared interfaces via `src/utils/flowFamilies.ts`
  (`applyInterfacePins`/`withInterfacePins`/`missingInterfacePins`, :278-323).
- `src/types/nodes.ts:111-127` `on_schedule` (pins `schedule`, `recurrent`;
  description "Entry point triggered by a schedule"); default
  `eventConfig: { schedule: '15s', recurrent: true }` at :2817.
- `src/types/nodes.ts:128-144` `on_event` (description "Entry point triggered
  by a durable custom event"); default `{ name: 'my_event', scope: 'session' }`
  at :2816.
- `src/types/nodes.ts:145-169` `wait_event`; `:170-190` `emit_event`;
  `:191-205` `wait_until` (Delay).
- These compile to waits inside an already-started run (runtime
  `visualflow_compiler/compiler.py:3763`, `:4653` →
  `adapters/event_adapter.py:98` `create_on_schedule_node_handler`). Nothing
  cold-starts a flow from them (see 0119).
- `src/types/flow.ts:342`: `schedule?: string; // For on_schedule: cron
  expression or interval`. The runtime accepts only an interval
  `^\d+(\.\d+)?(ms|s|m|h|d)$` or an ISO timestamp and raises otherwise
  (abstractruntime `adapters/event_adapter.py:134`, `:156-157`). The comment is
  wrong; cron is also not part of schedule@1 (`every` is `[smhd]` only).
- `src/utils/flowFamilies.ts:52-198` `KNOWN_INTERFACES` (closes :199): a LOCAL
  vocabulary of 10 host contracts ("Replaced by a gateway-served registry when
  the governance lane ships", :48-51). Trigger sources must be discovered from
  the gateway, never added here.
- `src/utils/flowFamilies.ts:325-328` `isExecutableFlow` (doc comment :325,
  function :326): a flow is executable iff it declares an entrypoint-class
  interface. The binding editor offers only such flows.
- `KnownInterface` supports `requiredStartPins`/`requiredEndPins` only
  (flowFamilies.ts:37-46); there is no optional-pin notion yet.
- `src/types/flow.ts:487-507` `VisualFlow`: `interfaces`, `functions`; no
  automation field.
- Publish: the editor calls `/api/gateway/visualflows/{flow_id}/publish`
  (`src/components/PublishFlowModal.tsx:43`). The gateway builds
  `manifest.metadata` server-side (`abstractgateway/routes/gateway.py:6933-6946`:
  lifecycle, publisher, source, lineage) and passes it to
  `pack_workflow_bundle` (`:6958`; runtime `workflow_bundle/packer.py:310`).
  Nothing from the flow document reaches `metadata` today, so the export needs
  a G change (seam below).
- No `trigger-sources`, `automation_defaults` or `triggerable` reference exists
  in `src/` or `docs/`.

Pattern to follow: the 2026-09-26 interface-pins work — e22bb71 (declaring an
interface adds its pins to On Flow Start/End; one undo step; loadFlow adds
missing pins without a dirty loop; preflight warns on missing required pins),
09e9abb (pins on new boundary nodes, authoring commands), e78bc9c (bundled
flows declare the pins; `bundledFlows.test.ts` asserts it).

## Seams

- F reads R's descriptors, but only through G's `/trigger-sources`; Flow has no
  Python/runtime import (PLAN §3-I: no artificial Python dependencies for Flow).
- F reads G's catalog projection of `automation_defaults` to verify the
  round-trip; G owns the projection and the publish-time copy into
  `manifest.metadata`.
- O reads F's defaults export (from the catalog) to prefill automation creation.
- Before writing code: read the live G route, its capabilities descriptor and
  the catalog projection. If absent, the editor fails loudly (unavailable
  state), and a `blocked` ask goes to the gateway seat; no hedged fallback.

## Tests

`src/utils/trigger_bindings.test.ts` (name fixed by the PLAN):
- a source unknown to Flow (fixture id `fixture_source@1`, not referenced
  anywhere in `src/`) is listed, bound and validated purely from its
  descriptor;
- `available:false` sources are listed and not bindable; stale
  `source_version` is reported;
- schedule@1 rules: `every` `[smhd]` only, `count>1` requires `every`, cron
  strings rejected; manual@1 accepts only `{}`;
- `automation_defaults` normalize/export/import round-trip through a bundle
  manifest fixture (`manifest.metadata.automation_defaults[flow_id]`), unknown
  fields rejected;
- declaring `abstractframework.triggerable.v1` adds the `trigger` pin once,
  undeclaring never removes it, preflight does not warn when it is unwired;
  a flow without it stays a valid target.
Plus: `flowFamilies.test.ts` and `bundledFlows.test.ts` stay green.

## Definition of Done

- Sources appear without vocabulary edits: a new runtime adapter served by the
  gateway shows up in the binding editor with no Flow change (proved by the
  fixture source test and one live check against a gateway serving
  schedule@1 and manual@1).
- Defaults round-trip through a bundle manifest: set in the editor → publish →
  `manifest.metadata.automation_defaults[flow_id]` → catalog → reopened in the
  editor unchanged.
- The `trigger` pin carries a `TriggerEnvelope` in a controller-started run
  (with G/R integration).
- flow.ts:342 comment and the on_schedule/on_event descriptions no longer
  claim cron or cold-start behaviour; docs (coredoc pass) describe in-run
  timing nodes vs automation triggers.
- tsc, vitest and build green.

## Dependencies

- G: `GET /trigger-sources` route + capabilities descriptor; publish copies
  `automation_defaults` into `manifest.metadata`; catalog projection.
- R: `TriggerSource` descriptors for schedule@1 and manual@1 (served via G).
- Name and pin shape of `abstractframework.triggerable.v1` agreed with R/G
  (the controller supplies the envelope).

## Conflicts and open points

- The PLAN does not name `abstractframework.triggerable.v1` nor fix the
  `automation_defaults` value shape; both come from the Flow mission letter
  and are proposals above until G ratifies them.
- Route prefix: the PLAN writes `GET /trigger-sources`; every gateway route the
  editor uses lives under `/api/gateway/`. Take the path from the capabilities
  descriptor.
- Optional vs required interface pins: `KnownInterface` only has required
  pins; the triggerable pin needs an optional-pin notion (or a `contract`
  class interface whose pin preflight never requires).
- `proposed/0119` proposes a gateway registry where publishing an
  `on_schedule`/`on_event` entry flow registers a subscription. The PLAN rejects
  that path (runtime controller, no parallel scheduler); 0119's catalog-text
  honesty fix is folded into this item. 0119 should be re-scoped to v2 external
  admission or closed when this item lands.

## Contracts pass (2026-09-27)

Final contracts: untracked/design/automations-CONTRACTS.md (root repo; rev 2 with Astra turn-6 amendments 1–11). They supersede the contract text copied above; earlier text is kept as history. Concrete changes for this item:

- Dropped for v1: the optional `trigger` pin and `abstractframework.triggerable.v1` (an optional-pin notion is not trivial: `missingInterfacePins` drives insertion and preflight). The trigger reaches the target rendered into the prompt.
- `automation_defaults` = one top-level object on the VisualFlow: `{schema_version:1, title?, trigger:{source_id,source_version,config}, context:{mode}, input_data}`; the gateway accepts it on save and projects it at publish as `metadata.automation_defaults[root flow_id]`.
- Discovery endpoint from capabilities `automations.trigger_sources_endpoint` (`/api/gateway/trigger-sources`); built-in sources are always served, third-party ones may be `available:false`.
- schedule@1 is fixed UTC intervals: labels say "every 24 hours", never "daily at … local"; a one-shot binding has exactly one tick at `start_at`.
