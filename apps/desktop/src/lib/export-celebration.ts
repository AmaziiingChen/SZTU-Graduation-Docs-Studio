import confetti from "canvas-confetti"

let fire: ReturnType<typeof confetti.create> | undefined

// User-approved export celebration. It never blocks export or intercepts input.
export function celebrateExportSuccess() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
  try {
    // The desktop CSP forbids blob workers. The library default transfers the
    // canvas to a blocked worker, leaving an empty canvas without throwing.
    fire ??= confetti.create(undefined, { useWorker: false, resize: true })
    void fire({
      particleCount: 110,
      spread: 100,
      startVelocity: 42,
      ticks: 150,
      origin: { x: 0.5, y: 0.65 },
      disableForReducedMotion: true,
      zIndex: 100,
    })?.catch(() => undefined)
  } catch {
    // An unavailable canvas must not turn a successful export into a failure.
  }
}
