import { useEffect, useRef } from 'react';

/**
 * What to create where a dragged wire was released on empty canvas (operator
 * 2026-10-11): a relay, and for an object, a Break Object. The choice is
 * created at the drop point and wired to the pin the drag started from.
 */
export interface ConnectionDropChoice {
  id: string;
  label: string;
  hint: string;
}

export function ConnectionDropMenu({
  title,
  choices,
  at,
  onChoose,
  onCancel,
}: {
  title: string;
  choices: ConnectionDropChoice[];
  /** Viewport position of the drop. */
  at: { x: number; y: number };
  onChoose: (id: string) => void;
  onCancel: () => void;
}) {
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

  const width = 240;
  const left = Math.max(8, Math.min(at.x + 8, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(at.y + 8, window.innerHeight - 40 - choices.length * 52));
  return (
    <div ref={ref} className="drop-menu" role="menu" aria-label={title} style={{ left, top, width }}>
      <div className="drop-menu-title">{title}</div>
      {choices.map((choice) => (
        <button key={choice.id} type="button" role="menuitem" className="drop-menu-option" onClick={() => onChoose(choice.id)}>
          <span className="drop-menu-label">{choice.label}</span>
          <span className="drop-menu-hint">{choice.hint}</span>
        </button>
      ))}
    </div>
  );
}
