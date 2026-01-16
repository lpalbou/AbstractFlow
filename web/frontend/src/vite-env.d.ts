/// <reference types="vite/client" />

import type React from "react";

declare global {
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
