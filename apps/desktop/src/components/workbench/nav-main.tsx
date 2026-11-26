import { AnimatedActionIcon } from "@/components/animated-action-icon"
import { IdCardIcon } from "@/components/ui/id-card"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavMain({
  profileActive,
  disabled,
  onSelectProfile,
}: {
  profileActive: boolean
  disabled: boolean
  onSelectProfile: () => void
}) {
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              data-tour="nav-profile"
              tooltip="基本信息"
              aria-label="基本信息"
              className="pl-8"
              isActive={profileActive}
              disabled={disabled}
              onClick={onSelectProfile}
            >
              <AnimatedActionIcon icon={IdCardIcon} />
              <span>基本信息</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
