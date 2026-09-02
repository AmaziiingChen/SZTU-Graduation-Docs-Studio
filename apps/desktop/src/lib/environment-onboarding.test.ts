import { describe, expect, it, vi } from "vitest"

import {
  completeEnvironmentOnboarding,
  ENVIRONMENT_ONBOARDING_VERSION,
  environmentOnboardingIsComplete,
} from "./environment-onboarding"

describe("environment onboarding persistence", () => {
  it("stores and recognizes only the current onboarding version", () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    }

    expect(environmentOnboardingIsComplete(storage)).toBe(false)
    completeEnvironmentOnboarding(storage)
    expect(environmentOnboardingIsComplete(storage)).toBe(true)
    expect(storage.setItem).toHaveBeenCalledWith(
      "sztu-docs.environment-onboarding-version",
      ENVIRONMENT_ONBOARDING_VERSION,
    )
  })
})
