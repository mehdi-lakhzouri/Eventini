import { vi } from "vitest";

/**
 * jsdom does not implement `window.matchMedia`, so any unit touching it throws
 * `TypeError: window.matchMedia is not a function` before its own logic runs.
 *
 * This installs a controllable stub and returns a handle to drive it, so a test
 * can change the viewport and fire the corresponding `change` event the way a
 * real browser would.
 */
export interface MatchMediaStub {
  /** Resize the viewport and notify every registered listener. */
  setWidth(width: number): void;
  /** Restore the previous `window.matchMedia`. */
  restore(): void;
}

export function stubMatchMedia(initialWidth: number): MatchMediaStub {
  const listeners = new Set<() => void>();
  const original = window.matchMedia as typeof window.matchMedia | undefined;

  const applyWidth = (width: number): void => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: width,
    });
  };

  applyWidth(initialWidth);

  const matchMedia = vi.fn((query: string): MediaQueryList => {
    const maxWidth = /max-width:\s*(\d+)px/.exec(query)?.[1];

    return {
      media: query,
      get matches() {
        return maxWidth === undefined
          ? false
          : window.innerWidth <= Number(maxWidth);
      },
      onchange: null,
      addEventListener: (_event: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_event: string, listener: () => void) => {
        listeners.delete(listener);
      },
      // Deprecated API kept because some libraries still call it.
      addListener: (listener: () => void) => listeners.add(listener),
      removeListener: (listener: () => void) => listeners.delete(listener),
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  });

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: matchMedia,
  });

  return {
    setWidth(width: number) {
      applyWidth(width);
      listeners.forEach((listener) => {
        listener();
      });
    },
    restore() {
      listeners.clear();
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: original,
      });
    },
  };
}
