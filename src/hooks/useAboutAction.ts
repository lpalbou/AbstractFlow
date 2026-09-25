// The About action of the top-bar cluster: the AbstractFlow identity (with the
// build-time app version) plus the versions the connected gateway reports.
//
// Every AfTopBarActions instance takes `about={useAboutAction()}` so all call
// sites show the same dialog. The gateway versions come from the public
// `GET /api/gateway/about` route and are fetched when the dialog opens (not at
// page load). A failed request becomes one visible "Gateway: unavailable (...)"
// row; it is never hidden.
import { useCallback, useMemo, useRef, useState } from 'react';
import { appIdentity, type AppIdentity } from '@abstractframework/ui-kit';
import { gatewayJson, gatewayPath } from '../utils/gatewayClient';

export type AboutExtraRow = [label: string, value: string];

/** `package.json` version, injected at build time (vite.config.ts `define`). */
export const APP_VERSION: string = __APP_VERSION__;

/** Throws at module load if the kit's descriptor does not know "abstractflow". */
export const ABSTRACTFLOW_IDENTITY: AppIdentity = appIdentity('abstractflow', APP_VERSION);

export const GATEWAY_ABOUT_PATH = gatewayPath('/about');

/** Shape of `GET /api/gateway/about`. */
export interface GatewayAboutResponse {
  abstractframework?: unknown;
  abstractgateway?: unknown;
  packages?: unknown;
}

function versionText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

/**
 * Rows for the gateway half of the dialog: "Gateway" (abstractgateway),
 * "Gateway framework" (abstractframework) and one row per reported package,
 * sorted by name. A payload without an abstractgateway version is reported as
 * unavailable rather than shown as partial success.
 */
export function gatewayAboutRows(payload: GatewayAboutResponse | null | undefined): AboutExtraRow[] {
  const gateway = versionText(payload?.abstractgateway);
  if (!gateway) {
    return [['Gateway', 'unavailable (response has no abstractgateway version)']];
  }
  const rows: AboutExtraRow[] = [['Gateway', `abstractgateway ${gateway}`]];
  const framework = versionText(payload?.abstractframework);
  rows.push(['Gateway framework', framework ? `abstractframework ${framework}` : 'not reported']);
  const packages = payload?.packages;
  if (packages && typeof packages === 'object' && !Array.isArray(packages)) {
    const names = Object.keys(packages as Record<string, unknown>)
      .filter((name) => name !== 'abstractgateway' && name !== 'abstractframework')
      .sort();
    for (const name of names) {
      rows.push([name, versionText((packages as Record<string, unknown>)[name]) ?? 'not installed']);
    }
  }
  return rows;
}

/** The one row shown when `GET /api/gateway/about` fails. */
export function gatewayAboutFailureRow(error: unknown): AboutExtraRow {
  const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : null;
  const raw = (error as { message?: unknown })?.message;
  const message = typeof raw === 'string' ? raw : String(error ?? 'unknown error');
  // GatewayHttpError messages already start with "HTTP <status>".
  const detail = status !== null && !message.startsWith(`HTTP ${status}`) ? `HTTP ${status}: ${message}` : message;
  return ['Gateway', `unavailable (${detail || 'request failed'})`];
}

/** Fetches the gateway versions; never throws (failures become the failure row). */
export async function fetchGatewayAboutRows(
  fetcher: (path: string) => Promise<GatewayAboutResponse> = (path) => gatewayJson<GatewayAboutResponse>(path, { timeoutMs: 10_000 })
): Promise<AboutExtraRow[]> {
  try {
    return gatewayAboutRows(await fetcher(GATEWAY_ABOUT_PATH));
  } catch (error) {
    return [gatewayAboutFailureRow(error)];
  }
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
    setExtraRows([['Gateway', 'loading…']]);
    void fetchRows().then((rows) => {
      if (seq === requestSeq.current) setExtraRows(rows);
    });
  }, [fetchRows]);
  return useMemo(() => ({ identity: ABSTRACTFLOW_IDENTITY, extraRows, onOpen }), [extraRows, onOpen]);
}
