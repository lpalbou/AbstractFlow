import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

/**
 * Inline pin expressions (tier 1, 2026-07-25) — the pin-row UI.
 *
 * Split in two so BaseNode can place each half where the card layout needs it:
 * - `PinExpressionChip` renders INLINE in the pin row: an amber chip with a
 *   truncated preview when an expression exists, or a ghost `fx` button
 *   (revealed on row hover via CSS) when none does. Click = open the editor.
 *   When the expression is a CALL to a flow-level library function
 *   (tier 2, 2026-07-26), the chip renders `ƒ name` — the mockups' function
 *   binding chip — instead of raw text.
 * - `PinExpressionEditor` renders BELOW the pin row (a full-width expansion
 *   inside the card). Deliberately not a floating portal: React Flow nodes
 *   live in a zoom-transformed plane where portals need coordinate math, and
 *   a card growing while edited is honest — the canvas shows where authoring
 *   happens. One pin edits at a time PER NODE CARD (state lives in each
 *   BaseNode instance; two different nodes can hold open editors).
 *
 * Help text mirrors the runtime contract exactly: expressions read `vars.*`
 * (run vars, read-only) and `value` (the pin's wire value if connected, else
 * its pin default).
 */

const PREVIEW_MAX = 24;

/**
 * Return a copy of `expr` with the CONTENTS of every string literal (quotes
 * included) blanked to spaces, preserving length and index alignment. Lets
 * the read/call scanners work on structure without matching inside strings —
 * the string-blind regexes were the root of the promote-corruption and
 * chip-lying defects (adversary P1-3/P1-7). Handles single/double and triple
 * quotes with backslash escapes; unusual raw-string edge cases only ever
 * over-mask, which fails toward refusing an ambiguous promote (the safe
 * direction).
 */
export function maskStringLiterals(expr: string): string {
  let out = '';
  let i = 0;
  const n = expr.length;
  while (i < n) {
    const c = expr[i];
    if (c === '"' || c === "'") {
      const three = expr.slice(i, i + 3);
      const q = three === '"""' || three === "'''" ? three : c;
      out += ' '.repeat(q.length);
      i += q.length;
      while (i < n) {
        if (expr[i] === '\\') {
          const take = Math.min(2, n - i);
          out += ' '.repeat(take);
          i += take;
          continue;
        }
        if (expr.slice(i, i + q.length) === q) {
          out += ' '.repeat(q.length);
          i += q.length;
          break;
        }
        out += ' ';
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * If `expression` is ENTIRELY a call `name(...)` of a known library function,
 * return the name; else null. "Entirely" is load-bearing (adversary P1-7): a
 * compound like `build_again(x) or vars.force` must NOT render a pure ƒ chip
 * that hides the `or vars.force` half — the chip is the honesty surface. Paren
 * matching runs over the string-masked form so parens inside string literals
 * never miscount.
 */
export function libraryCallName(
  expression: string | undefined,
  libraryNames: readonly string[] | undefined
): string | null {
  if (!expression || !libraryNames || libraryNames.length === 0) return null;
  const expr = expression.trim();
  const m = /^([A-Za-z_]\w*)\s*\(/.exec(expr);
  if (!m || !libraryNames.includes(m[1])) return null;
  const masked = maskStringLiterals(expr);
  const open = masked.indexOf('(', m[1].length);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i === expr.length - 1 ? m[1] : null;
    }
  }
  return null;
}

interface VarRead {
  name: string;
  start: number; // index of `vars` in the ORIGINAL expression
  end: number; // index just past the read
}

/**
 * Simple `vars.NAME` / `vars["NAME"]` reads, string-aware and method-aware.
 * Returns null when the expression uses `vars` in a way that cannot become a
 * positional parameter (dynamic: `vars.get(...)`, a method call `vars.x(...)`,
 * `vars[expr]`, or a bare `vars`) — the caller refuses promotion (adversary
 * P1-5). Reads inside string literals are ignored (adversary P1-3).
 */
export function scanVarReads(expression: string): VarRead[] | null {
  const masked = maskStringLiterals(expression);
  const isRealVars = (start: number) => masked.slice(start, start + 4) === 'vars';
  const reads: VarRead[] = [];
  const covered = new Set<number>();
  // Scan the ORIGINAL so subscript string KEYS survive (they are blanked in
  // `masked`). A match whose `vars` token is blanked in `masked` sat inside a
  // string literal — skip it (it is not a real read).
  const re = /\bvars\s*(?:\.\s*([A-Za-z_]\w*)|\[\s*"([^"]*)"\s*\]|\[\s*'([^']*)'\s*\])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expression)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (!isRealVars(start)) continue; // the whole read sits inside a string
    const name = m[1] || m[2] || m[3] || '';
    // Attribute read immediately followed by `(` is a METHOD CALL, not a read.
    if (m[1]) {
      let j = end;
      while (j < masked.length && /\s/.test(masked[j])) j += 1;
      if (masked[j] === '(') return null; // vars.get(...) / vars.items() etc.
    }
    if (!name || !/^[A-Za-z_]\w*$/.test(name)) return null;
    reads.push({ name, start, end });
    covered.add(start);
  }
  // Any `vars` token in the masked (non-string) source not covered by a simple
  // read is a dynamic use we cannot parameterize (vars[expr], bare vars) — refuse.
  const bare = /\bvars\b/g;
  let b: RegExpExecArray | null;
  while ((b = bare.exec(masked)) !== null) {
    if (!covered.has(b.index)) return null;
  }
  return reads;
}

/** Ordered unique read names (kept for callers that only need names). */
export function extractVarReads(expression: string): string[] {
  const reads = scanVarReads(expression);
  if (!reads) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of reads) {
    if (!seen.has(r.name)) {
      seen.add(r.name);
      out.push(r.name);
    }
  }
  return out;
}

export interface PromotionPlan {
  code: string;
  call: string;
  params: string[];
  error?: string;
}

/**
 * Plan the "promote expression → named function" rewrite (frame_4 mockup):
 * simple `vars.X` reads become parameters, `value` (if read) becomes a
 * parameter, the function body returns the substituted expression, and the
 * pin keeps a call with the binding prefilled to the same vars.
 *
 * Refuses (error) when `vars` is used dynamically (`vars.get(...)`,
 * `vars[expr]`) — those reads cannot become positional parameters without
 * changing meaning.
 */
function fail(error: string): PromotionPlan {
  return { code: '', call: '', params: [], error };
}

export function planPromotion(expression: string, fnName: string): PromotionPlan {
  const reads = scanVarReads(expression);
  if (reads === null) {
    return fail(
      'expression uses vars dynamically (vars.get(…), a method call, or vars[expr]) — write the function by hand in the Functions panel'
    );
  }
  // Distinct read names in first-appearance order.
  const names: string[] = [];
  const seen = new Set<string>();
  for (const r of reads) {
    if (!seen.has(r.name)) {
      seen.add(r.name);
      names.push(r.name);
    }
  }
  // `value` is the pin's own value parameter; a run var also named `value`
  // would produce `def f(value, value)` — a SyntaxError (adversary P1-4).
  if (names.includes('value')) {
    return fail(
      "a run var named 'value' collides with the pin value parameter — rename it or promote by hand"
    );
  }
  // Substitute each real read span `vars.NAME`/`vars["NAME"]` -> `NAME`,
  // working right-to-left over the ORIGINAL so indices stay valid and string
  // literals containing `vars.` are never touched (adversary P1-3).
  let body = expression;
  for (const r of [...reads].sort((a, b) => b.start - a.start)) {
    body = body.slice(0, r.start) + r.name + body.slice(r.end);
  }
  // Whether the pin's wire value is read.
  const usesValue = /\bvalue\b/.test(maskStringLiterals(body));
  const params = [...names];
  if (usesValue) params.push('value');
  const indented = body
    .split('\n')
    .map((line, i) => (i === 0 ? line : `        ${line}`))
    .join('\n');
  const code = `def ${fnName}(${params.join(', ')}):\n    return (\n        ${indented}\n    )\n`;
  const args = params.map((p) => (p === 'value' ? 'value' : `vars.${p}`));
  const call = `${fnName}(${args.join(', ')})`;
  return { code, call, params };
}

export function PinExpressionChip({
  pinLabel,
  expression,
  libraryNames,
  onOpen,
}: {
  pinLabel: string;
  expression: string | undefined;
  libraryNames?: readonly string[];
  onOpen: () => void;
}) {
  if (expression) {
    const fnName = libraryCallName(expression, libraryNames);
    if (fnName) {
      return (
        <button
          type="button"
          className="fx-chip fx-chip-fn nodrag"
          title={`${expression}\n(click to edit binding)`}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          <span className="fx-glyph">ƒ</span>
          <span className="fx-preview">{fnName}</span>
        </button>
      );
    }
    const preview =
      expression.length > PREVIEW_MAX ? `${expression.slice(0, PREVIEW_MAX - 1)}…` : expression;
    return (
      <button
        type="button"
        className="fx-chip nodrag"
        title={`expression: ${expression}\n(click to edit)`}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        <span className="fx-glyph">ƒx</span>
        <span className="fx-preview">{preview}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className="fx-ghost nodrag"
      title={`Compute ${pinLabel} with an expression`}
      aria-label={`Add expression on ${pinLabel}`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      ƒx
    </button>
  );
}

export function PinExpressionEditor({
  pinId,
  pinLabel,
  expression,
  connected,
  knownVars,
  libraryNames,
  onSave,
  onClose,
  onPromote,
}: {
  pinId: string;
  pinLabel: string;
  expression: string | undefined;
  connected: boolean;
  knownVars?: string[];
  libraryNames?: readonly string[];
  onSave: (expression: string | undefined) => void;
  onClose: () => void;
  /**
   * Create a named function from the current draft (frame_4 promote flow).
   * Receives the function entry + the replacement call expression; returns an
   * error string on refusal (name collision etc.) or null on success.
   */
  onPromote?: (fn: { name: string; kind?: string; code: string }, call: string) => string | null;
}) {
  const [draft, setDraft] = useState(expression ?? '');
  const [promoting, setPromoting] = useState(false);
  const [promoteName, setPromoteName] = useState('');
  const [promoteKind, setPromoteKind] = useState('checker');
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  // Last expression prop this editor has folded into its draft. The prop CAN
  // change while the editor stays mounted (assistant-applied authoring
  // commands, canvas undo/redo — the editor has no outside-click close): adopt
  // the external value only when the user hasn't typed since the last fold,
  // so a pristine draft never shows stale text while live typing never gets
  // clobbered (their Save then wins, the app's normal last-write semantics).
  const lastPropRef = useRef(expression ?? '');

  useEffect(() => {
    const incoming = expression ?? '';
    if (incoming === lastPropRef.current) return;
    const previous = lastPropRef.current;
    lastPropRef.current = incoming;
    setDraft((current) => (current === previous ? incoming : current));
  }, [expression]);

  useEffect(() => {
    if (areaRef.current) {
      areaRef.current.focus();
      areaRef.current.setSelectionRange(areaRef.current.value.length, areaRef.current.value.length);
    }
  }, []);

  const commit = useCallback(() => {
    const text = draft.trim();
    onSave(text ? text : undefined);
    onClose();
  }, [draft, onSave, onClose]);

  const promotionPlan = promoting && promoteName.trim() ? planPromotion(draft.trim(), promoteName.trim()) : null;

  const runPromote = useCallback(() => {
    if (!onPromote) return;
    const name = promoteName.trim();
    if (!name) {
      setPromoteError('Function name is required');
      return;
    }
    if (!/^[A-Za-z_]\w*$/.test(name)) {
      setPromoteError('Name must be a plain identifier');
      return;
    }
    const plan = planPromotion(draft.trim(), name);
    if (plan.error) {
      setPromoteError(plan.error);
      return;
    }
    const err = onPromote({ name, kind: promoteKind || undefined, code: plan.code }, plan.call);
    if (err) {
      setPromoteError(err);
      return;
    }
    onClose();
  }, [onPromote, promoteName, promoteKind, draft, onClose]);

  return (
    <div
      className="fx-editor nodrag nowheel"
      data-pin={pinId}
      onKeyDown={(e) => {
        // Escape cancels from ANY focused child (Save/Cancel/Remove included),
        // not just the textarea — which stops propagation itself, so this
        // container handler never double-fires for textarea keys.
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          if (promoting) setPromoting(false);
          else onClose();
        }
      }}
    >
      <div className="fx-editor-head">
        <span className="fx-glyph">ƒx</span>
        <span className="fx-editor-title">{pinLabel} — expression</span>
      </div>
      <textarea
        ref={areaRef}
        className="fx-editor-area"
        value={draft}
        rows={Math.min(6, Math.max(1, draft.split('\n').length))}
        spellCheck={false}
        placeholder={connected ? 'value["field"]  (value = the wire)' : 'vars.my_var < 3'}
        onChange={(e) => {
          setDraft(e.target.value);
          setPromoteError(null);
        }}
        onKeyDown={(e) => {
          // Enter commits (expressions are one-liners at heart); Shift+Enter
          // inserts a newline; Escape cancels without saving.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
          e.stopPropagation();
        }}
      />
      <div className="fx-editor-hint">
        {/* `value` exists on BOTH sides of the wire (the runtime contract:
            wire value if wired, else the pin default) — hiding it for
            unconnected pins under-reported the surface. Nothing here may
            promise iteration: vars is a read-only view (.get/`in` only). */}
        reads <code>vars.*</code> and <code>value</code> (
        {connected ? 'the wire' : 'this pin’s default'})
        {knownVars && knownVars.length > 0 ? (
          <span className="fx-editor-vars" title={knownVars.join(', ')}>
            {' '}· vars: {knownVars.slice(0, 5).join(', ')}
            {knownVars.length > 5 ? '…' : ''}
          </span>
        ) : null}
        {libraryNames && libraryNames.length > 0 ? (
          <span className="fx-editor-vars" title={libraryNames.join(', ')}>
            {' '}· functions: {libraryNames.slice(0, 4).join(', ')}
            {libraryNames.length > 4 ? '…' : ''}
          </span>
        ) : null}
      </div>

      {promoting ? (
        <div className="fx-promote">
          <div className="fx-promote-row">
            <input
              type="text"
              className="fx-promote-name"
              placeholder="function_name"
              value={promoteName}
              autoFocus
              onChange={(e) => {
                setPromoteName(e.target.value);
                setPromoteError(null);
              }}
            />
            <select
              className="fx-promote-kind"
              value={promoteKind}
              onChange={(e) => setPromoteKind(e.target.value)}
            >
              <option value="checker">checker</option>
              <option value="shaper">shaper</option>
              <option value="parser">parser</option>
              <option value="composer">composer</option>
              <option value="">(none)</option>
            </select>
          </div>
          {promotionPlan && !promotionPlan.error ? (
            <pre className="fx-promote-preview">{promotionPlan.code}</pre>
          ) : null}
          {promotionPlan?.error ? <div className="functions-error">{promotionPlan.error}</div> : null}
          {promoteError ? <div className="functions-error">{promoteError}</div> : null}
          <div className="fx-editor-actions">
            <span className="fx-editor-spacer" />
            <button type="button" className="fx-btn" onClick={() => setPromoting(false)}>
              Back
            </button>
            <button type="button" className="fx-btn fx-btn-primary" onClick={runPromote}>
              Promote
            </button>
          </div>
        </div>
      ) : (
        <div className="fx-editor-actions">
          {expression ? (
            <button
              type="button"
              className={clsx('fx-btn', 'fx-btn-danger')}
              onClick={() => {
                onSave(undefined);
                onClose();
              }}
            >
              Remove
            </button>
          ) : null}
          {onPromote && draft.trim() && !libraryCallName(draft.trim(), libraryNames) ? (
            <button
              type="button"
              className="fx-btn"
              title="Turn this expression into a named, reusable function"
              onClick={() => {
                setPromoting(true);
                setPromoteError(null);
              }}
            >
              Promote to function…
            </button>
          ) : null}
          <span className="fx-editor-spacer" />
          <button type="button" className="fx-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={clsx('fx-btn', 'fx-btn-primary')} onClick={commit}>
            Save
          </button>
        </div>
      )}
    </div>
  );
}
