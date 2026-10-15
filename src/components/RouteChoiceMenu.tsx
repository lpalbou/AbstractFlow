import { useEffect, useRef } from 'react';
import type { EntryRouteChoice } from '../utils/multiEntryRoutes';

/**
 * Asked when a data wire is dropped on an input that already has a wire, on a
 * node with several entry paths: which path does the new wire feed? The answer
 * becomes a drawn per-path wire (dashed, labelled with its path).
 */
export interface RouteChoiceMenuProps {
  /** The input being fed, e.g. "items". */
  pinLabel: string;
  /** The node being fed, e.g. "ForEach". */
  nodeLabel: string;
  /** Where the new value comes from, e.g. "Break Object · tasks". */
  sourceLabel: string;
  choices: EntryRouteChoice[];
  /** Per route key: what already feeds this input on that path, if anything. */
  currentByRoute: Record<string, string>;
  /** Viewport position of the input pin. */
  anchor: { x: number; y: number };
  onChoose: (routeKey: string) => void;
  onCancel: () => void;
}

export function RouteChoiceMenu({
  pinLabel,
  nodeLabel,
  sourceLabel,
  choices,
  currentByRoute,
  anchor,
  onChoose,
  onCancel,
}: RouteChoiceMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && event.target instanceof globalThis.Node && !ref.current.contains(event.target)) onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onCancel]);

  // Open to the left of the pin (the wire arrives from the left); stay on screen.
  const width = 300;
  const left = Math.max(8, Math.min(anchor.x - width - 14, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(anchor.y - 24, window.innerHeight - 60 - choices.length * 52));

  return (
    <div
      ref={ref}
      className="route-choice-menu"
      role="dialog"
      aria-label={`Choose the path ${sourceLabel} feeds`}
      style={{ left, top, width }}
    >
      <div className="route-choice-title">
        Feed <strong>{nodeLabel} · {pinLabel}</strong> with <strong>{sourceLabel}</strong> when entered from:
      </div>
      <div className="route-choice-list">
        {choices.map((choice) => (
          <button key={choice.key} type="button" className="route-choice-option" onClick={() => onChoose(choice.key)}>
            <span className="route-choice-label">{choice.label}</span>
            {currentByRoute[choice.key] ? (
              <span className="route-choice-current">replaces {currentByRoute[choice.key]}</span>
            ) : null}
          </button>
        ))}
      </div>
      <button type="button" className="route-choice-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
