/**
 * Browser harness for visually checking the Appearance modal and the theme
 * selector dropdown across themes. The popover is opened automatically after
 * mount so a headless screenshot captures the open state.
 *
 * Usage:
 *   npx vite --port 3015 --strictPort
 *   open http://localhost:3015/scripts/appearance_check.html                 (dark)
 *   open http://localhost:3015/scripts/appearance_check.html?theme=one-light (light)
 */

import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { applyTheme } from '@abstractframework/ui-kit';
import { AppearanceModal, type AppearanceSettings } from '../src/components/AppearanceModal';
import '@abstractframework/ui-kit/theme.css';
import '../src/styles/index.css';
import '../src/styles/nodes.css';
import '../src/styles/palette.css';
import '../src/styles/tooltip.css';

const theme = new URLSearchParams(window.location.search).get('theme') || 'dark';
applyTheme(theme);

function Harness() {
  const [value, setValue] = useState<AppearanceSettings>({
    theme,
    font_scale: 'medium',
    header_density: 'comfortable',
  });

  useEffect(() => {
    // Open the theme dropdown so the screenshot shows the popover styling.
    const t = setTimeout(() => {
      const trigger = document.querySelector<HTMLButtonElement>('.af-select-trigger');
      trigger?.click();
    }, 300);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', background: 'var(--bg-primary)' }}>
      <AppearanceModal isOpen value={value} onChange={setValue} onClose={() => undefined} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />);
