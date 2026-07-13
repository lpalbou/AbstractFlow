import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Follow-live autoscroll shared by the conversation and the activity log.
 *
 * Contract: the view sticks to the bottom only while the user is already at
 * (or within FOLLOW_THRESHOLD_PX of) the bottom. Scrolling up disarms
 * following — new content must never yank the view away from what the user
 * is reading. A small "Follow ↓" pill re-arms it. The decision logic is pure
 * (testable without a DOM); the hook only wires it to a scroll container.
 */

export const FOLLOW_THRESHOLD_PX = 24;

export interface ScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/** Distance from the viewport bottom to the content bottom, clamped at 0. */
export function distanceFromBottom(metrics: ScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight);
}

/** True when the viewport is close enough to the bottom to keep following. */
export function isNearBottom(metrics: ScrollMetrics, thresholdPx = FOLLOW_THRESHOLD_PX): boolean {
  return distanceFromBottom(metrics) <= thresholdPx;
}

/**
 * Next following state after a user scroll: within the threshold re-arms,
 * anything farther disarms. (Content growth while following does not pass
 * through here — the hook re-pins to the bottom before the user sees it.)
 */
export function nextFollowingState(metrics: ScrollMetrics, thresholdPx = FOLLOW_THRESHOLD_PX): boolean {
  return isNearBottom(metrics, thresholdPx);
}

export interface FollowLive {
  containerRef: RefObject<HTMLDivElement>;
  following: boolean;
  onScroll: () => void;
  /** Re-arm following and jump to the bottom (the "Follow ↓" pill action). */
  follow: () => void;
}

/**
 * @param contentKey change signal for "new content arrived" (e.g. item count);
 * the hook re-pins to the bottom on change only while following.
 */
export function useFollowLive(contentKey: unknown): FollowLive {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);

  const setFollowingBoth = useCallback((value: boolean) => {
    followingRef.current = value;
    setFollowing(value);
  }, []);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setFollowingBoth(
      nextFollowingState({ scrollTop: el.scrollTop, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight })
    );
  }, [setFollowingBoth]);

  const follow = useCallback(() => {
    const el = containerRef.current;
    setFollowingBoth(true);
    if (el) el.scrollTop = el.scrollHeight;
  }, [setFollowingBoth]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !followingRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [contentKey]);

  return { containerRef: containerRef as RefObject<HTMLDivElement>, following, onScroll, follow };
}
