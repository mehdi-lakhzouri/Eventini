import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { stubMatchMedia, type MatchMediaStub } from "@/test/match-media";
import { useIsMobile } from "./use-mobile";

/**
 * Exercises the jsdom + React Testing Library path end to end, on a unit that
 * genuinely needs a DOM. If the test tooling is misconfigured, this fails
 * before any assertion runs.
 *
 * Breakpoint under test: 768px. Below it is mobile, at or above it is not.
 */
describe("useIsMobile", () => {
  let media: MatchMediaStub;

  afterEach(() => {
    media?.restore();
  });

  it("reports mobile below the 768px breakpoint", () => {
    media = stubMatchMedia(375);

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(true);
  });

  it("reports desktop at the breakpoint exactly", () => {
    // 768 is desktop: the comparison is `< 768`, not `<=`.
    media = stubMatchMedia(768);

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(false);
  });

  it("reacts to a viewport change after mount", () => {
    media = stubMatchMedia(1280);

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      media.setWidth(375);
    });

    expect(result.current).toBe(true);
  });

  it("removes its listener on unmount", () => {
    media = stubMatchMedia(1280);

    const { result, unmount } = renderHook(() => useIsMobile());
    unmount();

    // Resizing after unmount must not attempt a state update on an unmounted
    // component; React would warn and the value must stay frozen.
    act(() => {
      media.setWidth(375);
    });

    expect(result.current).toBe(false);
  });
});
