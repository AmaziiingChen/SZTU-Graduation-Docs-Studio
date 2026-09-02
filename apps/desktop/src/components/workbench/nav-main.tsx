import { LibraryBigIcon, UserRoundIcon } from "lucide-react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavMain({
  profileActive,
  toolsActive,
  disabled,
  onSelectProfile,
  onSelectTools,
}: {
  profileActive: boolean
  toolsActive: boolean
  disabled: boolean
  onSelectProfile: () => void
  onSelectTools: () => void
}) {
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="学生档案"
              isActive={profileActive}
              disabled={disabled}
              onClick={onSelectProfile}
            >
              <UserRoundIcon />
              <span>学生档案</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="工具箱"
              isActive={toolsActive}
              disabled={disabled}
              onClick={onSelectTools}
            >
              <LibraryBigIcon />
              <span>工具箱</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
