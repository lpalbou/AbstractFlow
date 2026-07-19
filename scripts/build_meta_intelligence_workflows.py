#!/usr/bin/env python3
"""Build the meta-intelligence workflow family (operator ask 2026-07-16).

Five co-orchestration patterns that mimic distinct facets of human
deliberation — instead of one LLM answering directly, several LLM calls
absorb the question, consider it under different angles, engage in meta
reflection/introspection, and only then answer. Each flow conforms to
abstractcode.agent.v1 (prompt/provider/model in; response/success/meta out)
so it is DIRECTLY comparable to an isolated single call on the same prompt —
the operator's benchmark question ("do they behave better, by how much?") is
answerable by swapping the workflow id.

The five patterns (each grounded in a published result):

- meta-consensus   Self-consistency: N independent answers (default 2) at
                   different temperatures, then a reconciler that compares
                   them, keeps agreements, resolves divergences, and writes
                   the consensus answer. (Wang et al., Self-Consistency.)
- meta-debate      Adversarial dialectic: proposer answers; a challenger
                   attacks the answer (flaws, counterexamples, missing
                   cases); the proposer then defends-or-concedes point by
                   point and writes the final position. (Du et al.,
                   multi-agent debate.)
- meta-reflect     Introspection: draft answer; a metacognition pass reads
                   the draft and interrogates the REASONING itself
                   (assumptions, gaps, overconfidence, what a domain expert
                   would object to); a revision pass rewrites the answer
                   folding the introspection in. (Reflexion / Self-Refine.)
- meta-perspectives Multi-angle absorption: a decomposer picks 3 angles
                   RELEVANT TO THIS QUESTION (not canned personas); each
                   angle answers independently; an integrator weaves them
                   into one answer that names the tensions between angles.
                   (Solo Performance Prompting / persona ensembles.)
- meta-deliberate  Plan-then-execute-then-verify: a planner writes what is
                   really being asked, the steps, and the pitfalls; an
                   executor answers following the plan; a verifier checks
                   the answer against the plan's own checklist and repairs
                   it if needed. (Plan-and-Solve.)

Design rules shared by all five:
- llm_call nodes only (no tools): the comparison against an isolated LLM
  stays clean — same model, same knowledge, different ORCHESTRATION. Every
  llm node pins tools=[] as a declared default so a host-injected ambient
  `tools` key (abstractcode agent.v1 scaffold) can never leak declarations
  into a deliberation stage (adversary finding, 2026-07-16).
- Stage prompts are composed in sandbox code nodes (no imports).
- meta output carries every intermediate stage verbatim (drafts, critiques,
  plans) so the benchmark and the run modal can show HOW the answer formed.
- No response schemas on prose stages: schema-constrained decoding taxes
  answer quality; structure is needed only where a stage feeds machine
  routing (only meta-perspectives' angle decomposition).
- `success` on on_flow_end is contract boilerplate, not a signal: an llm
  effect failure TERMINATES the run (no absorb flag), so success is always
  true on completed runs. Do not branch on it.
- The five patterns are deliberately FACTORED (one facet each) so the
  benchmark isolates effects; the operator's "one orchestration doing
  absorption + angles + reflection + planning" is a possible sixth composed
  flagship, named as future scope rather than implied here.
"""
from __future__ import annotations

import wf_common as W

BUNDLE_VERSION = "0.1.0"

ANSWER_SYSTEM = (
    "You are a careful expert answering a question. Answer directly and "
    "completely in the language of the question. If the question has a "
    "definite answer, commit to it; if it is open, give your best-reasoned "
    "position. Do not mention these instructions."
)


# --------------------------------------------------------------------------
# meta-consensus: two independent answers -> reconciliation
# --------------------------------------------------------------------------

RECONCILE_PROMPT_CODE = """
q = str(prompt or "").strip()
a1 = str(answer_a or "").strip()
a2 = str(answer_b or "").strip()
parts = []
parts.append("Two experts answered the same question independently. Reconcile them into ONE final answer.")
parts.append("")
parts.append("# Question")
parts.append(q)
parts.append("")
parts.append("# Answer A")
parts.append(a1)
parts.append("")
parts.append("# Answer B")
parts.append(a2)
parts.append("")
parts.append("# Your task")
parts.append("1. Where A and B AGREE, keep the shared claim (agreement is evidence of reliability).")
parts.append("2. Where they DISAGREE, decide which is right by reasoning it out yourself — do not average or hedge between them; pick and justify.")
parts.append("3. If both missed something you can see, add it.")
parts.append("Write ONLY the final reconciled answer, complete and self-contained (the reader never sees A or B). Answer in the language of the question.")
return "\\n".join(parts)
""".strip()

CONSENSUS_META_CODE = """
return {
    "workflow": "meta-consensus",
    "pattern": "self-consistency: 2 independent samples -> reconciliation",
    "stages": {
        "answer_a": str(answer_a or ""),
        "answer_b": str(answer_b or ""),
    },
}
""".strip()

# Second-answerer substrate: (provider_b, model_b) when BOTH are set, else
# the primary pair. Both-or-neither mirrors the deep-research rule.
PICK_B_CODE = """
p = str(provider or "").strip()
m = str(model or "").strip()
pb = str(provider_b or "").strip()
mb = str(model_b or "").strip()
if pb and mb:
    return {"provider": pb, "model": mb}
if pb or mb:
    raise ValueError("provider_b and model_b must both be set, or both left blank")
return {"provider": p, "model": m}
""".strip()


def build_consensus() -> dict:
    flow = W.base_flow(
        "meta-consensus", "meta-consensus",
        "Meta-intelligence: two independent LLM answers reconciled into one consensus answer — agreement is kept as reliable, divergence is resolved by reasoning, not averaged. Diversity comes from temperature (0.3 vs 0.9) by default, or from a genuinely different second model via the optional provider_b/model_b inputs. Self-consistency pattern; comparable 1:1 against an isolated LLM call on the same prompt. Consensus across N>2 answerers needs a loop-based flow (future scope).",
        [W.AGENT_INTERFACE, "abstractmeta.intelligence.v1"],
    )
    flow["nodes"] = [
        W.start_node("Question", [
            W.pin("prompt", "prompt", "string"),
            W.pin("provider", "provider", "provider_text"),
            W.pin("model", "model", "model"),
            W.pin("tools", "tools", "array"),
            # Optional second substrate: leave blank to sample the SAME model
            # twice (temperature-diverse); set both for true two-model
            # consensus ("consensus between X LLMs" — X=2 shipped static,
            # operator's simplification; N>2 named as future loop flow).
            W.pin("provider_b", "provider_b", "provider_text"),
            W.pin("model_b", "model_b", "model"),
        ], -900, 0, pin_defaults={"prompt": "", "provider_b": "", "model_b": ""}),
        W.llm_node("answer_a", "Independent answer A", -560, -160,
                   pin_defaults={"system": ANSWER_SYSTEM, "temperature": 0.3}),
        W.llm_node("answer_b", "Independent answer B", -220, -160,
                   pin_defaults={"system": ANSWER_SYSTEM, "temperature": 0.9}),
        # Route: answer_b uses (provider_b, model_b) when BOTH set, else the
        # primary pair. Pure code node: no exec pins, pulled on demand.
        W.code_node("pick_b", "Second substrate", PICK_B_CODE, -560, 200,
                    [W.pin("provider", "provider", "provider_text"),
                     W.pin("model", "model", "model"),
                     W.pin("provider_b", "provider_b", "provider_text"),
                     W.pin("model_b", "model_b", "model")]),
        W.code_node("reconcile_prompt", "Compose reconciliation", RECONCILE_PROMPT_CODE, 60, 120,
                    [W.pin("prompt", "prompt", "string"),
                     W.pin("answer_a", "answer_a", "string"),
                     W.pin("answer_b", "answer_b", "string")],
                    output_type="string"),
        W.llm_node("reconcile", "Reconcile to consensus", 340, -160,
                   pin_defaults={"system": "You are the reconciler: you merge independent expert answers into one final answer, resolving disagreements by your own reasoning.", "temperature": 0.2}),
        W.code_node("meta", "Collect stages", CONSENSUS_META_CODE, 620, 120,
                    [W.pin("answer_a", "answer_a", "string"),
                     W.pin("answer_b", "answer_b", "string")]),
        W.end_node("Final answer", [
            W.pin("response", "response", "string"),
            W.pin("success", "success", "boolean"),
            W.pin("meta", "meta", "object"),
        ], 900, -160),
    ]
    flow["edges"] = [
        W.edge("start", "exec-out", "answer_a", "exec-in", animated=True),
        W.edge("answer_a", "exec-out", "answer_b", "exec-in", animated=True),
        W.edge("answer_b", "exec-out", "reconcile", "exec-in", animated=True),
        W.edge("reconcile", "exec-out", "end", "exec-in", animated=True),
        W.edge("start", "prompt", "answer_a", "prompt"),
        W.edge("start", "prompt", "answer_b", "prompt"),
        W.edge("start", "provider", "answer_a", "provider"),
        W.edge("start", "provider", "reconcile", "provider"),
        W.edge("start", "model", "answer_a", "model"),
        W.edge("start", "model", "reconcile", "model"),
        # answer_b's substrate resolves through pick_b (primary unless both
        # provider_b/model_b are set)
        W.edge("start", "provider", "pick_b", "provider"),
        W.edge("start", "model", "pick_b", "model"),
        W.edge("start", "provider_b", "pick_b", "provider_b"),
        W.edge("start", "model_b", "pick_b", "model_b"),
        W.edge("pick_b", "provider", "answer_b", "provider"),
        W.edge("pick_b", "model", "answer_b", "model"),
        W.edge("start", "prompt", "reconcile_prompt", "prompt"),
        W.edge("answer_a", "response", "reconcile_prompt", "answer_a"),
        W.edge("answer_b", "response", "reconcile_prompt", "answer_b"),
        W.edge("reconcile_prompt", "output", "reconcile", "prompt"),
        W.edge("answer_a", "response", "meta", "answer_a"),
        W.edge("answer_b", "response", "meta", "answer_b"),
        W.edge("reconcile", "response", "end", "response"),
        W.edge("reconcile", "success", "end", "success"),
        W.edge("meta", "output", "end", "meta"),
    ]
    return flow


# --------------------------------------------------------------------------
# meta-debate: proposer -> challenger -> defended synthesis
# --------------------------------------------------------------------------

CHALLENGE_PROMPT_CODE = """
q = str(prompt or "").strip()
a = str(answer or "").strip()
parts = []
parts.append("An expert proposed an answer. Your job is to ATTACK it — find what is wrong, weak, or missing. You win by finding real flaws, not by nitpicking style.")
parts.append("")
parts.append("# Question")
parts.append(q)
parts.append("")
parts.append("# Proposed answer")
parts.append(a)
parts.append("")
parts.append("# Attack")
parts.append("List the strongest objections: factual errors, logical gaps, unstated assumptions, missed cases, counterexamples. For each: what is wrong and WHY. If a part of the answer is solid, say so in one line — do not invent objections against sound reasoning.")
return "\\n".join(parts)
""".strip()

DEFEND_PROMPT_CODE = """
q = str(prompt or "").strip()
a = str(answer or "").strip()
c = str(challenge or "").strip()
parts = []
parts.append("You proposed an answer; a challenger attacked it. Produce the FINAL answer.")
parts.append("")
parts.append("# Question")
parts.append(q)
parts.append("")
parts.append("# Your original answer")
parts.append(a)
parts.append("")
parts.append("# The challenger's objections")
parts.append(c)
parts.append("")
parts.append("# Your task")
parts.append("Go through the objections honestly: CONCEDE and fix the ones that are right; REBUT the ones that are wrong (say why). Then write the final answer, complete and self-contained — the reader never sees the debate. Answer in the language of the question.")
return "\\n".join(parts)
""".strip()

DEBATE_META_CODE = """
return {
    "workflow": "meta-debate",
    "pattern": "adversarial dialectic: propose -> attack -> defend/concede -> final",
    "stages": {
        "proposal": str(proposal or ""),
        "challenge": str(challenge or ""),
    },
}
""".strip()


def build_debate() -> dict:
    flow = W.base_flow(
        "meta-debate", "meta-debate",
        "Meta-intelligence: proposer answers, an adversarial challenger attacks the answer (flaws, counterexamples, missing cases), then the proposer concedes-or-rebuts point by point and writes the defended final answer. Multi-agent debate pattern; comparable 1:1 against an isolated LLM call.",
        [W.AGENT_INTERFACE, "abstractmeta.intelligence.v1"],
    )
    flow["nodes"] = [
        W.start_node("Question", [
            W.pin("prompt", "prompt", "string"),
            W.pin("provider", "provider", "provider_text"),
            W.pin("model", "model", "model"),
            # Declared for agent.v1 contract honesty (hosts may set it);
            # deliberately unwired — every llm node pins tools=[] so the
            # deliberation stages stay tool-free by design.
            W.pin("tools", "tools", "array"),
        ], -900, 0, pin_defaults={"prompt": ""}),
        W.llm_node("propose", "Propose answer", -560, -160,
                   pin_defaults={"system": ANSWER_SYSTEM, "temperature": 0.3}),
        W.code_node("challenge_prompt", "Compose attack brief", CHALLENGE_PROMPT_CODE, -280, 120,
                    [W.pin("prompt", "prompt", "string"),
                     W.pin("answer", "answer", "string")],
                    output_type="string"),
        W.llm_node("challenge", "Adversarial challenge", -220, -160,
                   pin_defaults={"system": "You are a rigorous adversarial reviewer. You attack answers to expose real flaws; you never invent objections against sound reasoning.", "temperature": 0.7}),
        W.code_node("defend_prompt", "Compose defense brief", DEFEND_PROMPT_CODE, 60, 120,
                    [W.pin("prompt", "prompt", "string"),
                     W.pin("answer", "answer", "string"),
                     W.pin("challenge", "challenge", "string")],
                    output_type="string"),
        W.llm_node("defend", "Defend and finalize", 340, -160,
                   pin_defaults={"system": "You finalize answers after adversarial review: concede what the challenger got right, rebut what they got wrong, and write the definitive answer.", "temperature": 0.2}),
        W.code_node("meta", "Collect stages", DEBATE_META_CODE, 620, 120,
                    [W.pin("proposal", "proposal", "string"),
                     W.pin("challenge", "challenge", "string")]),
        W.end_node("Final answer", [
            W.pin("response", "response", "string"),
            W.pin("success", "success", "boolean"),
            W.pin("meta", "meta", "object"),
        ], 900, -160),
    ]
    flow["edges"] = [
        W.edge("start", "exec-out", "propose", "exec-in", animated=True),
        W.edge("propose", "exec-out", "challenge", "exec-in", animated=True),
        W.edge("challenge", "exec-out", "defend", "exec-in", animated=True),
        W.edge("defend", "exec-out", "end", "exec-in", animated=True),
        W.edge("start", "prompt", "propose", "prompt"),
        W.edge("start", "provider", "propose", "provider"),
        W.edge("start", "provider", "challenge", "provider"),
        W.edge("start", "provider", "defend", "provider"),
        W.edge("start", "model", "propose", "model"),
        W.edge("start", "model", "challenge", "model"),
        W.edge("start", "model", "defend", "model"),
        W.edge("start", "prompt", "challenge_prompt", "prompt"),
        W.edge("propose", "response", "challenge_prompt", "answer"),
        W.edge("challenge_prompt", "output", "challenge", "prompt"),
        W.edge("start", "prompt", "defend_prompt", "prompt"),
        W.edge("propose", "response", "defend_prompt", "answer"),
        W.edge("challenge", "response", "defend_prompt", "challenge"),
        W.edge("defend_prompt", "output", "defend", "prompt"),
        W.edge("propose", "response", "meta", "proposal"),
        W.edge("challenge", "response", "meta", "challenge"),
        W.edge("defend", "response", "end", "response"),
        W.edge("defend", "success", "end", "success"),
        W.edge("meta", "output", "end", "meta"),
    ]
    return flow


# --------------------------------------------------------------------------
# meta-reflect: draft -> introspection -> revision
# --------------------------------------------------------------------------

INTROSPECT_PROMPT_CODE = """
q = str(prompt or "").strip()
d = str(draft or "").strip()
parts = []
parts.append("You wrote the draft answer below. Now step OUTSIDE it and interrogate your own reasoning — this is introspection, not editing.")
parts.append("")
parts.append("# Question")
parts.append(q)
parts.append("")
parts.append("# Your draft")
parts.append(d)
parts.append("")
parts.append("# Interrogate the reasoning")
parts.append("- What am I ASSUMING without saying so? Are those assumptions safe here?")
parts.append("- Where am I most likely WRONG — which step of the reasoning is weakest?")
parts.append("- What did I NOT consider: edge cases, alternative interpretations of the question, contrary evidence?")
parts.append("- Am I overconfident anywhere — stating as fact what is actually judgment?")
parts.append("- What would a domain expert immediately object to?")
parts.append("Write the introspection as honest notes to yourself. If a part of the draft survives scrutiny, say so.")
return "\\n".join(parts)
""".strip()

REVISE_PROMPT_CODE = """
q = str(prompt or "").strip()
d = str(draft or "").strip()
i = str(introspection or "").strip()
parts = []
parts.append("Rewrite your draft into the final answer, folding in what the introspection exposed.")
parts.append("")
parts.append("# Question")
parts.append(q)
parts.append("")
parts.append("# Draft")
parts.append(d)
parts.append("")
parts.append("# Introspection notes")
parts.append(i)
parts.append("")
parts.append("# Your task")
parts.append("Fix what the introspection showed to be weak or wrong; keep what survived scrutiny; calibrate confidence honestly (state judgment as judgment). Write ONLY the final answer, complete and self-contained. Answer in the language of the question.")
return "\\n".join(parts)
""".strip()

REFLECT_META_CODE = """
return {
    "workflow": "meta-reflect",
    "pattern": "introspection: draft -> interrogate own reasoning -> revise",
    "stages": {
        "draft": str(draft or ""),
        "introspection": str(introspection or ""),
    },
}
""".strip()


def build_reflect() -> dict:
    flow = W.base_flow(
        "meta-reflect", "meta-reflect",
        "Meta-intelligence: draft an answer, then an introspection pass interrogates the reasoning itself (assumptions, weakest step, missed cases, overconfidence), then a revision folds the introspection into the final answer. Reflexion/Self-Refine pattern; comparable 1:1 against an isolated LLM call.",
        [W.AGENT_INTERFACE, "abstractmeta.intelligence.v1"],
    )
    flow["nodes"] = [
        W.start_node("Question", [
            W.pin("prompt", "prompt", "string"),
            W.pin("provider", "provider", "provider_text"),
            W.pin("model", "model", "model"),
            # Declared for agent.v1 contract honesty (hosts may set it);
            # deliberately unwired — every llm node pins tools=[] so the
            # deliberation stages stay tool-free by design.
            W.pin("tools", "tools", "array"),
        ], -900, 0, pin_defaults={"prompt": ""}),
        W.llm_node("draft", "Draft answer", -560, -160,
                   pin_defaults={"system": ANSWER_SYSTEM, "temperature": 0.3}),
        W.code_node("introspect_prompt", "Compose introspection", INTROSPECT_PROMPT_CODE, -280, 120,
                    [W.pin("prompt", "prompt", "string"),
                     W.pin("draft", "draft", "string")],
                    output_type="string"),
        W.llm_node("introspect", "Introspection pass", -220, -160,
                   pin_defaults={"system": "You interrogate your own drafts with ruthless honesty: assumptions, weakest steps, missed cases, overconfidence. You are writing notes to yourself, not to a reader.", "temperature": 0.5}),
        W.code_node("revise_prompt", "Compose revision", REVISE_PROMPT_CODE, 60, 120,
                    [W.pin("prompt", "prompt", "string"),
                     W.pin("draft", "draft", "string"),
                     W.pin("introspection", "introspection", "string")],
                    output_type="string"),
        W.llm_node("revise", "Revised final answer", 340, -160,
                   pin_defaults={"system": "You produce final answers that fold self-critique in: fixed where wrong, kept where sound, confidence stated honestly.", "temperature": 0.2}),
        W.code_node("meta", "Collect stages", REFLECT_META_CODE, 620, 120,
                    [W.pin("draft", "draft", "string"),
                     W.pin("introspection", "introspection", "string")]),
        W.end_node("Final answer", [
            W.pin("response", "response", "string"),
            W.pin("success", "success", "boolean"),
            W.pin("meta", "meta", "object"),
        ], 900, -160),
    ]
    flow["edges"] = [
        W.edge("start", "exec-out", "draft", "exec-in", animated=True),
        W.edge("draft", "exec-out", "introspect", "exec-in", animated=True),
        W.edge("introspect", "exec-out", "revise", "exec-in", animated=True),
        W.edge("revise", "exec-out", "end", "exec-in", animated=True),
        W.edge("start", "prompt", "draft", "prompt"),
        W.edge("start", "provider", "draft", "provider"),
        W.edge("start", "provider", "introspect", "provider"),
        W.edge("start", "provider", "revise", "provider"),
        W.edge("start", "model", "draft", "model"),
        W.edge("start", "model", "introspect", "model"),
        W.edge("start", "model", "revise", "model"),
        W.edge("start", "prompt", "introspect_prompt", "prompt"),
        W.edge("draft", "response", "introspect_prompt", "draft"),
        W.edge("introspect_prompt", "output", "introspect", "prompt"),
        W.edge("start", "prompt", "revise_prompt", "prompt"),
        W.edge("draft", "response", "revise_prompt", "draft"),
        W.edge("introspect", "response", "revise_prompt", "introspection"),
        W.edge("revise_prompt", "output", "revise", "prompt"),
        W.edge("draft", "response", "meta", "draft"),
        W.edge("introspect", "response", "meta", "introspection"),
        W.edge("revise", "response", "end", "response"),
        W.edge("revise", "success", "end", "success"),
        W.edge("meta", "output", "end", "meta"),
    ]
    return flow


# --------------------------------------------------------------------------
# meta-perspectives: angle decomposition -> 3 angle answers -> integration
# --------------------------------------------------------------------------

ANGLES_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["angles"],
    "properties": {
        "angles": {
            "type": "array", "minItems": 3, "maxItems": 3,
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["name", "focus"],
                "properties": {
                    "name": {"type": "string"},
                    "focus": {"type": "string"},
                },
            },
        },
    },
}

ANGLES_PROMPT_CODE = """
q = str(prompt or "").strip()
parts = []
parts.append("Before answering, decide how this question should be LOOKED AT. Pick the 3 most revealing, mutually distinct angles for THIS question — not generic roles.")
parts.append("")
parts.append("# Question")
parts.append(q)
parts.append("")
parts.append("Examples of what an angle can be (pick what fits THIS question): a discipline (economist, biologist), a stance (skeptic, advocate), a timescale (short-term, long-term), a stakeholder (user, operator), a method (empirical, theoretical). For each angle give: name, and focus = the one question this angle presses on.")
return "\\n".join(parts)
""".strip()

ANGLE_PROMPT_CODE = """
q = str(prompt or "").strip()
data = angles if isinstance(angles, dict) else {}
items = data.get("angles")
# Type-guard the structured decompose: the executor stores schema-parse
# results in `data` even when validation failed, so a schema-shaped-but-
# wrong payload (e.g. angles as a string) must degrade to generic labels,
# never crash (adversary finding 3).
items = items if isinstance(items, list) else []
i = int(index or 0)
a = items[i] if i < len(items) else {}
a = a if isinstance(a, dict) else {}
name = str(a.get("name") or ("angle " + str(i + 1)))
focus = str(a.get("focus") or "")
parts = []
parts.append("Answer the question below FROM ONE ANGLE ONLY. You are: " + name + ".")
if focus:
    parts.append("Your angle presses on: " + focus)
parts.append("")
parts.append("# Question")
parts.append(q)
parts.append("")
parts.append("Give the answer AS SEEN FROM YOUR ANGLE, concise (under 250 words): what this angle sees that others miss, and what it concludes. Do not try to be balanced — that is the integrator's job, not yours.")
return "\\n".join(parts)
""".strip()

INTEGRATE_PROMPT_CODE = """
q = str(prompt or "").strip()
data = angles if isinstance(angles, dict) else {}
items = data.get("angles")
items = items if isinstance(items, list) else []
views = [str(view_a or ""), str(view_b or ""), str(view_c or "")]
parts = []
parts.append("Three angle-experts examined the same question. Integrate their views into ONE final answer.")
parts.append("")
parts.append("# Question")
parts.append(q)
for i, v in enumerate(views):
    label = "Angle " + str(i + 1)
    if i < len(items) and isinstance(items[i], dict):
        label = label + " (" + str(items[i].get("name") or "") + ")"
    parts.append("")
    parts.append("# " + label)
    parts.append(v.strip())
parts.append("")
parts.append("# Your task")
parts.append("Write the final answer: integrate what the angles agree on, NAME the real tensions between them (do not paper over disagreement — say which consideration should win and why), and conclude. Complete and self-contained; the reader never sees the angle views. Answer in the language of the question.")
return "\\n".join(parts)
""".strip()

PERSPECTIVES_META_CODE = """
data = angles if isinstance(angles, dict) else {}
items = data.get("angles")
return {
    "workflow": "meta-perspectives",
    "pattern": "multi-angle: decompose into 3 question-specific angles -> answer each -> integrate",
    "stages": {
        "angles": items if isinstance(items, list) else [],
        "view_a": str(view_a or ""),
        "view_b": str(view_b or ""),
        "view_c": str(view_c or ""),
    },
}
""".strip()


def build_perspectives() -> dict:
    flow = W.base_flow(
        "meta-perspectives", "meta-perspectives",
        "Meta-intelligence: a decomposer picks the 3 most revealing angles for THIS question (disciplines, stances, timescales, stakeholders...), each angle answers independently, then an integrator weaves them into one answer that names the tensions between angles instead of papering over them. Comparable 1:1 against an isolated LLM call.",
        [W.AGENT_INTERFACE, "abstractmeta.intelligence.v1"],
    )
    angle_defaults = {"system": "You answer questions from one assigned angle only, sharply — balance is someone else's job.", "temperature": 0.6}
    flow["nodes"] = [
        W.start_node("Question", [
            W.pin("prompt", "prompt", "string"),
            W.pin("provider", "provider", "provider_text"),
            W.pin("model", "model", "model"),
            # Declared for agent.v1 contract honesty (hosts may set it);
            # deliberately unwired — every llm node pins tools=[] so the
            # deliberation stages stay tool-free by design.
            W.pin("tools", "tools", "array"),
        ], -1240, 0, pin_defaults={"prompt": ""}),
        W.code_node("angles_prompt", "Compose angle brief", ANGLES_PROMPT_CODE, -960, 120,
                    [W.pin("prompt", "prompt", "string")], output_type="string"),
        W.llm_node("decompose", "Pick 3 angles", -900, -160,
                   pin_defaults={"system": "You choose the most revealing, mutually distinct angles to examine a question from — specific to the question, never generic.", "temperature": 0.4, "resp_schema": ANGLES_SCHEMA}),
        W.code_node("angle_a_prompt", "Angle 1 brief", ANGLE_PROMPT_CODE, -620, 120,
                    [W.pin("prompt", "prompt", "string"),
                     W.pin("angles", "angles", "object"),
                     W.pin("index", "index", "number")], output_type="string"),
        W.code_node("angle_b_prompt", "Angle 2 brief", ANGLE_PROMPT_CODE, -340, 120,
                    [W.pin("prompt", "prompt", "string"),
                     W.pin("angles", "angles", "object"),
                     W.pin("index", "index", "number")], output_type="string"),
        W.code_node("angle_c_prompt", "Angle 3 brief", ANGLE_PROMPT_CODE, -60, 120,
                    [W.pin("prompt", "prompt", "string"),
                     W.pin("angles", "angles", "object"),
                     W.pin("index", "index", "number")], output_type="string"),
        W.llm_node("view_a", "Angle 1 view", -560, -160, pin_defaults=dict(angle_defaults)),
        W.llm_node("view_b", "Angle 2 view", -280, -160, pin_defaults=dict(angle_defaults)),
        W.llm_node("view_c", "Angle 3 view", 0, -160, pin_defaults=dict(angle_defaults)),
        W.code_node("integrate_prompt", "Compose integration", INTEGRATE_PROMPT_CODE, 220, 120,
                    [W.pin("prompt", "prompt", "string"),
                     W.pin("angles", "angles", "object"),
                     W.pin("view_a", "view_a", "string"),
                     W.pin("view_b", "view_b", "string"),
                     W.pin("view_c", "view_c", "string")], output_type="string"),
        W.llm_node("integrate", "Integrate final answer", 280, -160,
                   pin_defaults={"system": "You integrate expert angle-views into one answer: keep agreements, NAME tensions and adjudicate them, conclude clearly.", "temperature": 0.2}),
        W.code_node("meta", "Collect stages", PERSPECTIVES_META_CODE, 560, 120,
                    [W.pin("angles", "angles", "object"),
                     W.pin("view_a", "view_a", "string"),
                     W.pin("view_b", "view_b", "string"),
                     W.pin("view_c", "view_c", "string")]),
        W.end_node("Final answer", [
            W.pin("response", "response", "string"),
            W.pin("success", "success", "boolean"),
            W.pin("meta", "meta", "object"),
        ], 840, -160),
    ]
    # Per-angle index pin defaults (static 0/1/2 — three parallel brief nodes).
    for n in flow["nodes"]:
        if n["id"] == "angle_a_prompt":
            n["data"]["pinDefaults"]["index"] = 0
        if n["id"] == "angle_b_prompt":
            n["data"]["pinDefaults"]["index"] = 1
        if n["id"] == "angle_c_prompt":
            n["data"]["pinDefaults"]["index"] = 2
    flow["edges"] = [
        W.edge("start", "exec-out", "decompose", "exec-in", animated=True),
        W.edge("decompose", "exec-out", "view_a", "exec-in", animated=True),
        W.edge("view_a", "exec-out", "view_b", "exec-in", animated=True),
        W.edge("view_b", "exec-out", "view_c", "exec-in", animated=True),
        W.edge("view_c", "exec-out", "integrate", "exec-in", animated=True),
        W.edge("integrate", "exec-out", "end", "exec-in", animated=True),
        W.edge("start", "prompt", "angles_prompt", "prompt"),
        W.edge("angles_prompt", "output", "decompose", "prompt"),
        W.edge("start", "provider", "decompose", "provider"),
        W.edge("start", "model", "decompose", "model"),
        # angle briefs pull the structured angle list + the question
        W.edge("start", "prompt", "angle_a_prompt", "prompt"),
        W.edge("start", "prompt", "angle_b_prompt", "prompt"),
        W.edge("start", "prompt", "angle_c_prompt", "prompt"),
        W.edge("decompose", "data", "angle_a_prompt", "angles"),
        W.edge("decompose", "data", "angle_b_prompt", "angles"),
        W.edge("decompose", "data", "angle_c_prompt", "angles"),
        W.edge("angle_a_prompt", "output", "view_a", "prompt"),
        W.edge("angle_b_prompt", "output", "view_b", "prompt"),
        W.edge("angle_c_prompt", "output", "view_c", "prompt"),
        W.edge("start", "provider", "view_a", "provider"),
        W.edge("start", "provider", "view_b", "provider"),
        W.edge("start", "provider", "view_c", "provider"),
        W.edge("start", "model", "view_a", "model"),
        W.edge("start", "model", "view_b", "model"),
        W.edge("start", "model", "view_c", "model"),
        # integration
        W.edge("start", "prompt", "integrate_prompt", "prompt"),
        W.edge("decompose", "data", "integrate_prompt", "angles"),
        W.edge("view_a", "response", "integrate_prompt", "view_a"),
        W.edge("view_b", "response", "integrate_prompt", "view_b"),
        W.edge("view_c", "response", "integrate_prompt", "view_c"),
        W.edge("integrate_prompt", "output", "integrate", "prompt"),
        W.edge("start", "provider", "integrate", "provider"),
        W.edge("start", "model", "integrate", "model"),
        # meta + end
        W.edge("decompose", "data", "meta", "angles"),
        W.edge("view_a", "response", "meta", "view_a"),
        W.edge("view_b", "response", "meta", "view_b"),
        W.edge("view_c", "response", "meta", "view_c"),
        W.edge("integrate", "response", "end", "response"),
        W.edge("integrate", "success", "end", "success"),
        W.edge("meta", "output", "end", "meta"),
    ]
    return flow


# --------------------------------------------------------------------------
# meta-deliberate: plan -> execute -> verify/repair
# --------------------------------------------------------------------------

PLAN_PROMPT_CODE = """
q = str(prompt or "").strip()
parts = []
parts.append("Do NOT answer yet. First absorb the question and plan how to answer it well.")
parts.append("")
parts.append("# Question")
parts.append(q)
parts.append("")
parts.append("# Write the plan")
parts.append("1. WHAT IS REALLY ASKED: restate the question in your own words; note any ambiguity and how you will read it.")
parts.append("2. WHAT IT TAKES: the knowledge domains and reasoning steps a good answer needs, in order.")
parts.append("3. PITFALLS: the specific ways answers to this question typically go wrong (traps, tempting-but-wrong readings, common errors).")
parts.append("4. CHECKLIST: 3-6 concrete criteria a correct, complete answer must satisfy.")
return "\\n".join(parts)
""".strip()

EXECUTE_PROMPT_CODE = """
q = str(prompt or "").strip()
p = str(plan or "").strip()
parts = []
parts.append("Answer the question by FOLLOWING your plan. Work the steps in order; actively avoid the pitfalls you identified.")
parts.append("")
parts.append("# Question")
parts.append(q)
parts.append("")
parts.append("# Your plan")
parts.append(p)
parts.append("")
parts.append("Write the full answer now, in the language of the question.")
return "\\n".join(parts)
""".strip()

VERIFY_PROMPT_CODE = """
q = str(prompt or "").strip()
p = str(plan or "").strip()
a = str(answer or "").strip()
parts = []
parts.append("Verify the answer against the plan's own checklist, then deliver the final version.")
parts.append("")
parts.append("# Question")
parts.append(q)
parts.append("")
parts.append("# Plan (with checklist)")
parts.append(p)
parts.append("")
parts.append("# Answer to verify")
parts.append(a)
parts.append("")
parts.append("# Your task")
parts.append("Check the answer against EACH checklist criterion and each named pitfall. If everything holds, deliver the answer (light polish allowed). If something fails, FIX it. Output ONLY the final answer, complete and self-contained — no verification commentary. Answer in the language of the question.")
return "\\n".join(parts)
""".strip()

DELIBERATE_META_CODE = """
return {
    "workflow": "meta-deliberate",
    "pattern": "plan -> execute following plan -> verify against the plan's checklist",
    "stages": {
        "plan": str(plan or ""),
        "first_answer": str(first_answer or ""),
    },
}
""".strip()


def build_deliberate() -> dict:
    flow = W.base_flow(
        "meta-deliberate", "meta-deliberate",
        "Meta-intelligence: a planner absorbs the question first (what is really asked, required steps, known pitfalls, a correctness checklist), an executor answers following the plan, and a verifier checks the answer against the plan's own checklist and repairs failures. Plan-and-Solve pattern; comparable 1:1 against an isolated LLM call.",
        [W.AGENT_INTERFACE, "abstractmeta.intelligence.v1"],
    )
    flow["nodes"] = [
        W.start_node("Question", [
            W.pin("prompt", "prompt", "string"),
            W.pin("provider", "provider", "provider_text"),
            W.pin("model", "model", "model"),
            # Declared for agent.v1 contract honesty (hosts may set it);
            # deliberately unwired — every llm node pins tools=[] so the
            # deliberation stages stay tool-free by design.
            W.pin("tools", "tools", "array"),
        ], -900, 0, pin_defaults={"prompt": ""}),
        W.code_node("plan_prompt", "Compose planning brief", PLAN_PROMPT_CODE, -620, 120,
                    [W.pin("prompt", "prompt", "string")], output_type="string"),
        W.llm_node("plan", "Absorb and plan", -560, -160,
                   pin_defaults={"system": "You plan how to answer before answering: restate the ask, lay out the steps, name the traps, write the checklist. You never answer in the planning pass.", "temperature": 0.3}),
        W.code_node("execute_prompt", "Compose execution", EXECUTE_PROMPT_CODE, -280, 120,
                    [W.pin("prompt", "prompt", "string"),
                     W.pin("plan", "plan", "string")], output_type="string"),
        W.llm_node("execute", "Answer following plan", -220, -160,
                   pin_defaults={"system": ANSWER_SYSTEM, "temperature": 0.3}),
        W.code_node("verify_prompt", "Compose verification", VERIFY_PROMPT_CODE, 60, 120,
                    [W.pin("prompt", "prompt", "string"),
                     W.pin("plan", "plan", "string"),
                     W.pin("answer", "answer", "string")], output_type="string"),
        W.llm_node("verify", "Verify against checklist", 340, -160,
                   pin_defaults={"system": "You verify answers against their plan's checklist and pitfalls, fix what fails, and output only the final answer.", "temperature": 0.2}),
        W.code_node("meta", "Collect stages", DELIBERATE_META_CODE, 620, 120,
                    [W.pin("plan", "plan", "string"),
                     W.pin("first_answer", "first_answer", "string")]),
        W.end_node("Final answer", [
            W.pin("response", "response", "string"),
            W.pin("success", "success", "boolean"),
            W.pin("meta", "meta", "object"),
        ], 900, -160),
    ]
    flow["edges"] = [
        W.edge("start", "exec-out", "plan", "exec-in", animated=True),
        W.edge("plan", "exec-out", "execute", "exec-in", animated=True),
        W.edge("execute", "exec-out", "verify", "exec-in", animated=True),
        W.edge("verify", "exec-out", "end", "exec-in", animated=True),
        W.edge("start", "prompt", "plan_prompt", "prompt"),
        W.edge("plan_prompt", "output", "plan", "prompt"),
        W.edge("start", "provider", "plan", "provider"),
        W.edge("start", "model", "plan", "model"),
        W.edge("start", "prompt", "execute_prompt", "prompt"),
        W.edge("plan", "response", "execute_prompt", "plan"),
        W.edge("execute_prompt", "output", "execute", "prompt"),
        W.edge("start", "provider", "execute", "provider"),
        W.edge("start", "model", "execute", "model"),
        W.edge("start", "prompt", "verify_prompt", "prompt"),
        W.edge("plan", "response", "verify_prompt", "plan"),
        W.edge("execute", "response", "verify_prompt", "answer"),
        W.edge("verify_prompt", "output", "verify", "prompt"),
        W.edge("start", "provider", "verify", "provider"),
        W.edge("start", "model", "verify", "model"),
        W.edge("plan", "response", "meta", "plan"),
        W.edge("execute", "response", "meta", "first_answer"),
        W.edge("verify", "response", "end", "response"),
        W.edge("verify", "success", "end", "success"),
        W.edge("meta", "output", "end", "meta"),
    ]
    return flow


# --------------------------------------------------------------------------
# meta-baseline: the ISOLATED single LLM call, as a flow — the control arm.
# Same machinery (gateway run, agent.v1 shape, same model/params) so the
# benchmark isolates exactly one variable: the orchestration.
# --------------------------------------------------------------------------

BASELINE_META_CODE = """
return {
    "workflow": "meta-baseline",
    "pattern": "isolated single LLM call (control arm)",
    "stages": {},
}
""".strip()


def build_baseline() -> dict:
    flow = W.base_flow(
        "meta-baseline", "meta-baseline",
        "Control arm for the meta-intelligence benchmark: ONE isolated LLM call answering directly (same system prompt, same machinery, no orchestration). Conforms to abstractcode.agent.v1.",
        [W.AGENT_INTERFACE, "abstractmeta.intelligence.v1"],
    )
    flow["nodes"] = [
        W.start_node("Question", [
            W.pin("prompt", "prompt", "string"),
            W.pin("provider", "provider", "provider_text"),
            W.pin("model", "model", "model"),
            # Declared for agent.v1 contract honesty (hosts may set it);
            # deliberately unwired — every llm node pins tools=[] so the
            # deliberation stages stay tool-free by design.
            W.pin("tools", "tools", "array"),
        ], -600, 0, pin_defaults={"prompt": ""}),
        W.llm_node("answer", "Direct answer", -220, -120,
                   pin_defaults={"system": ANSWER_SYSTEM, "temperature": 0.3}),
        W.code_node("meta", "Collect stages", BASELINE_META_CODE, 60, 120, []),
        W.end_node("Final answer", [
            W.pin("response", "response", "string"),
            W.pin("success", "success", "boolean"),
            W.pin("meta", "meta", "object"),
        ], 340, -120),
    ]
    flow["edges"] = [
        W.edge("start", "exec-out", "answer", "exec-in", animated=True),
        W.edge("answer", "exec-out", "end", "exec-in", animated=True),
        W.edge("start", "prompt", "answer", "prompt"),
        W.edge("start", "provider", "answer", "provider"),
        W.edge("start", "model", "answer", "model"),
        W.edge("answer", "response", "end", "response"),
        W.edge("answer", "success", "end", "success"),
        W.edge("meta", "output", "end", "meta"),
    ]
    return flow


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main() -> int:
    builders = [build_consensus, build_debate, build_reflect,
                build_perspectives, build_deliberate, build_baseline]
    flow_ids: list[str] = []
    for build in builders:
        flow = build()
        problems = W.validate_edges(flow)
        if problems:
            for p in problems:
                print(f"EDGE ERROR [{flow['id']}]: {p}")
            return 1
        W.write_json(W.FLOWS_DIR / f"{flow['id']}.json", flow)
        flow_ids.append(flow["id"])
        print(f"wrote {flow['id']}.json ({len(flow['nodes'])} nodes, {len(flow['edges'])} edges)")

    for fid in flow_ids:
        W.compile_check(fid, [fid])
    print("compiled ok")

    # One bundle per flow: pack_workflow_bundle only collects flows reachable
    # from ONE root, so five independent roots cannot share a bundle (same
    # precedent as adversarial-review / structured-extract / map-reduce).
    for fid in flow_ids:
        out = W.pack_bundle(
            root_flow_id=fid,
            bundle_id=fid,
            bundle_version=BUNDLE_VERSION,
            entrypoints=[fid],
            metadata={
                "family": "meta-intelligence",
                "purpose": "co-orchestrated deliberation pattern benchmarkable 1:1 against an isolated LLM call via abstractcode.agent.v1",
            },
        )
        print(f"packed {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
