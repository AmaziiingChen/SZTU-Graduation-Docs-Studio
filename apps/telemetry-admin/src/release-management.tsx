import { useCallback, useEffect, useState } from "react"
import { KeyRoundIcon, LoaderCircleIcon, PackageCheckIcon, PlusIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

type ReleaseStatus = {
  keyReady: boolean
  publicKeyPem: string | null
  releaseDirectory: string
  manifestReady: boolean
  datePolicyReady: boolean
  dateRules: Array<{ college: string; start_date: string; end_date: string }>
}

type ApiResponse<T> =
  | { status: "ready"; data: T }
  | { status: "error"; message: string }

export function ReleaseManagement() {
  const [status, setStatus] = useState<ReleaseStatus | null>(null)
  const [busy, setBusy] = useState<"key" | "manifest" | "date-policy" | "publishing-date-policy" | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [version, setVersion] = useState("0.2.0")
  const [artifacts, setArtifacts] = useState<Array<{
    platform: "darwin" | "win32" | "linux"
    arch: "arm64" | "x64"
    filePath: string
    url: string
  }>>([
    { platform: "darwin", arch: "arm64", filePath: "", url: "" },
    { platform: "win32", arch: "x64", filePath: "", url: "" },
  ])
  const [updatePolicy, setUpdatePolicy] = useState<"optional" | "recommended" | "required">("recommended")
  const [minimumVersion, setMinimumVersion] = useState("0.1.0")
  const [serviceStatus, setServiceStatus] = useState<"normal" | "maintenance" | "retired">("normal")
  const [helpUrl, setHelpUrl] = useState("")
  const [announcementSeverity, setAnnouncementSeverity] = useState<"none" | "info" | "important" | "critical">("none")
  const [announcementTitle, setAnnouncementTitle] = useState("")
  const [announcementBody, setAnnouncementBody] = useState("")
  const [dateRules, setDateRules] = useState<ReleaseStatus["dateRules"]>([])

  const loadStatus = useCallback(async (hydrateRules = false) => {
    const response = await fetch("/api/release/status", { headers: { Accept: "application/json" } })
    const result = await response.json() as ApiResponse<ReleaseStatus>
    if (result.status === "ready") {
      setStatus(result.data)
      if (hydrateRules) setDateRules(result.data.dateRules)
    }
    else setMessage(result.message)
  }, [])

  useEffect(() => {
    void loadStatus(true)
  }, [loadStatus])

  const initializeKeys = async () => {
    setBusy("key")
    setMessage(null)
    try {
      const response = await fetch("/api/release/keys", { method: "POST" })
      const result = await response.json() as ApiResponse<ReleaseStatus>
      if (result.status === "error") throw new Error(result.message)
      setStatus(result.data)
      setMessage("发布密钥已生成。请单独加密备份私钥目录。")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "发布密钥初始化失败。")
    } finally {
      setBusy(null)
    }
  }

  const createManifest = async () => {
    setBusy("manifest")
    setMessage(null)
    const announcement = announcementSeverity === "none" ? null : {
      id: `release-${version.replaceAll(".", "")}`,
      title: announcementTitle,
      body: announcementBody,
      severity: announcementSeverity,
      starts_at: new Date().toISOString(),
      ends_at: null,
      dismissible: announcementSeverity !== "critical",
    }
    try {
      const response = await fetch("/api/release/manifest", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          version,
          artifacts: artifacts.filter((item) => item.filePath.trim() || item.url.trim()),
          control: {
            update_policy: updatePolicy,
            minimum_supported_version: minimumVersion || null,
            service_status: serviceStatus,
            help_url: helpUrl || null,
            announcement,
          },
        }),
      })
      const result = await response.json() as ApiResponse<{ manifestPath: string; version: string }>
      if (result.status === "error") throw new Error(result.message)
      setMessage(`版本 ${result.data.version} 的签名清单已生成：${result.data.manifestPath}`)
      await loadStatus()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "发布清单生成失败。")
    } finally {
      setBusy(null)
    }
  }

  const createDatePolicy = async () => {
    setBusy("date-policy")
    setMessage(null)
    try {
      const response = await fetch("/api/release/midterm-date-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(dateRules.map((rule) => ({
          college: rule.college.trim(),
          start_date: rule.start_date,
          end_date: rule.end_date,
        }))),
      })
      const result = await response.json() as ApiResponse<{ policyPath: string; ruleCount: number }>
      if (result.status === "error") throw new Error(result.message)
      setMessage(`已生成 ${result.data.ruleCount} 条学院日期规则：${result.data.policyPath}。上传至云端配置地址后生效。`)
      await loadStatus(true)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "日期规则生成失败。")
    } finally {
      setBusy(null)
    }
  }

  const publishDatePolicy = async () => {
    setBusy("publishing-date-policy")
    setMessage(null)
    try {
      const response = await fetch("/api/release/publish-midterm-date-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(dateRules.map((rule) => ({
          college: rule.college.trim(),
          start_date: rule.start_date,
          end_date: rule.end_date,
        }))),
      })
      const result = await response.json() as ApiResponse<{ cloudPath: string; ruleCount: number }>
      if (result.status === "error") throw new Error(result.message)
      setMessage(`已发布 ${result.data.ruleCount} 条学院日期规则到云端：${result.data.cloudPath}`)
      await loadStatus(true)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "日期规则云端发布失败。")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid w-full gap-4 p-4 lg:p-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>发布信任</CardTitle>
              <CardDescription>免费 Ed25519 签名；私钥只保存在这台发布电脑</CardDescription>
            </div>
            <Badge variant={status?.keyReady ? "secondary" : "outline"}>
              {status?.keyReady ? "已初始化" : "未初始化"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-xs text-muted-foreground">{status?.releaseDirectory ?? "正在读取安全目录…"}</p>
          <Button className="w-fit" disabled={busy !== null || status?.keyReady} onClick={() => void initializeKeys()}>
            {busy === "key" ? <LoaderCircleIcon className="animate-spin" /> : <KeyRoundIcon />}
            初始化发布密钥
          </Button>
          {status?.publicKeyPem ? (
            <Textarea aria-label="更新公钥" readOnly value={status.publicKeyPem} className="min-h-28 font-mono text-xs" />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>生成签名发布清单</CardTitle>
          <CardDescription>只发公告时可不填安装包；此页面生成清单但不会自动公开文件</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Input aria-label="版本号" value={version} onChange={(event) => setVersion(event.target.value)} placeholder="0.2.0" />
          <div className="grid gap-3">
            {artifacts.map((artifact, index) => (
              <div key={index} className="grid gap-3 rounded-lg border p-3 lg:grid-cols-[8rem_8rem_1fr_1fr_auto]">
                <Select value={artifact.platform} onValueChange={(value) => setArtifacts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, platform: value as typeof artifact.platform } : item))}>
                  <SelectTrigger aria-label={`安装包 ${index + 1} 平台`}><span>{artifact.platform === "darwin" ? "macOS" : artifact.platform === "win32" ? "Windows" : "Linux"}</span></SelectTrigger>
                  <SelectContent><SelectItem value="darwin">macOS</SelectItem><SelectItem value="win32">Windows</SelectItem><SelectItem value="linux">Linux</SelectItem></SelectContent>
                </Select>
                <Select value={artifact.arch} onValueChange={(value) => setArtifacts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, arch: value as typeof artifact.arch } : item))}>
                  <SelectTrigger aria-label={`安装包 ${index + 1} 架构`}><span>{artifact.arch}</span></SelectTrigger>
                  <SelectContent><SelectItem value="arm64">arm64</SelectItem><SelectItem value="x64">x64</SelectItem></SelectContent>
                </Select>
                <Input aria-label={`安装包 ${index + 1} 本机路径`} value={artifact.filePath} onChange={(event) => setArtifacts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, filePath: event.target.value } : item))} placeholder="本机绝对路径" />
                <Input aria-label={`安装包 ${index + 1} 下载地址`} value={artifact.url} onChange={(event) => setArtifacts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item))} placeholder="HTTPS 下载地址" />
                <Button variant="ghost" size="icon" aria-label={`删除安装包 ${index + 1}`} onClick={() => setArtifacts((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2Icon /></Button>
              </div>
            ))}
            <Button variant="outline" className="w-fit" disabled={artifacts.length >= 6} onClick={() => setArtifacts((current) => [...current, { platform: "darwin", arch: "arm64", filePath: "", url: "" }])}><PlusIcon />添加安装包</Button>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Select value={updatePolicy} onValueChange={(value) => setUpdatePolicy(value as typeof updatePolicy)}>
              <SelectTrigger aria-label="更新策略"><span>{updatePolicy === "optional" ? "可选更新" : updatePolicy === "recommended" ? "建议更新" : "必须更新"}</span></SelectTrigger>
              <SelectContent><SelectItem value="optional">可选更新</SelectItem><SelectItem value="recommended">建议更新</SelectItem><SelectItem value="required">必须更新</SelectItem></SelectContent>
            </Select>
            <Input aria-label="最低可用版本" value={minimumVersion} onChange={(event) => setMinimumVersion(event.target.value)} placeholder="最低可用版本，可留空" />
            <Select value={serviceStatus} onValueChange={(value) => setServiceStatus(value as typeof serviceStatus)}>
              <SelectTrigger aria-label="服务状态"><span>{serviceStatus === "normal" ? "正常" : serviceStatus === "maintenance" ? "维护" : "停止服务"}</span></SelectTrigger>
              <SelectContent><SelectItem value="normal">正常</SelectItem><SelectItem value="maintenance">维护</SelectItem><SelectItem value="retired">停止服务</SelectItem></SelectContent>
            </Select>
          </div>
          <Input aria-label="使用说明地址" value={helpUrl} onChange={(event) => setHelpUrl(event.target.value)} placeholder="使用说明 HTTPS 地址，可留空" />
          <div className="grid gap-3 md:grid-cols-[12rem_1fr]">
            <Select value={announcementSeverity} onValueChange={(value) => setAnnouncementSeverity(value as typeof announcementSeverity)}>
              <SelectTrigger aria-label="公告级别"><span>{announcementSeverity === "none" ? "不发布公告" : announcementSeverity}</span></SelectTrigger>
              <SelectContent><SelectItem value="none">不发布公告</SelectItem><SelectItem value="info">普通公告</SelectItem><SelectItem value="important">重要公告</SelectItem><SelectItem value="critical">不可关闭公告</SelectItem></SelectContent>
            </Select>
            <Input aria-label="公告标题" disabled={announcementSeverity === "none"} value={announcementTitle} onChange={(event) => setAnnouncementTitle(event.target.value)} placeholder="公告标题" />
            <Textarea className="md:col-span-2" aria-label="公告正文" disabled={announcementSeverity === "none"} value={announcementBody} onChange={(event) => setAnnouncementBody(event.target.value)} placeholder="公告正文" />
          </div>
          <Button className="w-fit" disabled={busy !== null || !status?.keyReady} onClick={() => void createManifest()}>
            {busy === "manifest" ? <LoaderCircleIcon className="animate-spin" /> : <PackageCheckIcon />}
            生成签名清单
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>中期检查日期规则</CardTitle>
          <CardDescription>按学生档案中的学院名称匹配；未列出的学院可选择任意有效日期。生成签名文件后发布到云端。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {dateRules.map((rule, index) => (
            <div key={index} className="grid gap-3 rounded-lg border p-3 lg:grid-cols-[1fr_12rem_12rem_auto]">
              <Input aria-label={`规则 ${index + 1} 学院`} value={rule.college} onChange={(event) => setDateRules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, college: event.target.value } : item))} placeholder="学院全称" />
              <Input aria-label={`规则 ${index + 1} 开始日期`} type="date" value={rule.start_date} onChange={(event) => setDateRules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, start_date: event.target.value } : item))} />
              <Input aria-label={`规则 ${index + 1} 结束日期`} type="date" value={rule.end_date} onChange={(event) => setDateRules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, end_date: event.target.value } : item))} />
              <Button variant="ghost" size="icon" aria-label={`删除规则 ${index + 1}`} onClick={() => setDateRules((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2Icon /></Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={dateRules.length >= 50} onClick={() => setDateRules((current) => [...current, { college: "", start_date: "", end_date: "" }])}><PlusIcon />添加学院规则</Button>
            <Button disabled={busy !== null || !status?.keyReady} onClick={() => void createDatePolicy()}>
              {busy === "date-policy" ? <LoaderCircleIcon className="animate-spin" /> : <ShieldCheckIcon />}
              生成签名日期规则
            </Button>
            <Button variant="secondary" disabled={busy !== null || !status?.keyReady} onClick={() => void publishDatePolicy()}>
              {busy === "publishing-date-policy" ? <LoaderCircleIcon className="animate-spin" /> : <PackageCheckIcon />}
              发布日期规则到云端
            </Button>
          </div>
        </CardContent>
      </Card>

      {message ? <Alert><ShieldCheckIcon /><AlertTitle>发布状态</AlertTitle><AlertDescription>{message}</AlertDescription></Alert> : null}
    </div>
  )
}
