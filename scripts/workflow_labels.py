#!/usr/bin/env python3
"""Display names and one-line descriptions of the shipped workflow entrypoints.

One table, one copy. The gateway's Workflows page and TUI show, per bundle, the
default entrypoint's `name` and `description` from the bundle manifest, and the
packer copies both from the root VisualFlow JSON (`name`, `description`). So the
build scripts take them from here, and `relabel_shipped_bundles.py` writes them
into already-shipped bundles and checks that every source and bundle carries
them.

Rules for an entry: the name is what a person calls the workflow; the
description is one plain sentence (at most 140 characters) that says what the
workflow takes and what it returns, derived from the flow definition, with no
marketing and no internal ticket or protocol references.

Bundles built outside this repository are listed too (docs-qa and the native
agent loops are built by abstractgateway's scripts, the Assistant orchestrator
by abstractassistant): their shipped files are relabelled in place from this
table, and their own build scripts must carry the same text.
"""

from __future__ import annotations

MAX_DESCRIPTION_CHARS = 140

# bundle_id -> {entrypoint flow_id -> (name, description)}
ENTRYPOINT_LABELS: dict[str, dict[str, tuple[str, str]]] = {
    "basic-agent": {
        "81795ea9": (
            "Basic agent",
            "Chat agent: answers a prompt in one agent loop that can use tools and memory, and returns the reply.",
        ),
    },
    "coding-agent": {
        "coding-agent": (
            "Coding agent",
            "Takes a build request and a workspace, writes the code, and runs build and run checks each round until they pass; returns a report.",
        ),
        "coder": (
            "Coding agent (chat)",
            "Chat version of the coding agent: builds what the prompt asks in the session workspace, checks it each round, and replies with a report.",
        ),
    },
    "deep-research": {
        "deep-research": (
            "Deep research",
            "Takes a research question, searches the web, has three critics review the draft, and writes a cited report (Markdown, PDF, DOCX).",
        ),
    },
    "co-scientist": {
        "co-scientist": (
            "Co-scientist",
            "Takes a research goal, grounds it in web sources, then generates, debates and ranks hypotheses over cycles; returns a research overview.",
        ),
    },
    "map-reduce": {
        "map-reduce": (
            "Map-reduce",
            "Applies one LLM instruction to each item of a list, then combines the per-item results into one synthesis; returns both.",
        ),
    },
    "structured-extract": {
        "structured-extract": (
            "Structured extraction",
            "Extracts JSON matching a given schema from text, checks required fields and types, and retries with the errors until it is valid.",
        ),
    },
    "adversarial-review": {
        "adversarial-review": (
            "Adversarial review",
            "Three critics review text or code for correctness, design and fit to requirements; returns ranked findings and a pass/revise/block verdict.",
        ),
    },
    "meta-baseline": {
        "meta-baseline": (
            "Single call (baseline)",
            "Answers the prompt with one direct LLM call; the baseline the other deliberation workflows are compared against.",
        ),
    },
    "meta-consensus": {
        "meta-consensus": (
            "Consensus",
            "Gets two independent answers (two temperatures or two models) and merges them into one, keeping agreements and resolving differences.",
        ),
    },
    "meta-debate": {
        "meta-debate": (
            "Debate",
            "One model answers, a challenger attacks the answer, then the first model concedes or rebuts each point and writes the final answer.",
        ),
    },
    "meta-deliberate": {
        "meta-deliberate": (
            "Plan, answer, verify",
            "Plans the question (steps, pitfalls, checklist), answers following the plan, then checks the answer against the checklist and fixes it.",
        ),
    },
    "meta-perspectives": {
        "meta-perspectives": (
            "Three perspectives",
            "Picks three angles on the question, answers from each separately, then combines them into one answer that names where they disagree.",
        ),
    },
    "meta-reflect": {
        "meta-reflect": (
            "Reflect and revise",
            "Drafts an answer, questions its own reasoning (assumptions, weak steps, missed cases), then writes a revised final answer.",
        ),
    },
    # Built outside this repository (see the module docstring).
    "docs-qa": {
        "docsqa001": (
            "Docs Q&A",
            "Answers a question about an app from that app's documentation (its llms.txt), citing it, and says so when the docs do not cover it.",
        ),
    },
    "abstractassistant-orchestrator": {
        "d5d4e5a1": (
            "AbstractAssistant Orchestrator",
            "The menu-bar Assistant's workflow: sends each request to a tools agent or to image, video or music generation, and returns the reply.",
        ),
    },
    "react-agent": {
        "react": (
            "ReAct agent",
            "Chat agent (ReAct): reasons step by step and calls tools until it can answer the prompt, then returns the reply.",
        ),
    },
    "codeact-agent": {
        "codeact": (
            "CodeAct agent",
            "Chat agent (CodeAct): works on the prompt mainly by writing and running Python code, then returns the reply.",
        ),
    },
    "memact-agent": {
        "memact": (
            "MemAct agent",
            "Chat agent (MemAct): keeps a long-term memory that it reads and updates on each turn, can call tools, and returns the reply.",
        ),
    },
}


def label(bundle_id: str, flow_id: str) -> tuple[str, str]:
    """(name, description) of one entrypoint. A missing entry is a KeyError:
    a build must never fall back to a flow id as the display name."""
    return ENTRYPOINT_LABELS[bundle_id][flow_id]


def table_problems() -> list[str]:
    """Rule violations in the table itself (empty = the table is valid)."""
    problems: list[str] = []
    for bundle_id, entries in ENTRYPOINT_LABELS.items():
        for flow_id, (name, description) in entries.items():
            where = f"{bundle_id}:{flow_id}"
            if not name.strip() or name.strip() in {flow_id, bundle_id}:
                problems.append(f"{where}: the name must be a human name, not the id ({name!r})")
            if not description.strip():
                problems.append(f"{where}: empty description")
            if len(description) > MAX_DESCRIPTION_CHARS:
                problems.append(f"{where}: description is {len(description)} characters (max {MAX_DESCRIPTION_CHARS})")
            if "\n" in description:
                problems.append(f"{where}: description spans several lines")
    return problems
