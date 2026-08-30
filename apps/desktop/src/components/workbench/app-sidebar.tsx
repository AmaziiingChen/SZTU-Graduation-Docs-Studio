import type * as React from "react"
import { BookOpenIcon, ShieldCheckIcon } from "lucide-react"

import { NavDocuments } from "@/components/workbench/nav-documents"
import { NavMain } from "@/components/workbench/nav-main"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import type { DocumentType } from "@/types/desktop-api"

export function AppSidebar({
  profileActive,
  activeDocumentType,
  onSelectProfile,
  onSelectDocumentType,
  disabled,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  profileActive: boolean
  activeDocumentType: DocumentType
  onSelectProfile: () => void
  onSelectDocumentType: (documentType: DocumentType) => void
  disabled: boolean
}) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              tooltip="毕业设计文档工作台"
            >
              <BookOpenIcon className="size-5!" />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate text-base font-semibold">SZTU 文档工作台</span>
                <span className="truncate text-xs text-muted-foreground">
                  本地毕业设计文档工具
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          profileActive={profileActive}
          disabled={disabled}
          onSelectProfile={onSelectProfile}
        />
        <NavDocuments
          profileActive={profileActive}
          activeDocumentType={activeDocumentType}
          disabled={disabled}
          onSelectDocumentType={onSelectDocumentType}
        />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="数据默认仅保存在本机" disabled>
              <ShieldCheckIcon />
              <span>数据默认仅保存在本机</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
