import type { ReactNode } from "react"

import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

export function SiteHeader({
  title,
  status,
  actions,
  showSidebarTrigger = true,
}: {
  title: string
  status?: ReactNode
  actions?: ReactNode
  showSidebarTrigger?: boolean
}) {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear motion-reduce:transition-none group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex min-w-0 flex-1 items-center gap-1 px-4 lg:gap-2 lg:px-6">
        {showSidebarTrigger ? <>
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mx-2 h-4 data-vertical:self-auto"
          />
        </> : null}
        <h1 className="truncate text-base font-medium">{title}</h1>
        {status}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2 px-4 lg:px-6">{actions}</div>
      ) : null}
    </header>
  )
}
