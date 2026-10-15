import { useEffect, useState } from 'react';
import { IconFilePlus, IconFolder, IconSpinner } from './ToolbarIcons';
import { requestNewFlow, requestOpenFlow } from '../utils/flowStart';
import { useGatewayCapabilities } from '../hooks/useGatewayCapabilities';

/**
 * What the canvas shows before any flow is created or opened (operator
 * 2026-10-11): Create Flow and Open Flow, side by side. Create opens the New
 * flow dialog, Open the Flow Library.
 *
 * The Flow Library needs the gateway's capabilities, checked once at start-up
 * (a few seconds). Open Flow pressed before that answer waits on its own
 * button (a spinner, "Connecting to the gateway…") and opens the library as
 * soon as the answer arrives; it never refuses with a "Checking Gateway
 * capabilities" toast. A failed check is then reported as before.
 */
export function StartChoice() {
  const checking = useGatewayCapabilities(true).isLoading;
  const [openWhenReady, setOpenWhenReady] = useState(false);
  useEffect(() => {
    if (!openWhenReady || checking) return;
    setOpenWhenReady(false);
    requestOpenFlow();
  }, [openWhenReady, checking]);
  const waiting = openWhenReady && checking;

  return (
    <div className="canvas-start-choice" role="group" aria-label="Start a flow">
      <button type="button" className="canvas-start-button canvas-start-button--create" onClick={requestNewFlow}>
        <span className="canvas-start-icon" aria-hidden="true">
          <IconFilePlus />
        </span>
        <span className="canvas-start-label">Create Flow</span>
        <span className="canvas-start-hint">Title, description, interfaces</span>
      </button>
      <button
        type="button"
        className="canvas-start-button canvas-start-button--open"
        aria-busy={waiting}
        onClick={() => (checking ? setOpenWhenReady(true) : requestOpenFlow())}
      >
        <span className="canvas-start-icon" aria-hidden="true">
          {waiting ? <IconSpinner /> : <IconFolder />}
        </span>
        <span className="canvas-start-label">Open Flow</span>
        <span className="canvas-start-hint" aria-live="polite">
          {waiting ? 'Connecting to the gateway…' : 'From the Flow Library'}
        </span>
      </button>
    </div>
  );
}
