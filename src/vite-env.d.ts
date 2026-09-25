/// <reference types="vite/client" />

import type React from "react";

declare module "*.txt?raw" {
  const content: string;
  export default content;
}

declare global {
  /** package.json version, injected by the `define` in vite.config.ts (build, dev and vitest). */
  const __APP_VERSION__: string;

  interface ImportMetaEnv {
    readonly VITE_MONITOR_GPU?: string;
    readonly VITE_MONITOR_MEMORY?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    __ABSTRACT_UI_CONFIG__?: {
      monitor_gpu?: boolean;
      monitor_memory?: boolean;
    };
  }

  namespace JSX {
    interface IntrinsicElements {
      "monitor-gpu": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        mode?: string;
        "base-url"?: string;
        "tick-ms"?: string;
        "history-size"?: string;
        endpoint?: string;
      };
      "monitor-memory": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        mode?: string;
        "base-url"?: string;
        "tick-ms"?: string;
        endpoint?: string;
      };
    }
  }
}

export {};
