import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { installViewportVars, useAfMedia } from '@abstractframework/ui-kit';
import { TOAST_TOP_QUERY, toastPosition } from './utils/toastPlacement';
import App from './App';
import '@abstractframework/ui-kit/theme.css';
import './styles/index.css';
import './styles/nodes.css';
import './styles/palette.css';
import './styles/tooltip.css';
// Last: adapts the desktop rules above to narrow, short and touch screens.
import './styles/responsive.css';
// After responsive.css: list + detail screens use the full width on phones and
// tablets (DESIGN §12).
import './styles/space.css';

// Mirrors the visual viewport into --vv-height / --keyboard-inset (iOS keeps
// the layout viewport under the on-screen keyboard). responsive.css reads
// them: the assistant composer pads by --keyboard-inset, bottom sheets sit on
// top of the keyboard and cap their height at --vv-height.
installViewportVars();

// Phones: dialogs are bottom sheets whose primary action is at the bottom, so
// toasts move to the top there (they covered "Load" and the run footer).
function ResponsiveToaster() {
  const top = useAfMedia(TOAST_TOP_QUERY);
  return (
    <Toaster
      containerClassName="app-toaster"
      position={toastPosition(top)}
      containerStyle={top ? { top: 'max(8px, env(safe-area-inset-top, 0px))' } : undefined}
    />
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <ResponsiveToaster />
    </QueryClientProvider>
  </React.StrictMode>
);
