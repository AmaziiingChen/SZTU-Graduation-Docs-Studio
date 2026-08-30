import {
  ClipboardCheckIcon,
  FilePenLineIcon,
  FileTextIcon,
  GraduationCapIcon,
} from "lucide-react"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import type { DocumentType } from "@/types/desktop-api"

const items: Array<{
  type?: DocumentType
  label: string
  icon: typeof FilePenLineIcon
  badge: string
  disabled?: boolean
}> = [
  { type: "proposal", label: "开题报告", icon: FilePenLineIcon, badge: "可用" },
  { label: "任务书", icon: FileTextIcon, badge: "待接入", disabled: true },
  { type: "midterm", label: "中期检查", icon: ClipboardCheckIcon, badge: "可用" },
  { label: "毕业论文", icon: GraduationCapIcon, badge: "待接入", disabled: true },
]

export function NavDocuments({
  profileActive,
  activeDocumentType,
  disabled,
  onSelectDocumentType,
}: {
  profileActive: boolean
  activeDocumentType: DocumentType
  disabled: boolean
  onSelectDocumentType: (documentType: DocumentType) => void
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>毕业设计文档</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.label}>
            <SidebarMenuButton
              tooltip={item.disabled ? `${item.label}尚未开放` : item.label}
              isActive={!profileActive && item.type === activeDocumentType}
              disabled={item.disabled || disabled}
              onClick={() => {
                if (item.type) onSelectDocumentType(item.type)
              }}
            >
              <item.icon />
              <span>{item.label}</span>
            </SidebarMenuButton>
            <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
