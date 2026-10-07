// Matches the saved profile field limit; the selector catalog is not a filter.
export const ACADEMIC_NAME_MAX_LENGTH = 200

function academicName(value: unknown): string {
  if (typeof value !== "string") return "unknown"
  return value.trim().slice(0, ACADEMIC_NAME_MAX_LENGTH) || "unknown"
}

export function academicTelemetry(value: unknown): { college: string; major: string } {
  const profile = value && typeof value === "object" ? value as Record<string, unknown> : {}
  return { college: academicName(profile.college), major: academicName(profile.major) }
}
