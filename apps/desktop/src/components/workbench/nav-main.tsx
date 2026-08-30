import { UserRoundIcon } from "lucide-react"

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
              isActive={profileActive}
              disabled={disabled}
              onClick={onSelectProfile}
            >
              <UserRoundIcon />
              <span>学生档案</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
