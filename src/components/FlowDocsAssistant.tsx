import { useLayoutEffect, useState, type RefObject } from 'react';
import { DocsAssistantDrawer, type DocsAssistantSource } from '@abstractframework/panel-chat';
import { docsGatewayFetch } from '../utils/gatewayClient';

/**
 * The Docs assistant (round 8, R8.3): the kit's shared DocsAssistantDrawer —
 * the same chat as the console and every app — grounded on Flow's llms.txt
 * (the gateway reads it from this app's build: `docs/corpus?app=flow`) via
 * the gateway's docs-qa workflow. Separate from the Authoring assistant
 * (which edits flows). Kept mounted while closed.
 */
export const FLOW_DOCS_SOURCE: DocsAssistantSource = { app: 'flow', name: 'AbstractFlow' };

export const FLOW_DOCS_SUGGESTIONS = [
  'How do I run a flow?',
  'What is the difference between a flow and a workflow bundle?',
  'How do I publish a flow to the gateway?',
];

export function FlowDocsAssistant(props: { open: boolean; onClose: () => void; connected: boolean; headerRef: RefObject<HTMLElement | null> }) {
  // Open below the header so the top-bar cluster stays reachable.
  const [top, set_top] = useState(0);
  useLayoutEffect(() => {
    const measure = () => set_top(Math.round(props.headerRef.current?.getBoundingClientRect().bottom || 0));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [props.headerRef, props.open]);
  return (
    <DocsAssistantDrawer
      open={props.open}
      onClose={props.onClose}
      source={FLOW_DOCS_SOURCE}
      fetchGateway={docsGatewayFetch}
      connected={props.connected}
      topOffset={top}
      className="flow-docs-assistant"
      placeholder="Ask about AbstractFlow…"
      suggestions={FLOW_DOCS_SUGGESTIONS}
    />
  );
}
