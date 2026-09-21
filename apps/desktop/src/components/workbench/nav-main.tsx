import { IdCardIcon } from "@/components/ui/id-card"
import { useSidebarIconAnimation } from "@/hooks/use-sidebar-icon-animation"

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
  const animation = useSidebarIconAnimation()
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              {...animation.row("profile", disabled)}
              tooltip="学生档案"
              className="pl-8"
              isActive={profileActive}
              disabled={disabled}
              onClick={onSelectProfile}
            >
              <IdCardIcon {...animation.icon("profile")} />
              <span>学生档案</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
