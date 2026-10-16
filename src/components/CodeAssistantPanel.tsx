import { useCallback, useEffect, useRef, useState } from 'react';
import { clipboardWriteOrThrow } from '../lib/copy_feedback';
import {
  askCodeAssistant,
  buildCodeAssistantPrompt,
  buildCodeAssistantSystemPrompt,
  CodeAssistantCancelled,
  extractCodeBlock,
  resolveCodeAssistantModel,
  type CodeAssistantContext,
  type CodeAssistantModel,
  type CodeAssistantTurn,
} from '../utils/codeAssistant';
import { gatewayCapabilityDefaults, type GatewayCapabilityDefaultsResponse, type GatewayContracts } from '../utils/gatewayClient';
import { gatewayContractsFromCapabilities, useGatewayCapabilities } from '../hooks/useGatewayCapabilities';

interface CodeAssistantPanelProps {
  context: CodeAssistantContext;
  contracts: GatewayContracts | null;
  /** The author took a reply's code into the editor. */
  onInsert: (code: string) => void;
}

const SUGGESTIONS = ['Add the current date and time to the output', 'Validate the input and return an error message when a field is missing', 'Turn the input into a short summary string'];

/**
 * The Code node's coding assistant: a small chat with the gateway's default
 * text model, grounded on the node (variables, current body, test input, the
 * sandbox's import rule). Every reply with code offers Insert (replaces the
 * editor body) and Copy. One basic-agent run per question; Stop cancels the
 * wait (the run finishes on its own on the gateway).
 */
export function CodeAssistantPanel({ context, contracts: givenContracts, onInsert }: CodeAssistantPanelProps) {
  // The node card opens the editor without gateway contracts in hand: resolve them here
  // (the shared capabilities query, cached) so the assistant works from either entry.
  const ownCapabilities = useGatewayCapabilities(!givenContracts);
  const contracts = givenContracts || gatewayContractsFromCapabilities(ownCapabilities.data);
  const [turns, setTurns] = useState<CodeAssistantTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState<CodeAssistantModel | null>(null);
  const [modelError, setModelError] = useState('');
  const cancelledRef = useRef(false);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    let alive = true;
    if (!contracts) return undefined;
    gatewayCapabilityDefaults(contracts)
      .then((defaults: GatewayCapabilityDefaultsResponse) => {
        if (!alive) return;
        const resolved = resolveCodeAssistantModel(defaults);
        setModel(resolved);
        setModelError(resolved ? '' : 'The gateway has no default text model configured.');
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setModel(null);
        setModelError((error instanceof Error && error.message) || String(error) || 'The gateway did not answer.');
      });
    return () => {
      alive = false;
    };
  }, [contracts]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  const ask = useCallback(
    async (text: string) => {
      const request = text.trim();
      if (!request || busy || !model) return;
      const history = turns;
      setTurns((prev) => [...prev, { role: 'user', text: request }]);
      setDraft('');
      setBusy(true);
      cancelledRef.current = false;
      try {
        const ctx = contextRef.current;
        const reply = await askCodeAssistant({
          contracts,
          model,
          system: buildCodeAssistantSystemPrompt(ctx),
          prompt: buildCodeAssistantPrompt(ctx, history, request),
          isCancelled: () => cancelledRef.current,
        });
        const code = extractCodeBlock(reply);
        const explanation = reply.replace(/```[\s\S]*?```/g, '').trim();
        setTurns((prev) => [...prev, { role: 'assistant', text: explanation || (code ? 'Here is the code.' : reply), code }]);
      } catch (error) {
        if (!(error instanceof CodeAssistantCancelled)) {
          setTurns((prev) => [...prev, { role: 'assistant', text: error instanceof Error ? error.message : String(error), error: true }]);
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, contracts, model, turns]
  );

  const copy = useCallback(async (code: string) => {
    try {
      await clipboardWriteOrThrow(code);
    } catch {
      /* the browser refused the clipboard: the code stays visible to select by hand */
    }
  }, []);

  const disabled = busy || !model;

  return (
    <div className="code-side-section code-assistant-section" aria-label="Code assistant">
      <div className="code-assistant-head">
        <span className="code-side-title">Code assistant</span>
        <small className="code-assistant-model" title={model ? `Gateway default text model: ${model.label}` : modelError}>
          {model ? model.label : modelError || 'Resolving the gateway model…'}
        </small>
      </div>
      <div className="code-assistant-thread" ref={threadRef} role="log" aria-live="polite">
        {turns.length === 0 ? (
          <div className="code-assistant-empty">
            <p>Ask for the Python you need. The assistant knows this node&rsquo;s variables, the current body, the test input and what the sandbox allows.</p>
            <div className="code-assistant-suggestions">
              {SUGGESTIONS.map((s) => (
                <button type="button" key={s} className="code-assistant-suggestion" disabled={disabled} onClick={() => void ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {turns.map((turn, i) => (
          <div key={i} className={`code-assistant-msg ${turn.role} ${turn.error ? 'error' : ''}`}>
            <div className="code-assistant-text">{turn.text}</div>
            {turn.code ? (
              <div className="code-assistant-code">
                <pre>
                  <code>{turn.code}</code>
                </pre>
                <div className="code-assistant-code-actions">
                  <button type="button" className="modal-button primary code-assistant-insert" onClick={() => onInsert(turn.code || '')}>
                    Insert into editor
                  </button>
                  <button type="button" className="modal-button secondary" onClick={() => void copy(turn.code || '')}>
                    Copy
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
        {busy ? <div className="code-assistant-msg assistant pending">Thinking…</div> : null}
      </div>
      <form
        className="code-assistant-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
      >
        <textarea
          className="code-assistant-input"
          value={draft}
          placeholder={model ? 'Describe the code you need (Python)…' : 'Waiting for the gateway model…'}
          rows={2}
          spellCheck={false}
          disabled={!model}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask(draft);
            }
          }}
        />
        {busy ? (
          <button
            type="button"
            className="modal-button secondary"
            onClick={() => {
              cancelledRef.current = true;
            }}
          >
            Stop
          </button>
        ) : (
          <button type="submit" className="modal-button primary" disabled={disabled || !draft.trim()}>
            Ask
          </button>
        )}
      </form>
    </div>
  );
}

export default CodeAssistantPanel;
