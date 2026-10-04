// The About action of the top-bar cluster: the AbstractFlow identity (with the
// build-time app version) plus the framework and gateway versions the
// connected gateway reports (ui-kit 0.7.0 compact About card).
//
// Every AfTopBarActions instance takes `about={useAboutAction()}` so all call
// sites show the same dialog. The versions come from the public
// `GET /api/gateway/about` route and are fetched when the dialog opens (not at
// page load). Only the framework and gateway versions are shown — never a
// package list. A failed request is shown as "unavailable (...)" in place of
// the gateway version; it is never hidden.
import { useCallback, useMemo, useRef, useState } from 'react';
import { aboutVersionsFromGateway, appIdentity, type AfAboutVersions, type AppIdentity, type GatewayAboutPayload } from '@abstractframework/ui-kit';
import { gatewayJson, gatewayPath } from '../utils/gatewayClient';

/** `package.json` version, injected at build time (vite.config.ts `define`). */
export const APP_VERSION: string = __APP_VERSION__;

/** Throws at module load if the kit's descriptor does not know "abstractflow". */
export const ABSTRACTFLOW_IDENTITY: AppIdentity = appIdentity('abstractflow', APP_VERSION);

export const GATEWAY_ABOUT_PATH = gatewayPath('about');

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

/** Versions shown while `GET /api/gateway/about` is in flight. */
export const ABOUT_VERSIONS_LOADING: AfAboutVersions = { framework: null, gateway: null, gatewayNote: 'checking…' };

/**
 * Fetches the gateway's About and keeps only the framework and gateway
 * versions (kit `aboutVersionsFromGateway`, the same in every app). Never
 * throws: a failure becomes `gatewayNote: "unavailable (...)"`.
 */
export async function fetchGatewayAboutVersions(
  fetcher: (path: string) => Promise<GatewayAboutPayload> = (path) => gatewayJson<GatewayAboutPayload>(path, { timeoutMs: 10_000 })
): Promise<AfAboutVersions> {
  let payload: GatewayAboutPayload;
  try {
    payload = await fetcher(GATEWAY_ABOUT_PATH);
  } catch (error) {
    return aboutVersionsFromGateway(null, gatewayAboutErrorReason(error));
  }
  return aboutVersionsFromGateway(payload);
}

export interface AboutAction {
  identity: AppIdentity;
  versions: AfAboutVersions;
  onOpen: () => void;
}

/** `about` prop for AfTopBarActions; refetches the gateway versions on every open. */
export function useAboutAction(
  fetchVersions: () => Promise<AfAboutVersions> = fetchGatewayAboutVersions
): AboutAction {
  const [versions, setVersions] = useState<AfAboutVersions>(ABOUT_VERSIONS_LOADING);
  const requestSeq = useRef(0);
  const onOpen = useCallback(() => {
    const seq = ++requestSeq.current;
    setVersions(ABOUT_VERSIONS_LOADING);
    void fetchVersions().then((next) => {
      if (seq === requestSeq.current) setVersions(next);
    });
  }, [fetchVersions]);
  return useMemo(() => ({ identity: ABSTRACTFLOW_IDENTITY, versions, onOpen }), [versions, onOpen]);
}
