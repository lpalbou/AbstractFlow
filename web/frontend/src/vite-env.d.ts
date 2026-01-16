/// <reference types="vite/client" />

import type React from "react";

declare global {
  interface ImportMetaEnv {
    readonly VITE_MONITOR_GPU?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    __ABSTRACT_UI_CONFIG__?: {
      monitor_gpu?: boolean;
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
    }
  }
}

export {};
