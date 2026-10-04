import type { ReactNode } from "react"
import { CircleCheckIcon } from "@/components/ui/circle-check"
import { AnimatedActionIcon } from "@/components/animated-action-icon"

export function ActionFeedbackIcon({ token, children }: { token?: number; children: ReactNode }) {
  return token ? (
    <span data-slot="action-success" aria-hidden="true" className="inline-flex size-4 shrink-0">
      <AnimatedActionIcon key={token} icon={CircleCheckIcon} playOnMount />
    </span>
  ) : children
}
