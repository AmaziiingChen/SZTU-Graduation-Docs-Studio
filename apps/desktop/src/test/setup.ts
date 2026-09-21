import "@testing-library/jest-dom/vitest"

import { vi } from "vitest"

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub

// jsdom has no viewport observer; Animate UI registers one even when
// animateOnView is off. Tests exercise explicit hover/focus triggers instead.
class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = "0px"
  readonly thresholds = [0]
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return [] }
}
globalThis.IntersectionObserver = IntersectionObserverStub

Object.defineProperty(Element.prototype, "getAnimations", {
  configurable: true,
  value: () => [],
})

const emptyDomRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON: () => ({}),
} as DOMRect

Object.defineProperty(Range.prototype, "getBoundingClientRect", {
  configurable: true,
  value: () => emptyDomRect,
})

Object.defineProperty(Range.prototype, "getClientRects", {
  configurable: true,
  value: () => ({
    item: () => null,
    length: 0,
    [Symbol.iterator]: function* () {},
  }),
})

// jsdom does not run CSS transitions. Use Base UI's supported test switch
// so popup completion and focus restoration do not wait for browser animations.
Object.assign(globalThis, { BASE_UI_ANIMATIONS_DISABLED: true })
