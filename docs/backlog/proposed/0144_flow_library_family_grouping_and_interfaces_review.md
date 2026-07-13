# 0144 — Flow Library family grouping + interfaces review

Status: BUILT 2026-07-12 (operator green-light same day: toggle + grouping +
headless iteration + corpus annotation; see CHANGELOG). The interfaces
GOVERNANCE lane (registry/validation, below) remains design-only. Build
deviations from the design, recorded:
- Cycle promotion promotes ONE member per interface-less cycle (the sweep
  then reaches the rest through expansion) rather than every member; the
  coverage invariant (nothing unreachable) holds and is test-pinned.
- Node/edge count pills were removed from list rows entirely (adversary J:
  300 pills of noise at library scale); the preview's Graph row carries them.
- The executable toggle is labeled "Runnable" (vocabulary unified with the
  badge + header count; ▶ reserved for actual run actions).
- Children sort name-asc within their parent by design; the sort dropdown
  applies to first-level rows only (mass-reshuffle rejection stands).
- Known deferred edges (adversary I P2): delete-warning over-claims when a
  saved flow shadows a bundled id (deleting resurfaces the original);
  expansion-key namespace uses bare ids for roots + path keys for children
  (theoretical collision if ids ever contain '>').
Method: two adversarial fable5 designers (G: grouping UX over the real
library dump; H: end-to-end interfaces audit across flow/runtime/gateway),
plus the uic seat discussion (commons c1033, answer pending — uic offline).

## The ask (operator, verbatim intent)

Workflow families built from subflows (dp-research + its 4 dp- helpers)
should visually regroup: deep-research at first level; click unfolds the
related subflows. Complication he named: one subflow can be used by several
workflows. Suspected needs: a "level" (executable vs helper), possibly via
`interfaces`; plus a full review of interfaces.

## Ground truth that shaped the design (real library dump)

- dp-research references dp-investigate/plan/render/review via
  `data.subflowId`; helpers declare `interfaces: []`.
- The library is a DAG, not a tree: `15f19f7f` (ac-update-status) is shared
  by NINE parents; `4189916b` forms a diamond; seven flows self-reference;
  `benchmark-agentic` carries dangling refs to flows that do not exist.
- Full graphs are already client-side (GET /visualflows returns them), so
  grouping is derivable with zero server work.

## Decided grouping design (adversary G — implementation-ready, unbuilt)

- REJECTED: name-prefix grouping (renames silently break groups; prefix
  boundaries undecidable in the real data), manual folders/tags (trees
  can't hold a DAG; retroactive labor), PURE derivation (cycles can hide
  runnable flows; shared helpers/orphans need rendering policy derivation
  cannot supply; mid-edit flap destroys spatial memory).
- CHOSEN: hybrid — derivation-first with a DECLARATION PIN.
  - refs(F) = distinct subflowId targets; inbound(H) counts DISTINCT other
    flows (self-references never count — `recursive` badge instead).
  - FIRST-LEVEL = interfaces non-empty (normalized) OR zero external
    inbound. Coverage sweep: interface-less cycles promote whole with a
    `cycle` badge. INVARIANT (test-pinned when built): no flow is ever
    unreachable in the UI.
  - A flow both referenced AND declaring runnable (live case: "ralph")
    renders first-level AND as a child under each parent — both facts true.
  - Shared helpers render under EVERY parent with `shared ×N`; rows are
    views, selection is by entity id (all instances highlight); the preview
    panel is the entity and gains a Family section (Used by / Uses).
  - Unfold = expand-in-place disclosure rows (children indent; nested
    disclosure for depth ≥2; per-path cycle guard renders `↻ cycle back to
    <name>`; per-parent multiplicity collapses to one row with `×K`).
  - Dangling refs render as error-toned `missing` child rows (the
    publish-time 400 surfaced at authoring time).
  - Search FLATTENS (browse mode vs lookup mode; helper hits carry an
    "in <parents>" subtitle); sort applies to first-level rows on their own
    fields only (no closure-recency bubbling — mass reshuffles rejected).
  - Standalone flows render byte-identical to today; top level gets ~25-30
    rows SHORTER on the current dump.
- Cross-surface rules: ONE derivation module (`flowFamilies.ts` when built;
  never a second copy); assistant AVAILABLE WORKFLOWS keeps helpers listed
  (composition targets) annotated "(used by N workflows)"; RunFlowModal
  keeps helpers directly runnable (debug loop) with a passive note; the
  library expansion uses the SAME closure as publish (what the group shows
  is what the bundle ships); delete warns naming parents; duplicate copies
  the root only (references stay shared, said in the toast).

## The "level" question (both adversaries, aligned)

NO new persisted role/level field. Role is a derived relationship (who
references whom); interfaces are capability declarations that serve as
EVIDENCE of top-level-ness (a pin over derived truth), never its
definition. A stored "helper" flag lies the moment a flow gains a host
interface or loses its last referencer. A reserved helper-marker interface
is worse (inverts the field's meaning; breaks the non-empty pin). The
assistant writes NOTHING when composing helpers — the parent's reference is
the filing act.

Two guards on the pin (adversary H):
1. Normalize before testing non-empty (gateway accepts `[""]` today —
   P1-6; the pin must read trimmed, empties-dropped).
2. Plan the pin's retirement in DATA: the honest rule is "declares an
   entrypoint-CLASS interface". Today every meaningful id is
   entrypoint-class, so raw non-empty works; the day contract-class ids
   ship (typing helper boundaries), the registry's `class` facet flips the
   pin to "∩ entrypoint-class ≠ ∅" as a data change, not a redesign.

## Interfaces audit verdict (adversary H, file:line in the session record)

Today: write-only, free-string self-declaration. One meaningful id
(abstractcode.agent.v1), one passive UI (FlowLibraryModal KNOWN_INTERFACES,
single entry), one boot-time warning (basic-agent only), a tested-but-
UNCALLED registry filter (resolve_entrypoint interface=; zero production
callers), and a LOST validation layer (0.3.0 had validation + pin
scaffolding in the deleted Python package — regression, not never-built).

- P0-1: no boundary anywhere can fail a violating declaration — an empty
  flow can declare agent.v1 and every layer accepts; the failure lands in
  the consuming client as an empty answer with no cause.
- P0-2: FlowLibraryModal hint text PROMISES "the editor will auto-add the
  required pins" — no such code exists. One-string fix, flagged.
- P0-3: the ruled pick-time gate (c721/c722, gateway c940) will certify
  presence-of-string as fitness unless publish-time contract validation
  lands with it.
- P1: no vocabulary owner (typos match nothing silently); the field is
  already a tag bag (abstractresearch.dp.v1 shipped with zero consumers);
  normalization diverges across writers; versioning is convention-by-
  example.

## "Anything else" verdicts

- RECOMMEND: gateway-served interface REGISTRY v0 (id → label, description,
  class ∈ entrypoint|contract|domain, pin-contract schema, owning package;
  semantics seat owns vocabulary rules; UIs replace local KNOWN_INTERFACES
  with fetch + #FALLBACK). Highest leverage; also the pin's retirement path.
- RECOMMEND PARTIAL: contract validation at PUBLISH, warn-first then
  ratchet (the boundary-derivation machinery exists gateway-side; save-time
  refusal rejected — flows under construction legitimately violate
  contracts mid-edit). Must land before/with the pick-time gate.
- REJECT: persisted role field; reserved helper-marker interface.
- REJECT NOW (revisit post-registry): interface-filtered composition — the
  assistant's pick-time catalog already carries full boundary contracts,
  which is stronger matching data than an id.
- RECOMMEND MINIMAL: versioning rule as documentation (ids are exact-match
  opaque strings; new major = new id; no negotiation), deprecation fields
  in the registry later (entrypoint deprecation store is the precedent).
- P2-9 latent bug to pin whenever the document format changes: the
  authoring document EXCLUDES interfaces deliberately (apply preserves
  them); if someone adds interfaces to the serializer without diff
  exclusion, every assistant turn would mass-strip declarations
  (omission=deletion). Needs a comment + round-trip test at that time.

## uic seam (discussion opened, commons c1033)

Kit-shaped ask (their call): a generic DisclosureList (tree rows, entity-
identity selection, keyboard nav over visible rows, flat-under-filter mode,
session-scoped expansion) + a semantic badge vocabulary (count/shared/
runnable/missing/cycle/bundled/current) on their token system. All grouping
SEMANTICS stay flow-side. uic offline at post time; answer pending.

## Minimal slice when green-lit

Grouping needs ZERO new interface machinery: normalized non-empty pin +
the derivation module + the modal rendering. The registry/validation work
is real but independent (governance lane). The only same-wave freebie: fix
the false scaffolding promise string (P0-2).
