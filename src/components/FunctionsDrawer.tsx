import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { findFunctionCallSites, useFlowStore } from '../hooks/useFlow';
import type { FlowFunction } from '../types/flow';

/**
 * Functions drawer (tier 2 of the expression redesign, 2026-07-26) — the
 * right-rail library panel from the frame_2 mockup: searchable list of the
 * flow's named helper functions with signature, kind tag, used-by count;
 * expanding a row shows the code and every call site (click → select the
 * consumer node on the canvas); New/Edit use an inline editor (full `def`
 * source — the code IS the artifact, same bytes the runtime compiles).
 *
 * Delete refuses while call sites exist (mirrors the runtime posture:
 * loud refusal, never a silently broken expression).
 */

const KIND_OPTIONS = ['checker', 'shaper', 'parser', 'composer', 'formatter', 'other'] as const;

// Plain-words legend for the kind tags (UX adversary P1-3: an unexplained
// tag is jargon). Rendered as the tag's tooltip; clicking a tag filters.
const KIND_HINTS: Record<string, string> = {
  checker: 'answers a yes/no law from state',
  shaper: 'folds a result into the state object',
  parser: 'reads structure out of raw output',
  composer: 'builds a value (prompt, command, text)',
  formatter: 'formats one value for embedding',
  other: 'helper',
};

function functionParams(fn: FlowFunction): string {
  // Find the def's argument list by matching parens with depth — a naive
  // [^)]* stops at the first ")" inside a default like `x=(1,2)` (P2-18).
  const head = new RegExp(`def\\s+${fn.name}\\s*\\(`).exec(fn.code);
  if (!head) return '';
  const open = head.index + head[0].length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < fn.code.length; i++) {
    const c = fn.code[i];
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return '';
  const inner = fn.code.slice(open + 1, close);
  // Split top-level commas only (a default `(1, 2)` must not split).
  const params: string[] = [];
  let d = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '(' || ch === '[' || ch === '{') d += 1;
    else if (ch === ')' || ch === ']' || ch === '}') d -= 1;
    if (ch === ',' && d === 0) {
      params.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) params.push(cur);
  return params
    .map((p) => p.split('=')[0].split(':')[0].trim())
    .filter(Boolean)
    .join(', ');
}

interface EditorState {
  mode: 'new' | 'edit';
  previousName?: string;
  name: string;
  kind: string;
  description: string;
  code: string;
  error: string | null;
}

function emptyEditor(): EditorState {
  return { mode: 'new', name: '', kind: '', description: '', code: '', error: null };
}

export function FunctionsDrawer() {
  const nodes = useFlowStore((s) => s.nodes);
  const flowFunctions = useFlowStore((s) => s.flowFunctions);
  const upsertFlowFunction = useFlowStore((s) => s.upsertFlowFunction);
  const removeFlowFunction = useFlowStore((s) => s.removeFlowFunction);
  const setSelectedNode = useFlowStore((s) => s.setSelectedNode);
  const requestFocusNode = useFlowStore((s) => s.requestFocusNode);

  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  // Usage counts SIBLING FUNCTION calls as well as pin expressions: helpers
  // share one namespace, so a helper called by 7 other helpers (`shq`) is
  // used — it used to read "used 0" and land in the "unused" badge.
  const usage = useMemo(() => {
    const map = new Map<string, ReturnType<typeof findFunctionCallSites>>();
    for (const fn of flowFunctions) {
      map.set(fn.name, findFunctionCallSites(nodes, fn.name, flowFunctions));
    }
    return map;
  }, [nodes, flowFunctions]);

  const unusedCount = useMemo(
    () => flowFunctions.filter((fn) => (usage.get(fn.name) || []).length === 0).length,
    [flowFunctions, usage]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flowFunctions;
    return flowFunctions.filter(
      (fn) =>
        fn.name.toLowerCase().includes(q) ||
        (fn.kind || '').toLowerCase().includes(q) ||
        (fn.description || '').toLowerCase().includes(q)
    );
  }, [flowFunctions, query]);

  const openNew = () => {
    setEditor({
      ...emptyEditor(),
      code: 'def my_helper(state):\n    return state\n',
      name: '',
    });
  };

  const openEdit = (fn: FlowFunction) => {
    setEditor({
      mode: 'edit',
      previousName: fn.name,
      name: fn.name,
      kind: fn.kind || '',
      description: fn.description || '',
      code: fn.code,
      error: null,
    });
  };

  const saveEditor = () => {
    if (!editor) return;
    const err = upsertFlowFunction(
      {
        name: editor.name.trim(),
        code: editor.code,
        kind: editor.kind.trim() || undefined,
        description: editor.description.trim() || undefined,
      },
      editor.mode === 'edit' ? { previousName: editor.previousName } : undefined
    );
    if (err) {
      setEditor({ ...editor, error: err });
      return;
    }
    setEditor(null);
  };

  const deleteFunction = (name: string) => {
    const err = removeFlowFunction(name);
    setRowError((prev) => ({ ...prev, [name]: err || '' }));
  };

  const jumpToNode = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId) || null;
    if (node) {
      setSelectedNode(node);
      // Bring the consumer into view — selection alone leaves it off-viewport
      // on large flows (the Used-by click looked like a no-op). Adversary P1-10.
      requestFocusNode(nodeId);
    }
  };

  return (
    <div className="functions-drawer" data-testid="functions-drawer">
      <div className="functions-drawer-head">
        <h3>
          <span className="fx-glyph">ƒ</span> Functions
        </h3>
        <div className="functions-drawer-actions">
          {unusedCount > 0 ? (
            <span
              className="functions-unused-badge"
              title="Functions nothing calls yet — no pin expression and no other function"
            >
              {unusedCount} unused
            </span>
          ) : null}
          <button type="button" className="fx-btn fx-btn-primary" onClick={openNew}>
            + New
          </button>
        </div>
      </div>
      <input
        className="functions-search"
        type="text"
        placeholder="Search functions…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {editor ? (
        <div className="functions-editor">
          <div className="functions-editor-title">
            {editor.mode === 'new' ? 'New function' : `Edit ${editor.previousName}`}
          </div>
          <label className="functions-field">
            <span>Name</span>
            <input
              type="text"
              value={editor.name}
              placeholder="my_helper"
              onChange={(e) => setEditor({ ...editor, name: e.target.value, error: null })}
            />
          </label>
          <label className="functions-field">
            <span>Kind</span>
            <select value={editor.kind} onChange={(e) => setEditor({ ...editor, kind: e.target.value })}>
              <option value="">(optional)</option>
              {KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="functions-field">
            <span>Description</span>
            <input
              type="text"
              value={editor.description}
              placeholder="What this helper answers"
              onChange={(e) => setEditor({ ...editor, description: e.target.value })}
            />
          </label>
          <textarea
            className="functions-code-area"
            value={editor.code}
            spellCheck={false}
            rows={Math.min(16, Math.max(5, editor.code.split('\n').length + 1))}
            onChange={(e) => setEditor({ ...editor, code: e.target.value, error: null })}
          />
          <div className="functions-editor-hint">
            Full <code>def {editor.name.trim() || 'name'}(…)</code> source. Runs in the code-node
            sandbox; callable from pin expressions as{' '}
            <code>{editor.name.trim() || 'name'}(vars.state)</code>.
          </div>
          {editor.error ? <div className="functions-error">{editor.error}</div> : null}
          <div className="fx-editor-actions">
            <span className="fx-editor-spacer" />
            <button type="button" className="fx-btn" onClick={() => setEditor(null)}>
              Cancel
            </button>
            <button type="button" className="fx-btn fx-btn-primary" onClick={saveEditor}>
              Save
            </button>
          </div>
        </div>
      ) : null}

      <div className="functions-list">
        {visible.length === 0 && !editor ? (
          <div className="functions-empty">
            {flowFunctions.length === 0 ? (
              <>
                No functions yet. Create one here, or promote a pin expression
                (<span className="fx-glyph">ƒx</span> chip → “Promote to function…”).
              </>
            ) : (
              'No functions match the search.'
            )}
          </div>
        ) : null}
        {visible.map((fn) => {
          const sites = usage.get(fn.name) || [];
          const isOpen = expanded === fn.name;
          return (
            <div key={fn.name} className={clsx('functions-row', isOpen && 'open')}>
              <button
                type="button"
                className="functions-row-head"
                onClick={() => setExpanded(isOpen ? null : fn.name)}
                title={fn.description || fn.name}
              >
                <span className="fx-glyph">ƒ</span>
                {/* Name and params are separate spans: the NAME never
                    truncates (a drawer full of "mw_…" rows is unreadable);
                    the parameter list absorbs the squeeze. */}
                <span className="functions-row-signature">
                  <span className="functions-row-name">{fn.name}</span>
                  <span className="functions-row-params">({functionParams(fn)})</span>
                </span>
                {fn.kind ? (
                  // A span with its own click (nested buttons are invalid
                  // HTML): tag = filter, tooltip = plain-words legend.
                  <span
                    className="functions-kind-tag functions-kind-tag-filter"
                    role="button"
                    tabIndex={0}
                    title={`${KIND_HINTS[fn.kind] || 'helper'} — click to filter by "${fn.kind}"`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setQuery((prev) => (prev === fn.kind ? '' : fn.kind || ''));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        setQuery((prev) => (prev === fn.kind ? '' : fn.kind || ''));
                      }
                    }}
                  >
                    {fn.kind}
                  </span>
                ) : null}
                <span className={clsx('functions-used-tag', sites.length === 0 && 'unused')}>
                  used {sites.length}
                </span>
                <span className="functions-row-caret">{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen ? (
                <div className="functions-row-body">
                  {fn.description ? <div className="functions-row-desc">{fn.description}</div> : null}
                  <pre className="functions-code-view">{fn.code}</pre>
                  <div className="functions-usedby">
                    <div className="functions-usedby-title">Used by</div>
                    {sites.length === 0 ? (
                      <div className="functions-usedby-empty">
                        Nothing calls this yet — no pin expression and no other function.
                      </div>
                    ) : (
                      sites.map((site) =>
                        // A sibling-function caller has no node to pan to:
                        // render it as a drawer row that opens that function.
                        site.kind === 'function' ? (
                          <button
                            key={`fn:${site.nodeLabel}`}
                            type="button"
                            className="functions-usedby-row"
                            onClick={() => setExpanded(site.nodeLabel)}
                            title={site.expression}
                          >
                            <span className="functions-usedby-node">
                              <span className="fx-glyph">ƒ</span> {site.nodeLabel}
                            </span>
                            <span className="functions-usedby-pin">· function</span>
                          </button>
                        ) : (
                          <button
                            key={`${site.nodeId}:${site.pinId}`}
                            type="button"
                            className="functions-usedby-row"
                            onClick={() => jumpToNode(site.nodeId)}
                            title={site.expression}
                          >
                            <span className="functions-usedby-node">{site.nodeLabel}</span>
                            <span className="functions-usedby-pin">· {site.pinId}</span>
                          </button>
                        )
                      )
                    )}
                  </div>
                  {rowError[fn.name] ? <div className="functions-error">{rowError[fn.name]}</div> : null}
                  <div className="fx-editor-actions">
                    <button
                      type="button"
                      className="fx-btn fx-btn-danger"
                      onClick={() => deleteFunction(fn.name)}
                    >
                      Delete
                    </button>
                    <span className="fx-editor-spacer" />
                    <button type="button" className="fx-btn" onClick={() => openEdit(fn)}>
                      Edit
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
