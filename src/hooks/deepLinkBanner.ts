import { create } from 'zustand';

/**
 * The one-line notice above the canvas after a `?bundle=` deep link opened
 * (utils/bundleDeepLink.ts): a shipped workflow says it is a read-only copy.
 * Cleared when another document is loaded.
 */
interface DeepLinkBannerState {
  text: string | null;
  show: (text: string) => void;
  clear: () => void;
}

export const useDeepLinkBanner = create<DeepLinkBannerState>((set) => ({
  text: null,
  show: (text) => set({ text }),
  clear: () => set({ text: null }),
}));
