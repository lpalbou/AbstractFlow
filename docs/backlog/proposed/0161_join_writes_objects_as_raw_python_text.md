# 0161 — Join writes objects as raw Python text

- Status: PROPOSED 2026-10-28
- Created: 2026-10-28
- Owner: flow (the node), with AbstractRuntime (`string_join` in
  `visualflow_compiler/visual/builtins.py`, where the behaviour lives).
- Source: operator QA 2026-10-28 (c), found while reproducing the email-triage flow
  (backlog 0160).

## Problem

Join turns each item into text with Python's `str(item)`. A list of objects therefore comes out
as Python repr, not as anything a person reads. The operator's email-triage flow joins the
`triage` list (emails) into Notify me's body; reproduced through AbstractRuntime with synthetic
emails, the body is:

```
{'id': 'm1', 'subject': 'URGENT subject 1', 'from': 'a@b.c'},{'id': 'm3', 'subject': 'URGENT subject 3', 'from': 'a@b.c'}
```

On the operator's real mail it is each message's full record (ids, folder, thread id, dates),
single-quoted, `True`/`None` in Python spelling: unreadable on a watch or a phone, and not JSON
either, so nothing downstream can parse it.

Today's workaround (said in Notify me's help since 0.12.0): join the subjects, not the emails
(ForEach → Break Object `subject` → Add to List, then Join).

## Options to discuss

1. Runtime: objects and lists are written as JSON (`json.dumps(item, ensure_ascii=False)`);
   text, numbers and booleans unchanged except `True`/`False`/`None` → `true`/`false`/`null`?
   Machine-readable, still not friendly.
2. Runtime + Flow: a readable line per known shape (an Email: "subject — from"), JSON otherwise.
   Needs the runtime to know the Email type (AbstractFlow `utils/emailType.ts`).
3. Flow only: a **field** option on Join ("join each item's `subject`"), compiled to the existing
   pin (`items` mapped) or a small runtime pin `field`. Keeps Join generic and makes the
   email-triage body one node.

A change of what Join outputs for objects changes saved flows' results: needs a runtime release
note and a decision whether it is a fix (repr was never intended) or a new option.

## Acceptance

- The email-triage body reads as one line per email a person can scan (subject, sender).
- A test with a list of objects through a compiled flow pins the output; text lists unchanged.
