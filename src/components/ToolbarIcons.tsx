/**
 * Consistent stroke-based SVG icons for the editor toolbar.
 *
 * All icons share one 24x24 viewBox and inherit `currentColor`, so they render
 * uniformly across platforms (unlike emoji) and follow button text color on
 * hover/disabled states. Sizing is controlled by the `.toolbar-icon` CSS class.
 */

import type { ReactNode } from 'react';

function ToolbarIcon({ children, spin = false }: { children: ReactNode; spin?: boolean }) {
  return (
    <svg
      className={spin ? 'toolbar-icon toolbar-icon--spin' : 'toolbar-icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function IconFilePlus() {
  return (
    <ToolbarIcon>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M12 17v-5" />
      <path d="M9.5 14.5h5" />
    </ToolbarIcon>
  );
}

export function IconFolder() {
  return (
    <ToolbarIcon>
      <path d="M21 18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4.5L12 6.5H19a2 2 0 0 1 2 2z" />
    </ToolbarIcon>
  );
}

export function IconSave() {
  return (
    <ToolbarIcon>
      <path d="M18.5 21H5.5A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3H16l4 4v12.5a1.5 1.5 0 0 1-1.5 1.5z" />
      <path d="M16 21v-7H8v7" />
      <path d="M8 3v4.5h6" />
    </ToolbarIcon>
  );
}

export function IconCopy() {
  return (
    <ToolbarIcon>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5.5 14.5H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5a2 2 0 0 1 2 2v.5" />
    </ToolbarIcon>
  );
}

export function IconExport() {
  return (
    <ToolbarIcon>
      <path d="M12 15V4.5" />
      <path d="M7.8 8.7 12 4.5l4.2 4.2" />
      <path d="M5 19h14" />
    </ToolbarIcon>
  );
}

export function IconImport() {
  return (
    <ToolbarIcon>
      <path d="M12 4.5V15" />
      <path d="M7.8 10.8 12 15l4.2-4.2" />
      <path d="M5 19h14" />
    </ToolbarIcon>
  );
}

export function IconPlay() {
  return (
    <ToolbarIcon>
      <polygon points="7 4.5 20 12 7 19.5" fill="currentColor" />
    </ToolbarIcon>
  );
}

export function IconSpinner() {
  return (
    <ToolbarIcon spin>
      <path d="M21 12a9 9 0 1 1-9-9" />
    </ToolbarIcon>
  );
}

export function IconHistory() {
  return (
    <ToolbarIcon>
      <circle cx="12" cy="12" r="8.5" />
      <polyline points="12 7.5 12 12 15 13.8" />
    </ToolbarIcon>
  );
}

export function IconPackage() {
  return (
    <ToolbarIcon>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.3 7 12 12 20.7 7" />
      <line x1="12" y1="22" x2="12" y2="12" />
    </ToolbarIcon>
  );
}

export function IconLifecycle() {
  return (
    <ToolbarIcon>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </ToolbarIcon>
  );
}

export function IconChip() {
  return (
    <ToolbarIcon>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" />
      <path d="M9 2.5V5" />
      <path d="M15 2.5V5" />
      <path d="M9 19v2.5" />
      <path d="M15 19v2.5" />
      <path d="M2.5 9H5" />
      <path d="M2.5 15H5" />
      <path d="M19 9h2.5" />
      <path d="M19 15h2.5" />
    </ToolbarIcon>
  );
}

export function IconSparkle() {
  return (
    <ToolbarIcon>
      <path d="M12 4c.7 4.4 2.9 6.6 7.3 7.3-4.4.7-6.6 2.9-7.3 7.3-.7-4.4-2.9-6.6-7.3-7.3 4.4-.7 6.6-2.9 7.3-7.3z" />
      <path d="M19 3v3.5" />
      <path d="M17.25 4.75h3.5" />
    </ToolbarIcon>
  );
}

export function IconContrast() {
  return (
    <ToolbarIcon>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
    </ToolbarIcon>
  );
}
