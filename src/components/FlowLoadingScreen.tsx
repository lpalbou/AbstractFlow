import { useEffect } from 'react';
import { useFlowLoading } from '../hooks/flowLoading';

/**
 * The general loading screen while a flow opens (deep link or Open): the
 * flow's name and a Cancel that stops the gateway requests. It covers the
 * editor below the header; the header stays usable. Esc cancels too.
 */
export function FlowLoadingScreen() {
  const name = useFlowLoading((s) => s.name);
  const cancel = useFlowLoading((s) => s.cancel);
  useEffect(() => {
    if (!name) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [name, cancel]);
  return <FlowLoadingView name={name} onCancel={cancel} />;
}

/** The view (stateless): nothing without a name. */
export function FlowLoadingView({ name, onCancel }: { name: string | null; onCancel: () => void }) {
  if (!name) return null;
  return (
    <div className="flow-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="flow-loading__card">
        <span className="flow-loading__spinner" aria-hidden="true" />
        <div className="flow-loading__text">
          <div className="flow-loading__title">
            Opening <strong className="flow-loading__name">{name}</strong>
          </div>
          <div className="flow-loading__hint">Loading the flow from the gateway.</div>
        </div>
        <button type="button" className="flow-loading__cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
