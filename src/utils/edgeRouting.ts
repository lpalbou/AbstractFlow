/**
 * Orthogonal edge routing for the workflow canvas.
 *
 * Back edges, self-loops and obstructed routes are computed with a sparse
 * orthogonal A* search instead of fixed "above/below all nodes" lanes.
 * The search grid is built from the padded boundaries of every nearby node
 * rect — including the source and target nodes themselves, so a route can
 * never cut through the nodes it connects — plus the route endpoints.
 * Cost combines path length with a bend penalty so the chosen route is both
 * short and visually calm (few turns).
 */

export type RoutePoint = { x: number; y: number };
export type RouteRect = { x: number; y: number; width: number; height: number };

const EPSILON = 0.01;

export function compactPoints(points: RoutePoint[]): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - p.x) < 0.5 && Math.abs(prev.y - p.y) < 0.5) continue;
    out.push(p);
  }
  return out;
}

/** Drop intermediate points that lie on a straight segment. */
function simplifyCollinear(points: RoutePoint[]): RoutePoint[] {
  const compacted = compactPoints(points);
  if (compacted.length <= 2) return compacted;
  const out: RoutePoint[] = [compacted[0]];
  for (let i = 1; i < compacted.length - 1; i += 1) {
    const prev = out[out.length - 1];
    const curr = compacted[i];
    const next = compacted[i + 1];
    const sameX = Math.abs(prev.x - curr.x) < EPSILON && Math.abs(curr.x - next.x) < EPSILON;
    const sameY = Math.abs(prev.y - curr.y) < EPSILON && Math.abs(curr.y - next.y) < EPSILON;
    if (sameX || sameY) continue;
    out.push(curr);
  }
  out.push(compacted[compacted.length - 1]);
  return out;
}

export function roundedPolylinePath(pointsIn: RoutePoint[], radius = 18): string {
  const points = compactPoints(pointsIn);
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
  let path = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const inDx = curr.x - prev.x;
    const inDy = curr.y - prev.y;
    const outDx = next.x - curr.x;
    const outDy = next.y - curr.y;
    const inLen = Math.hypot(inDx, inDy);
    const outLen = Math.hypot(outDx, outDy);
    if (inLen < 1 || outLen < 1) {
      path += ` L ${curr.x},${curr.y}`;
      continue;
    }
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const before = { x: curr.x - (inDx / inLen) * r, y: curr.y - (inDy / inLen) * r };
    const after = { x: curr.x + (outDx / outLen) * r, y: curr.y + (outDy / outLen) * r };
    path += ` L ${before.x},${before.y} Q ${curr.x},${curr.y} ${after.x},${after.y}`;
  }
  const last = points[points.length - 1];
  path += ` L ${last.x},${last.y}`;
  return path;
}

type PaddedRect = { left: number; right: number; top: number; bottom: number };

function containsPoint(rect: PaddedRect, p: RoutePoint): boolean {
  return p.x > rect.left + EPSILON && p.x < rect.right - EPSILON && p.y > rect.top + EPSILON && p.y < rect.bottom - EPSILON;
}

/**
 * An axis-aligned segment is blocked when it crosses a rect *interior*.
 * Strict comparisons let routes slide exactly along padded rect boundaries,
 * which is where most grid coordinates live.
 */
function segmentBlocked(a: RoutePoint, b: RoutePoint, rects: PaddedRect[]): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  for (const rect of rects) {
    if (maxX > rect.left + EPSILON && minX < rect.right - EPSILON && maxY > rect.top + EPSILON && minY < rect.bottom - EPSILON) {
      return true;
    }
  }
  return false;
}

function uniqueSorted(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || v - out[out.length - 1] > EPSILON) out.push(v);
  }
  return out;
}

/** Minimal binary min-heap keyed on `priority`; the routing graphs are tiny. */
class MinHeap {
  private items: Array<{ id: number; priority: number }> = [];

  get size(): number {
    return this.items.length;
  }

  push(id: number, priority: number): void {
    const items = this.items;
    items.push({ id, priority });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].priority <= items[i].priority) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): { id: number; priority: number } | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < items.length && items[l].priority < items[smallest].priority) smallest = l;
        if (r < items.length && items[r].priority < items[smallest].priority) smallest = r;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

export interface OrthogonalRouteOptions {
  /** Source pin position; the route exits horizontally towards +x. */
  source: RoutePoint;
  /** Target pin position; the route enters horizontally from -x. */
  target: RoutePoint;
  /** Node rects to avoid (other nodes; pin-owning nodes go in source/targetRect). */
  obstacles: RouteRect[];
  /**
   * Node that owns the source pin. Pin handles are anchored *inside* the node
   * body (the visible pin shape is inset from the border), so the exit stub
   * must be projected past this rect's padded boundary — a fixed offset from
   * the pin would land inside the node and break obstacle avoidance.
   */
  sourceRect?: RouteRect | null;
  /** Node that owns the target pin (see sourceRect). */
  targetRect?: RouteRect | null;
  /** Clearance kept around obstacles (px). */
  padding?: number;
  /** Extra cost per 90° turn; higher values give calmer routes. */
  bendPenalty?: number;
  /**
   * Segments fully at/below this y cost 40% extra. Used so exec loop-back
   * edges keep their "route above the nodes" convention when both lanes are
   * otherwise equivalent.
   */
  penalizeBelowY?: number;
}

const HORIZONTAL = 0;
const VERTICAL = 1;

/**
 * Shortest orthogonal route between two pins avoiding all obstacle rects.
 *
 * Clearance ladder: the route is first attempted with the requested padding;
 * in dense layouts (narrow channels between nodes, stub pockets blocked by an
 * adjacent node) the padding is tightened stepwise. Only at the tightest step
 * may a rect that physically seals a pin pocket (e.g. two nodes glued
 * together) be dropped — the unavoidable graze beats a long detour.
 *
 * Returns the polyline (pin to pin) or null when no clear route exists.
 */
export function routeOrthogonal({
  source,
  target,
  obstacles,
  sourceRect,
  targetRect,
  padding = 24,
  bendPenalty = 56,
  penalizeBelowY,
}: OrthogonalRouteOptions): RoutePoint[] | null {
  // The final 1px rung lets routes squeeze through near-zero seams between
  // glued nodes (riding the shared border) before any obstacle is dropped.
  const ladder = [padding, 16, 8, 1].filter((p, i, arr) => p >= 1 && arr.indexOf(p) === i && p <= padding);
  for (let i = 0; i < ladder.length; i += 1) {
    const routed = attemptRoute({
      source,
      target,
      obstacles,
      sourceRect: sourceRect ?? null,
      targetRect: targetRect ?? null,
      padding: ladder[i],
      bendPenalty,
      penalizeBelowY,
      allowDroppingTrappingRects: i === ladder.length - 1,
    });
    if (routed) return routed;
  }
  return null;
}

interface RouteAttempt {
  source: RoutePoint;
  target: RoutePoint;
  obstacles: RouteRect[];
  sourceRect: RouteRect | null;
  targetRect: RouteRect | null;
  padding: number;
  bendPenalty: number;
  penalizeBelowY?: number;
  allowDroppingTrappingRects: boolean;
}

function attemptRoute({
  source,
  target,
  obstacles,
  sourceRect,
  targetRect,
  padding,
  bendPenalty,
  penalizeBelowY,
  allowDroppingTrappingRects,
}: RouteAttempt): RoutePoint[] | null {
  // Stubs sit exactly on the padded boundary of the pin's own node (handles
  // are anchored inset inside the node body, so a fixed offset from the pin
  // would land inside the node). Boundary points are legal: containment and
  // segment blocking use strict interior checks, so routes may slide along
  // padded boundaries — which also centers them in tight channels.
  const start: RoutePoint = {
    x: Math.max(source.x + 4, sourceRect ? sourceRect.x + sourceRect.width + padding : source.x + padding + 8),
    y: source.y,
  };
  const end: RoutePoint = {
    x: Math.min(target.x - 4, targetRect ? targetRect.x - padding : target.x - padding - 8),
    y: target.y,
  };

  const ownRects: RouteRect[] = [];
  if (sourceRect) ownRects.push(sourceRect);
  if (targetRect && targetRect !== sourceRect) ownRects.push(targetRect);
  const allRects = [...ownRects, ...obstacles].map((r) => ({
    left: r.x - padding,
    right: r.x + r.width + padding,
    top: r.y - padding,
    bottom: r.y + r.height + padding,
  }));
  // A stub trapped inside another node's padded area means this clearance
  // level cannot represent the pin pocket; retry tighter, or — as the very
  // last resort — drop the trapping rect (nodes glued to the pin's node).
  const trapping = allRects.filter((r) => containsPoint(r, start) || containsPoint(r, end));
  if (trapping.length > 0 && !allowDroppingTrappingRects) return null;
  const rects = trapping.length > 0 ? allRects.filter((r) => !trapping.includes(r)) : allRects;

  // Sparse routing grid: padded rect boundaries + endpoints + midpoints
  // (midpoints let routes center themselves in the channel between nodes).
  const xs: number[] = [start.x, end.x, (start.x + end.x) / 2];
  const ys: number[] = [start.y, end.y, (start.y + end.y) / 2];
  for (const r of rects) {
    xs.push(r.left, r.right);
    ys.push(r.top, r.bottom);
  }
  const gridX = uniqueSorted(xs);
  const gridY = uniqueSorted(ys);
  const cols = gridX.length;
  const rows = gridY.length;
  const indexOf = (values: number[], v: number): number => {
    for (let i = 0; i < values.length; i += 1) {
      if (Math.abs(values[i] - v) <= EPSILON) return i;
    }
    return -1;
  };
  const startXi = indexOf(gridX, start.x);
  const startYi = indexOf(gridY, start.y);
  const endXi = indexOf(gridX, end.x);
  const endYi = indexOf(gridY, end.y);
  if (startXi < 0 || startYi < 0 || endXi < 0 || endYi < 0) return null;

  // A* over (grid cell, arrival orientation) so turns can be priced.
  const stateId = (xi: number, yi: number, orient: number): number => (yi * cols + xi) * 2 + orient;
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const heuristic = (xi: number, yi: number): number => Math.abs(gridX[xi] - gridX[endXi]) + Math.abs(gridY[yi] - gridY[endYi]);
  const heap = new MinHeap();
  // The pin stub is horizontal, so the search starts with horizontal arrival.
  const startId = stateId(startXi, startYi, HORIZONTAL);
  gScore.set(startId, 0);
  heap.push(startId, heuristic(startXi, startYi));

  let goalId = -1;
  while (heap.size > 0) {
    const current = heap.pop()!;
    const id = current.id;
    const orient = id % 2;
    const cell = (id - orient) / 2;
    const xi = cell % cols;
    const yi = (cell - xi) / cols;
    const g = gScore.get(id);
    if (g === undefined || current.priority - heuristic(xi, yi) > g + EPSILON) continue; // stale heap entry
    if (xi === endXi && yi === endYi) {
      goalId = id;
      break;
    }
    const from = { x: gridX[xi], y: gridY[yi] };
    const neighbors: Array<{ xi: number; yi: number; orient: number }> = [
      { xi: xi - 1, yi, orient: HORIZONTAL },
      { xi: xi + 1, yi, orient: HORIZONTAL },
      { xi, yi: yi - 1, orient: VERTICAL },
      { xi, yi: yi + 1, orient: VERTICAL },
    ];
    for (const n of neighbors) {
      if (n.xi < 0 || n.xi >= cols || n.yi < 0 || n.yi >= rows) continue;
      const to = { x: gridX[n.xi], y: gridY[n.yi] };
      if (segmentBlocked(from, to, rects)) continue;
      const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
      const belowWeight = penalizeBelowY !== undefined && Math.min(from.y, to.y) >= penalizeBelowY - EPSILON ? 1.4 : 1;
      let cost = length * belowWeight;
      if (n.orient !== orient) cost += bendPenalty;
      // Entering the goal vertically implies one more turn into the
      // horizontal pin stub; price it so straight arrivals win ties.
      if (n.xi === endXi && n.yi === endYi && n.orient === VERTICAL) cost += bendPenalty;
      const nextId = stateId(n.xi, n.yi, n.orient);
      const tentative = g + cost;
      const known = gScore.get(nextId);
      if (known !== undefined && known <= tentative + EPSILON) continue;
      gScore.set(nextId, tentative);
      cameFrom.set(nextId, id);
      heap.push(nextId, tentative + heuristic(n.xi, n.yi));
    }
  }

  if (goalId < 0) return null;

  const reversed: RoutePoint[] = [];
  let cursor: number | undefined = goalId;
  while (cursor !== undefined) {
    const orient = cursor % 2;
    const cell = (cursor - orient) / 2;
    const xi = cell % cols;
    const yi = (cell - xi) / cols;
    reversed.push({ x: gridX[xi], y: gridY[yi] });
    cursor = cameFrom.get(cursor);
  }
  reversed.reverse();
  return simplifyCollinear([source, ...reversed, target]);
}
