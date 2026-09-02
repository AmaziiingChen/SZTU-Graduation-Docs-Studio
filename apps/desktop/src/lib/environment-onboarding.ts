export const ENVIRONMENT_ONBOARDING_VERSION = "2026-09-01"

const ENVIRONMENT_ONBOARDING_STORAGE_KEY =
  "sztu-docs.environment-onboarding-version"

type EnvironmentOnboardingStorage = Pick<Storage, "getItem" | "setItem">

function browserStorage(): EnvironmentOnboardingStorage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function environmentOnboardingIsComplete(
  storage: EnvironmentOnboardingStorage | undefined = browserStorage(),
): boolean {
  return (
    storage?.getItem(ENVIRONMENT_ONBOARDING_STORAGE_KEY) ===
    ENVIRONMENT_ONBOARDING_VERSION
  )
}

export function completeEnvironmentOnboarding(
  storage: EnvironmentOnboardingStorage | undefined = browserStorage(),
): void {
  storage?.setItem(
    ENVIRONMENT_ONBOARDING_STORAGE_KEY,
    ENVIRONMENT_ONBOARDING_VERSION,
  )
}
