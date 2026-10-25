/**
 * Everything the trigger picker needs from the gateway, loaded once per
 * dialog: the served trigger sources, the person's mailboxes and trigger
 * connections and the central history budget. Each fact loads (and fails)
 * on its own, so a gateway without mailboxes still offers Run now; a failure
 * is shown where the fact is used, never hidden. A fact stays 'loading'
 * through the read's tries (gatewayFetch, utils/readRetry.ts) and becomes
 * 'error' only after the last one failed (framework ADR-0039). When a reload
 * overlaps an earlier read, only the newest answer is kept.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GatewayContracts } from '../../utils/gatewayClient';
import { fetchGatewayConnection } from '../GatewayConnectionModal';
import { triggerSourceCache, type TriggerSourcesResult } from '../../utils/triggerSources';
import { fetchTriggerConnections, type TriggerConnectionsResult } from '../../utils/triggerConnections';
import type { Mailbox } from '../../utils/automationChoice';
import { fetchHistoryDefault, fetchMailboxes } from '../../utils/automationGateway';

export type Fact<T> = { state: 'loading' } | { state: 'ok'; value: T } | { state: 'error'; message: string };

export interface AutomationFacts {
  gatewayUrl: string;
  sources: Fact<TriggerSourcesResult>;
  mailboxes: Fact<{ status: 'ok'; mailboxes: Mailbox[] } | { status: 'unavailable'; reason: string }>;
  connections: Fact<TriggerConnectionsResult>;
  historyDefault: Fact<number>;
  reloadSources: () => void;
  reloadArrivals: () => void;
}

const LOADING = { state: 'loading' } as const;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function settle<T>(work: () => Promise<T>): Promise<Fact<T>> {
  try {
    return { state: 'ok', value: await work() };
  } catch (error) {
    return { state: 'error', message: message(error) };
  }
}

export function useAutomationFacts(gatewayContracts: GatewayContracts | null, options: { enabled?: boolean } = {}): AutomationFacts {
  const enabled = options.enabled !== false;
  const [gatewayUrl, setGatewayUrl] = useState('');
  const [sources, setSources] = useState<AutomationFacts['sources']>(LOADING);
  const [mailboxes, setMailboxes] = useState<AutomationFacts['mailboxes']>(LOADING);
  const [connections, setConnections] = useState<AutomationFacts['connections']>(LOADING);
  const [historyDefault, setHistoryDefault] = useState<AutomationFacts['historyDefault']>(LOADING);

  const sourcesRead = useRef(0);
  const arrivalsRead = useRef(0);
  const loadSources = useCallback(
    async (refresh: boolean) => {
      const read = ++sourcesRead.current;
      setSources(LOADING);
      const fact = await settle(async () => {
        const connection = await fetchGatewayConnection();
        if (read === sourcesRead.current) setGatewayUrl(connection.gateway_url);
        return triggerSourceCache.load(connection.gateway_url, gatewayContracts, { refresh });
      });
      if (read === sourcesRead.current) setSources(fact);
    },
    [gatewayContracts]
  );
  const loadArrivals = useCallback(async () => {
    const read = ++arrivalsRead.current;
    setMailboxes(LOADING);
    setConnections(LOADING);
    const [m, c] = await Promise.all([settle(() => fetchMailboxes()), settle(() => fetchTriggerConnections())]);
    if (read !== arrivalsRead.current) return;
    setMailboxes(m);
    setConnections(c);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadSources(false);
    void loadArrivals();
    void settle(() => fetchHistoryDefault()).then((fact) => {
      if (alive) setHistoryDefault(fact);
    });
    return () => {
      alive = false;
    };
  }, [enabled, loadSources, loadArrivals]);

  return {
    gatewayUrl,
    sources,
    mailboxes,
    connections,
    historyDefault,
    reloadSources: () => void loadSources(true),
    reloadArrivals: () => void loadArrivals(),
  };
}
