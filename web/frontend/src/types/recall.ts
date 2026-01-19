export const RECALL_LEVEL_OPTIONS = ['urgent', 'standard', 'deep'] as const;
export type RecallLevel = (typeof RECALL_LEVEL_OPTIONS)[number];

