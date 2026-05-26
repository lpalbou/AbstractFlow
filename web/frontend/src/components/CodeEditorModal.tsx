/**
 * Monaco-based editor modal for Code node Python bodies.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react';
import type { editor, languages } from 'monaco-editor';
import type { Pin } from '../types/flow';
import {
  generatePythonTransformCode,
  getPythonCodeUserPins,
  getPythonVarNameForPin,
  upsertPythonAvailableVariablesComments,
} from '../utils/codegen';
import { gatewayJson, gatewayPath, jsonRequest } from '../utils/gatewayClient';

interface CodeEditorModalProps {
  isOpen: boolean;
  title?: string;
  body: string;
  params: Pin[];
  permissions?: string;
  permissionsUnavailableReason?: string;
  onClose: () => void;
  onSave: (body: string) => void;
}

interface CodeSimulationResponse {
  ok?: boolean;
  success?: boolean;
  output?: unknown;
  execution?: Record<string, unknown>;
  error?: string | null;
  diagnostics?: Record<string, unknown>;
}

const MONACO_THEME_ID = 'abstractflow-code';

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function normalizeHexColor(value: string, fallback: string): string {
  const raw = String(value || '').trim();
  const fallbackRaw = String(fallback || '#ffffff').trim();
  const candidate = raw.startsWith('#') ? raw.slice(1) : raw;
  if (/^[0-9a-f]{3}$/i.test(candidate)) {
    return candidate
      .split('')
      .map((ch) => `${ch}${ch}`)
      .join('')
      .toLowerCase();
  }
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(candidate)) return candidate.toLowerCase();
  const fallbackCandidate = fallbackRaw.startsWith('#') ? fallbackRaw.slice(1) : fallbackRaw;
  if (/^[0-9a-f]{3}$/i.test(fallbackCandidate)) {
    return fallbackCandidate
      .split('')
      .map((ch) => `${ch}${ch}`)
      .join('')
      .toLowerCase();
  }
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(fallbackCandidate)) return fallbackCandidate.toLowerCase();
  return 'ffffff';
}

function tokenColor(name: string, fallback: string): string {
  return normalizeHexColor(cssVar(name, fallback), fallback);
}

function themeColor(name: string, fallback: string): string {
  return `#${normalizeHexColor(cssVar(name, fallback), fallback)}`;
}

function sampleForPin(pin: Pin): unknown {
  switch (pin.type) {
    case 'string':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return null;
  }
}

function buildSampleInput(params: Pin[]): string {
  const sample: Record<string, unknown> = {};
  for (const pin of getPythonCodeUserPins(params)) {
    sample[pin.id] = sampleForPin(pin);
  }
  return JSON.stringify(sample, null, 2);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function paramsSignature(params: Pin[]): string {
  return getPythonCodeUserPins(params)
    .map((pin) => `${pin.id}:${pin.type}:${pin.label || ''}`)
    .join('|');
}

function variableRows(params: Pin[]): Array<{ id: string; type: string; name: string; access: string }> {
  return getPythonCodeUserPins(params)
    .map((pin) => ({
      id: pin.id,
      type: String(pin.type || 'any'),
      name: getPythonVarNameForPin(pin),
      access: `_input.get(${JSON.stringify(pin.id)})`,
    }));
}

function formatSimulationResult(result: CodeSimulationResponse): string {
  const lines: string[] = [];
  const execution = result.execution && typeof result.execution === 'object' ? result.execution : {};
  const diagnostics = result.diagnostics && typeof result.diagnostics === 'object' ? result.diagnostics : null;

  lines.push(`status: ${result.success ? 'success' : 'error'}`);
  if (typeof execution.duration_ms === 'number') lines.push(`duration_ms: ${execution.duration_ms}`);
  if (typeof execution.cpu_time_ms === 'number') lines.push(`cpu_time_ms: ${execution.cpu_time_ms}`);
  if (typeof execution.cpu_percent === 'number') lines.push(`cpu_percent: ${execution.cpu_percent}`);
  if (typeof execution.memory_rss_mb === 'number') lines.push(`process_rss_mb: ${execution.memory_rss_mb}`);
  if (typeof execution.memory_rss_delta_mb === 'number') lines.push(`process_rss_delta_mb: ${execution.memory_rss_delta_mb}`);
  if (typeof execution.permissions === 'string') lines.push(`permissions: ${execution.permissions}`);
  if (result.error) lines.push(`error: ${result.error}`);
  lines.push('');
  lines.push('output:');
  lines.push(formatJson(result.output ?? null));
  if (diagnostics) {
    lines.push('');
    lines.push('diagnostics:');
    lines.push(formatJson(diagnostics));
  }
  return lines.join('\n');
}

export function CodeEditorModal({
  isOpen,
  title,
  body,
  params,
  permissions = 'sandbox',
  permissionsUnavailableReason = '',
  onClose,
  onSave,
}: CodeEditorModalProps) {
  const parameterSignature = paramsSignature(params);
  const initialBody = useMemo(
    () => upsertPythonAvailableVariablesComments(body, params),
    // `parameterSignature` is the stable dependency; `params` array identity changes on parent rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [body, parameterSignature]
  );
  const initialSampleInput = useMemo(
    () => buildSampleInput(params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parameterSignature]
  );
  const variables = useMemo(
    () => variableRows(params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parameterSignature]
  );
  const [value, setValue] = useState(body);
  const [sampleInput, setSampleInput] = useState(() => buildSampleInput(params));
  const [testResult, setTestResult] = useState('');
  const [rawTestResult, setRawTestResult] = useState('');
  const [showRawResult, setShowRawResult] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [isResultOpen, setIsResultOpen] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const completionDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    setValue(initialBody);
  }, [initialBody, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setSampleInput(initialSampleInput);
  }, [initialSampleInput, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setTestResult('');
    setRawTestResult('');
    setShowRawResult(false);
    setTestStatus('idle');
    setIsResultOpen(false);
    setIsTesting(false);
  }, [isOpen]);

  useEffect(() => {
    return () => {
      completionDisposableRef.current?.dispose();
      completionDisposableRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (typeof document === 'undefined') return;
    document.body.classList.add('af-code-editor-open');
    return () => {
      document.body.classList.remove('af-code-editor-open');
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const handleBeforeMount = useCallback<BeforeMount>((monaco) => {
    monaco.editor.defineTheme(MONACO_THEME_ID, {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: tokenColor('--text-muted', '#7f8a9b') },
        { token: 'keyword', foreground: tokenColor('--accent-primary', '#ff4778') },
        { token: 'string', foreground: '7ec699' },
        { token: 'number', foreground: '78c2ff' },
      ],
      colors: {
        'editor.background': themeColor('--bg-primary', '#111827'),
        'editor.foreground': themeColor('--text-primary', '#f4f7fb'),
        'editorLineNumber.foreground': themeColor('--text-muted', '#6f7a8f'),
        'editorCursor.foreground': themeColor('--accent-primary', '#ff4778'),
        'editor.selectionBackground': themeColor('--accent-muted', '#284d82'),
        'editorSuggestWidget.background': themeColor('--bg-secondary', '#17172a'),
        'editorSuggestWidget.border': themeColor('--border-primary', '#2b3550'),
        'editorSuggestWidget.foreground': themeColor('--text-primary', '#f4f7fb'),
        'editorSuggestWidget.selectedBackground': themeColor('--accent-muted', '#284d82'),
      },
    });
  }, []);

  const handleMount = useCallback<OnMount>(
    (_editor, monaco) => {
      monaco.editor.setTheme(MONACO_THEME_ID);
      completionDisposableRef.current?.dispose();
      completionDisposableRef.current = monaco.languages.registerCompletionItemProvider('python', {
        triggerCharacters: ['.', '_', '{', '"'],
        provideCompletionItems: (model: editor.ITextModel, position: { lineNumber: number; column: number }) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          const variables = getPythonCodeUserPins(params)
            .map((pin): languages.CompletionItem => ({
              label: getPythonVarNameForPin(pin),
              kind: monaco.languages.CompletionItemKind.Variable,
              insertText: getPythonVarNameForPin(pin),
              detail: `${pin.id}: ${pin.type}`,
              range,
            }));
          const helpers: languages.CompletionItem[] = [
            {
              label: '_input',
              kind: monaco.languages.CompletionItemKind.Variable,
              insertText: '_input',
              detail: 'Full node input dictionary',
              range,
            },
            {
              label: 'return output',
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: 'return ${1:output}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: 'safe dictionary result',
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: 'return {${1:"value"}: ${2:value}}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            ...['len', 'str', 'int', 'float', 'bool', 'list', 'dict', 'range', 'enumerate', 'sorted', 'min', 'max', 'sum', 'isinstance'].map(
              (name): languages.CompletionItem => ({
                label: name,
                kind: monaco.languages.CompletionItemKind.Function,
                insertText: name,
                range,
              })
            ),
          ];
          return { suggestions: [...variables, ...helpers] };
        },
      });
    },
    [params]
  );

  const handleSave = useCallback(() => {
    onSave(upsertPythonAvailableVariablesComments(value, params));
  }, [onSave, params, value]);

  const handleRunTest = useCallback(async () => {
    let inputPayload: unknown;
    if (permissionsUnavailableReason) {
      setTestStatus('error');
      setTestResult(permissionsUnavailableReason);
      setRawTestResult('');
      setShowRawResult(false);
      setIsResultOpen(true);
      return;
    }
    try {
      inputPayload = sampleInput.trim() ? JSON.parse(sampleInput) : {};
    } catch (error) {
      setTestStatus('error');
      setTestResult(`Invalid input JSON: ${formatError(error)}`);
      setRawTestResult('');
      setShowRawResult(false);
      setIsResultOpen(true);
      return;
    }

    setIsTesting(true);
    setTestStatus('idle');
    setTestResult('');
    setRawTestResult('');
    setShowRawResult(false);
    setIsResultOpen(true);
    try {
      const code = generatePythonTransformCode(params, value);
      const result = await gatewayJson<CodeSimulationResponse>(
        gatewayPath('/visualflows/code/simulate'),
        {
          ...jsonRequest({ code, input: inputPayload, function_name: 'transform', permissions }, { method: 'POST' }),
          timeoutMs: 30_000,
        }
      );
      setTestStatus(result.success ? 'ok' : 'error');
      setTestResult(formatSimulationResult(result));
      setRawTestResult(formatJson(result));
    } catch (error) {
      setTestStatus('error');
      setTestResult(formatError(error));
      setRawTestResult('');
    } finally {
      setIsTesting(false);
    }
  }, [parameterSignature, params, permissions, permissionsUnavailableReason, sampleInput, value]);

  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="modal-overlay code-editor-overlay" onClick={onClose}>
      <div
        className="modal code-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Code'}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onKeyUp={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3>{title || 'Code'}</h3>
            <p className="code-editor-subtitle">Edit the body of <code>transform(_input)</code>.</p>
          </div>
          <button type="button" className="modal-button code-editor-close" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>

        <div className={`modal-body code-editor-body ${isResultOpen ? 'result-open' : 'result-collapsed'}`}>
          <div className="code-editor-workspace">
            <section className="code-editor-main">
              <div className="code-editor-container">
                <Editor
                  height="100%"
                  defaultLanguage="python"
                  beforeMount={handleBeforeMount}
                  onMount={handleMount}
                  theme={MONACO_THEME_ID}
                  value={value}
                  onChange={(v) => setValue(v ?? '')}
                  options={{
                    automaticLayout: true,
                    minimap: { enabled: false },
                    fontFamily: 'Menlo, Monaco, Consolas, monospace',
                    fontSize: 13,
                    fontLigatures: true,
                    lineNumbers: 'on',
                    lineNumbersMinChars: 3,
                    tabSize: 4,
                    insertSpaces: true,
                    folding: true,
                    renderLineHighlight: 'all',
                    roundedSelection: false,
                    wordWrap: 'on',
                    scrollBeyondLastLine: false,
                    padding: { top: 12, bottom: 12 },
                    quickSuggestions: { other: true, comments: false, strings: false },
                    suggestOnTriggerCharacters: true,
                    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
                  }}
                />
              </div>
            </section>

            <aside className="code-test-panel">
              <div className="code-side-section">
                <div className="code-side-title">Input Variables</div>
                <div className="code-variable-list">
                  <div className="code-variable-card">
                    <span>_input</span>
                    <code>dict</code>
                    <small>full input payload</small>
                  </div>
                  {variables.map((variable) => (
                    <div className="code-variable-card" key={variable.id}>
                      <span>{variable.name}</span>
                      <code>{variable.type}</code>
                      <small>{variable.access}</small>
                    </div>
                  ))}
                </div>
              </div>

              <div className="code-side-section code-test-section">
                <label className="code-side-title" htmlFor="code-test-input">
                  Test Input
                </label>
                <textarea
                  id="code-test-input"
                  className="code-test-input"
                  value={sampleInput}
                  spellCheck={false}
                  onChange={(e) => setSampleInput(e.target.value)}
                />
                {permissionsUnavailableReason ? <span className="property-hint">{permissionsUnavailableReason}</span> : null}
                <button
                  type="button"
                  className="modal-button secondary code-test-button"
                  disabled={isTesting || Boolean(permissionsUnavailableReason)}
                  onClick={handleRunTest}
                >
                  {isTesting ? 'Testing...' : 'Test code'}
                </button>
              </div>
            </aside>
          </div>

          <section className={`code-result-terminal ${isResultOpen ? 'open' : 'collapsed'} ${testStatus !== 'idle' ? testStatus : ''}`}>
            <button
              type="button"
              className="code-result-header"
              onClick={() => setIsResultOpen((open) => !open)}
              aria-expanded={isResultOpen}
            >
              <span className="code-result-label">
                <span className="code-result-chevron" aria-hidden="true">
                  {isResultOpen ? '▾' : '▸'}
                </span>
                Result
              </span>
              <span className="code-result-state">
                {isTesting ? 'running' : testStatus === 'ok' ? 'success' : testStatus === 'error' ? 'error' : 'not run'}
              </span>
            </button>
            {isResultOpen && (
              <div className="code-result-content">
                {rawTestResult ? (
                  <div className="code-result-tools">
                    <button type="button" className="code-result-raw-toggle" onClick={() => setShowRawResult((raw) => !raw)}>
                      {showRawResult ? 'Summary' : 'Raw'}
                    </button>
                  </div>
                ) : null}
                <pre className={`code-test-result ${testStatus !== 'idle' ? testStatus : ''}`} aria-live="polite">
                  {showRawResult && rawTestResult ? rawTestResult : testResult || (isTesting ? 'Running...' : 'No test run yet.')}
                </pre>
              </div>
            )}
          </section>
        </div>

        <div className="modal-actions">
          <button className="modal-button" onClick={onClose}>
            Cancel
          </button>
          <button className="modal-button primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default CodeEditorModal;
