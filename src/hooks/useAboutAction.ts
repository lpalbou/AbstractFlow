// The About action of the top-bar cluster: the AbstractFlow identity (with the
// build-time app version) plus the versions the connected gateway reports.
//
// Every AfTopBarActions instance takes `about={useAboutAction()}` so all call
// sites show the same dialog. The gateway versions come from the public
// `GET /api/gateway/about` route and are fetched when the dialog opens (not at
// page load). A failed request becomes one visible "Gateway: unavailable (...)"
// row; it is never hidden.
import { useCallback, useMemo, useRef, useState } from 'react';
import { appIdentity, gatewayVersionRows, type AppIdentity, type GatewayAboutPayload } from '@abstractframework/ui-kit';
import { gatewayJson, gatewayPath } from '../utils/gatewayClient';

export type AboutExtraRow = [label: string, value: string];

/** `package.json` version, injected at build time (vite.config.ts `define`). */
export const APP_VERSION: string = __APP_VERSION__;

/** Throws at module load if the kit's descriptor does not know "abstractflow". */
export const ABSTRACTFLOW_IDENTITY: AppIdentity = appIdentity('abstractflow', APP_VERSION);

export const GATEWAY_ABOUT_PATH = gatewayPath('/about');

/**
 * Why `GET /api/gateway/about` failed, as shown in the "unavailable (...)"
 * row: the HTTP status and message, or the network error's message.
 */
export function gatewayAboutErrorReason(error: unknown): string {
  const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : null;
  const raw = (error as { message?: unknown })?.message;
  const message = typeof raw === 'string' ? raw : String(error ?? 'unknown error');
  // GatewayHttpError messages already start with "HTTP <status>".
  const detail = status !== null && !message.startsWith(`HTTP ${status}`) ? `HTTP ${status}: ${message}` : message;
  return detail || 'request failed';
}

/**
 * Fetches the gateway versions and formats them with the kit's
 * `gatewayVersionRows` (the same rows in every app). Never throws: a failure
 * becomes the single "Gateway: unavailable (...)" row.
 */
export async function fetchGatewayAboutRows(
  fetcher: (path: string) => Promise<GatewayAboutPayload> = (path) => gatewayJson<GatewayAboutPayload>(path, { timeoutMs: 10_000 })
): Promise<AboutExtraRow[]> {
  let payload: GatewayAboutPayload;
  try {
    payload = await fetcher(GATEWAY_ABOUT_PATH);
  } catch (error) {
    return gatewayVersionRows({ error: gatewayAboutErrorReason(error) });
  }
  return gatewayVersionRows(payload);
}

export interface AboutAction {
  identity: AppIdentity;
  extraRows: AboutExtraRow[];
  onOpen: () => void;
}

/** `about` prop for AfTopBarActions; refetches the gateway versions on every open. */
export function useAboutAction(
  fetchRows: () => Promise<AboutExtraRow[]> = fetchGatewayAboutRows
): AboutAction {
  const [extraRows, setExtraRows] = useState<AboutExtraRow[]>([]);
  const requestSeq = useRef(0);
  const onOpen = useCallback(() => {
    const seq = ++requestSeq.current;
    setExtraRows([['Gateway', 'checking…']]);
    void fetchRows().then((rows) => {
      if (seq === requestSeq.current) setExtraRows(rows);
    });
  }, [fetchRows]);
  return useMemo(() => ({ identity: ABSTRACTFLOW_IDENTITY, extraRows, onOpen }), [extraRows, onOpen]);
}
