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
              tooltip="学生档案"
              className="pl-8"
              isActive={profileActive}
              disabled={disabled}
              onClick={onSelectProfile}
            >
              <AnimatedActionIcon icon={IdCardIcon} />
              <span>学生档案</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
