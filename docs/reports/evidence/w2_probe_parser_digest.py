#!/usr/bin/env python3
"""WAVE-2 PROBE: ELECTIONS_CODE (feel parser v2) + EPISODE_CODE (digest)
executed through the real sandbox (create_code_handler), adversarial replies.

Guarantee under test (seat's claim): "no reply words are ever silently lost".
"""
from __future__ import annotations

import sys

sys.path.insert(0, "/Users/albou/tmp/abstractframework/abstractflow/scripts")
from build_entity_life_workflow import ELECTIONS_CODE, EPISODE_CODE  # noqa: E402

from abstractruntime.visualflow_compiler.visual.code_executor import (  # noqa: E402
    create_code_handler,
)
from abstractruntime.visualflow_compiler.visual.executor import (  # noqa: E402
    _generate_code_from_body,
)


def make_handler(body: str, input_pins: list[str]):
    """The exact production wrap: codeBody -> def transform(_input) -> sandbox."""
    data = {"codeBody": body, "inputs": [{"id": p} for p in input_pins]}
    return create_code_handler(_generate_code_from_body(data, "transform"))


elections = make_handler(ELECTIONS_CODE, ["reply"])
episode = make_handler(EPISODE_CODE, ["stimulus", "clean_reply", "phase", "turn_id", "participants"])

failures = []


def check(name, cond, detail=""):
    tag = "PASS" if cond else "FAIL"
    print(f"[{tag}] {name}" + (f"  -- {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


# 1. Canonical multi-line fence
r = elections({"reply": "Before.\n```feel\ntarget=person:laurent sign=+1 magnitude=2 reason=he trusted me\n```\nAfter."})
check("canonical fence folds", r["has_feel"] == 1 and r["feel_target"] == "person:laurent" and r["feel_magnitude"] == 2)
check("canonical: words kept + titled marker", "Before." in r["clean_reply"] and "After." in r["clean_reply"] and "[felt: person:laurent +2" in r["clean_reply"])

# 2. Params on fence line + separate close
r = elections({"reply": "Hi.\n```feel target=person:x sign=+1 magnitude=2 reason=kind words\n```\nBye."})
check("fence-line params + close folds", r["has_feel"] == 1 and r["feel_reason"] == "kind words")
check("fence-line params: words kept", "Hi." in r["clean_reply"] and "Bye." in r["clean_reply"])

# 3. INLINE one-line closed fence FOLLOWED BY PROSE (the depth case)
prose = "Here is my actual answer to your question about the stars."
r = elections({"reply": "```feel target=person:x sign=+1 magnitude=2 reason=thanks```\n" + prose})
words_kept = prose in r["clean_reply"]
check("inline one-line fence: reply words NOT silently lost", words_kept,
      f"clean_reply={r['clean_reply']!r} warnings={r['warnings']}")
check("inline one-line fence: reason not polluted with backticks",
      "`" not in r.get("feel_reason", ""), f"reason={r.get('feel_reason')!r}")

# 3b. Inline one-line fence as the WHOLE reply
r = elections({"reply": "```feel target=person:x sign=+1 magnitude=2 reason=thanks```"})
check("inline-only fence folds", r["has_feel"] == 1, f"warnings={r['warnings']}")

# 4. Two fences: second dropped with warning, no words lost
r = elections({"reply": "A.\n```feel\ntarget=person:x sign=+1 magnitude=1 reason=r1\n```\nMid.\n```feel\ntarget=person:y sign=-1 magnitude=1 reason=r2\n```\nZ."})
check("two fences: first folds, second warned",
      r["feel_target"] == "person:x" and any("second feel" in w for w in r["warnings"]))
check("two fences: words kept", "A." in r["clean_reply"] and "Mid." in r["clean_reply"] and "Z." in r["clean_reply"])

# 5. Unclosed fence mid-reply with INCOMPLETE params: flush back
r = elections({"reply": "Start.\n```feel\ntarget=person:x sign=+1\nand then I kept talking about the sea."})
check("unclosed incomplete fence: words flushed back",
      "kept talking about the sea" in r["clean_reply"] and any("flushed back" in w for w in r["warnings"]),
      f"clean={r['clean_reply']!r}")

# 5b. Unclosed fence with COMPLETE params followed by prose (EOF fold branch)
r = elections({"reply": "Start.\n```feel target=person:x sign=+1 magnitude=2 reason=ok\nThe rest of my reply matters a lot."})
check("unclosed complete fence: trailing prose NOT lost",
      "rest of my reply matters" in r["clean_reply"],
      f"clean={r['clean_reply']!r} warnings={r['warnings']}")

# 6. Magnitude 8 clamps to 3 with warning
r = elections({"reply": "```feel\ntarget=person:x sign=+1 magnitude=8 reason=big\n```"})
check("magnitude 8 clamped to 3 + warning", r["feel_magnitude"] == 3 and any("clamped" in w for w in r["warnings"]))

# 7. Spoof target ex: refused
r = elections({"reply": "```feel\ntarget=ex:memory-123 sign=+1 magnitude=2 reason=spoof\n```"})
check("ex: spoof refused (no appraise)", r["has_feel"] == 0 and any("refused" in w for w in r["warnings"]))
check("ex: spoof: marker does not survive in reply claiming a feeling",
      "[felt: ex:memory-123" not in r["clean_reply"], f"clean={r['clean_reply']!r}")

# 8. Missing reason: malformed, dropped with warning
r = elections({"reply": "words\n```feel\ntarget=person:x sign=+1 magnitude=2\n```\nmore words"})
check("missing reason: dropped + warning", r["has_feel"] == 0 and any("malformed" in w for w in r["warnings"]))
check("missing reason: words kept", "words" in r["clean_reply"] and "more words" in r["clean_reply"])

# 9. A plain ``` code block in the reply (no feel): must survive untouched
code_reply = "Look:\n```\nprint('hi')\n```\nDone."
r = elections({"reply": code_reply})
check("plain code block untouched", r["clean_reply"] == code_reply.strip(), f"clean={r['clean_reply']!r}")

# 10. Inline fence then LATER unrelated code block (worst interleave)
r = elections({"reply": "```feel target=person:x sign=+1 magnitude=2 reason=hi```\nProse one.\n```\ncode\n```\nProse two."})
check("inline fence + later code block: all prose kept",
      "Prose one." in r["clean_reply"] and "Prose two." in r["clean_reply"],
      f"clean={r['clean_reply']!r}")

# ---- EPISODE digest ----
long_stim = ("I wanted to tell you about the harbor. " * 8).strip()  # ~310 chars
long_reply = ("The lighthouse keeps its own kind of time. " * 10).strip()  # ~430 chars
r = episode({"stimulus": long_stim, "clean_reply": long_reply, "phase": "visit",
             "turn_id": "visit-d0-turn-1", "participants": ["person:laurent"]})
rec = r["records"][0]
check("digest carries BOTH sides", rec["digest"].startswith("They said:") and " - I said: " in rec["digest"])
check("digest truncation labeled", "[#TRUNCATION]" in rec["digest"] and rec["attributes"].get("digest_truncated") is True)
check("digest sentence-bounded", ". [#TRUNCATION]" in rec["digest"], rec["digest"])
check("digest_method stamped", rec["attributes"].get("digest_method") == "mechanical-flow-v1")
check("keywords formed", isinstance(rec["keywords"], list) and len(rec["keywords"]) >= 3 and "harbor" in rec["keywords"])
check("attrs: phase/turn_id/participants", rec["attributes"]["phase"] == "visit"
      and rec["attributes"]["turn_id"] == "visit-d0-turn-1"
      and rec["attributes"]["participants"] == ["person:laurent"])
check("verbatim carries both sides raw", "THEY SAID:" in rec["verbatim"] and long_stim in rec["verbatim"] and long_reply in rec["verbatim"])

# silent-visitor + empty exchange honesty
r = episode({"stimulus": "", "clean_reply": "", "phase": "personal", "turn_id": "t"})
check("empty exchange digest honest", r["records"][0]["digest"] == "(a silent moment)")
r = episode({"stimulus": "Hello there friend", "clean_reply": "", "phase": "visit", "turn_id": "t"})
check("silent-entity digest honest", "(I stayed silent)" in r["records"][0]["digest"])

print()
if failures:
    print(f"{len(failures)} FAILURE(S): {failures}")
    sys.exit(1)
print("ALL PARSER+DIGEST CHECKS PASS")
sys.exit(0)
