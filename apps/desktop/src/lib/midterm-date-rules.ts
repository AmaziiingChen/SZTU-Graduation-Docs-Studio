import type { MidtermDateRule } from "@/types/desktop-api"

export function midtermDateRuleForCollege(
  rules: MidtermDateRule[],
  college: string,
): MidtermDateRule | undefined {
  const normalizedCollege = college.trim().normalize("NFC")
  return rules.find((rule) => rule.college === normalizedCollege)
}

export function midtermDateIsAllowed(value: string, rule?: MidtermDateRule): boolean {
  return !rule || (value >= rule.startDate && value <= rule.endDate)
}
