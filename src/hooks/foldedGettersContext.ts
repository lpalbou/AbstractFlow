import { createContext, useContext } from 'react';
import type { FoldedGetters, FoldedRead } from '../utils/foldedGetters';

/**
 * Canvas → BaseNode channel for the render-fold (0156 Stage 1).
 *
 * BaseNode needs, per input pin, "is this pin fed by a folded getter, and by
 * which variable" to draw the read pill on the pin row. Passing it through
 * node `data` would churn every node object on every graph change; a context
 * keeps the projection in one place (Canvas) and the consumers cheap.
 */
const EMPTY: FoldedGetters = {
  byGetter: new Map(),
  byConsumerPin: new Map(),
  edgeIds: new Set(),
};

export const FoldedGettersContext = createContext<FoldedGetters>(EMPTY);

export function useFoldedReadsForNode(nodeId: string): Map<string, FoldedRead> | undefined {
  return useContext(FoldedGettersContext).byConsumerPin.get(nodeId);
}
