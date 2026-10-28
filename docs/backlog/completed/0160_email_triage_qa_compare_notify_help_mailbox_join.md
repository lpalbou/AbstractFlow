# 0160 — Email-triage QA: Compare's hidden `==`, the inert notify pin, node help, the test-run mailbox, Join's new line

- Status: COMPLETED 2026-10-28 (0.12.0), except the Is Empty part (see "Remaining").
- Created: 2026-10-28 · Completed: 2026-10-28
- Owner: flow (release-closing wave, worker W6). Source: operator QA of the redeployed set,
  items (c), (d), (e) (`untracked/release-closing/QA.md` at the workspace root).

## Problem (operator, 2026-10-28)

- (c) The library flow "email-triage" ran on 5 emails, the LLM marked 2 important, yet the run
  ended through On Flow End "No important emails detected", and After the run said "Nothing to
  notify: the title was empty" although Notify me has a title. On Flow End's `notify` pin carried
  a self-comment on the canvas ("Older flows: a title here notifies you…"); node and pin help was
  one-line tooltips.
- (d) "Run as if triggered" did not let the person pick which configured mailbox the test run reads.
- (e) Is Empty must accept lists (nothing or 0 elements = empty); Join needs a newline delimiter.

## Cause (reproduced)

The saved flow (gateway data dir, read only) was copied and run through AbstractRuntime's
executor with 5 synthetic emails, 2 important (`untracked/release-closing/w6-flow/repro_email_triage.py`
at the workspace root). Add to List / Get Variable / Array Length were right (`triage` held 2).
Compare (`node-23`) had no `op` set and `b = 0`: the runtime compares with `==`, so the
condition was `2 == 0` = false and the run took the "No important" branch; with `op = ">"` the
same run reaches Notify me and publishes "Emails requiring your attension". The folded Compare
showed "=?", so the `==` was invisible. The operator's own run ledger confirms it (`triage` held 7
items, `node-24` took `false`).

Notify me was never reached, so no alert was raised. Both On Flow End nodes carried the older
`notify` pin, unwired and empty; the runtime then writes `notify: null` into the run's outcome and
the gateway (`run_after.py`: `"notify" in end` → `quiet_reason: "empty title"`) said the title was
empty.

## Fix

- Compare: the folded and open card show the operator it runs (`==` when none is set); the
  operator list offers `!=` (`utils/operatorNodes.ts` `COMPARE_DEFAULT_OP`, `COMPARE_OPS`).
- On Flow End: an inert `notify` pin (nothing wired, no value, no expression) is removed when the
  flow loads (`utils/triggerPins.ts` `withoutInertNotifyPin`, called from `useFlow.loadFlow` and
  `fromVisualFlow`); a used one stays. After the run's sentences say "the run did not reach a
  Notify me step" (true for either gateway answer).
- Node help dialog (`utils/nodeHelp.ts`, `components/NodeHelpModal.tsx`, Properties **Help**):
  purpose, details, inputs, outputs, examples; the canvas pin prose is removed.
- Run as if triggered: **Mailbox for this test run** picker over `GET /me/email` readable
  mailboxes; the pick rides `POST /triggers/sample` `trigger.config.account` for that run only
  (`utils/triggerSample.ts` `withTestMailbox`, `testMailboxChoices`). No new route.
- Join: delimiter choices with New line / Blank line / Tab and Custom (`\n`, `\t` escapes)
  (`utils/joinDelimiter.ts`, `components/nodes/JoinDelimiterControl.tsx`).

## Evidence

- `src/utils/email_triage_qa.test.ts` loads the operator's flow (fixture, mailbox renamed) and is
  RED on `origin/main` (3/3: "=?" instead of "==", `notify` still on both ends, the old sentence)
  and GREEN with the fix; disabling the `loadFlow` call alone turns its notify test RED.
- `nodeHelp.test.ts` (every template has a purpose and pin words), `joinDelimiter.test.ts`,
  `trigger_sample.test.ts` (mailbox picker, sample request carries the picked account),
  `after_the_run.test.tsx` (no canvas prose; inert pin dropped, used ones kept).
- Full suite 138 files green; `npm run build`, `npm run lint` clean. Browser check against the
  hermetic gateway fixture: the folded Compare reads `==`, On Flow End's help dialog, Join's
  "Comma" control, the Run panel's mailbox line.

## Adversarial review (2026-10-28, fresh opus reviewer)

No blocker. Fixed: Compare's help no longer points at Is Empty for lists (false until the runtime
release; a test guards it); the docs say the inert pin goes when the flow is opened AND saved (the
gateway runs the stored file); the mailbox picker hides while edited inputs are used (no sample is
read then) and resets on each opening of the Run window; Notify me's body help says to join the
subjects (Join writes objects as raw text); the custom Join field's placeholder says an unset
delimiter is a comma; the single-mailbox line no longer labels a span. Not changed (nits):
whitespace-only Compare op shows `==` while the runtime would refuse it (the picker never writes
one); `joinDelimiterText` mirrors the runtime's escape rule in tests only.

## Remaining

- **Is Empty on lists** needs AbstractRuntime's `is_empty_string` to treat a list/object with no
  elements as empty (it returned false for `[]`): runtime branch `fix/email-triage-qa` (PR held for
  the lead, a runtime release cascades). The Flow side (the pin takes any value) is on branch
  `fix/is-empty-lists`, held until that runtime is released: shipping it first would make
  Is Empty([]) silently false.
- Gateway hardening (optional): `run_after.py` should report `empty title` only when `notify` is
  an object, not when it is `null`.
- Join writes object items as Python text (`{'id': …}`): a Notify me body built from a list of
  emails is unreadable; join their subjects instead, or a runtime change (JSON for objects).
