/**
 * The disclosure header of a collapsible list panel (DESIGN §12): a real
 * `<button type="button">` (Enter and Space toggle it) with a chevron,
 * `aria-expanded` and `aria-controls`, 44 px tall on touch (space.css). It
 * stays visible while the list is hidden so the list can be reopened.
 */
import React from 'react';
import { Icon } from '@abstractframework/ui-kit';

export function ListDisclosure(props: {
  open: boolean;
  onToggle: () => void;
  /** id of the element the button shows and hides. */
  controls: string;
  title: string;
  /** Shown after the title (a count, a status). */
  detail?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  const { open, onToggle, controls, title, detail, className } = props;
  return (
    <button
      type="button"
      className={`list-disclosure${className ? ` ${className}` : ''}`}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      title={open ? `Hide ${title.toLowerCase()}` : `Show ${title.toLowerCase()}`}
    >
      <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
      <span className="list-disclosure__title">{title}</span>
      {detail !== undefined && detail !== null ? <span className="list-disclosure__detail">{detail}</span> : null}
    </button>
  );
}

export default ListDisclosure;
