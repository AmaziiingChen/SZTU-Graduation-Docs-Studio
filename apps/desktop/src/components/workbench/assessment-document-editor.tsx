import { ArrowDownIcon } from "@/components/ui/arrow-down"
import { ArrowUpIcon } from "@/components/ui/arrow-up"
import { PlusIcon } from "@/components/ui/plus"
import { DeleteIcon } from "@/components/ui/delete"
import { AnimatedActionIcon } from "@/components/animated-action-icon"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DocumentDateField, parseDocumentDate } from "@/components/workbench/document-date-field"
import { StructuredContentEditor } from "@/components/workbench/structured-content-editor"
import { FormField } from "@/components/workbench/form-field"
import { TEACHER_TITLE_OPTIONS } from "@/lib/teacher-title-options"
import { assessmentDocumentRegistry, assessmentGradeError, moveAssessmentItem, type AssessmentDocumentType, type AssessmentDraft } from "@/lib/assessment-documents"
import type { StructuredBodyValue } from "@/types/structured-content"

export function AssessmentDocumentEditor({ type, activeSection, value, onChange, disabled, sharedInformation, lowerEditingEnabled = assessmentDocumentRegistry[type].lowerEditingEnabled }: {
  type: AssessmentDocumentType
  activeSection: string
  value: AssessmentDraft
  onChange: (value: AssessmentDraft) => void
  disabled: boolean
  sharedInformation: { label: string; value: string }[]
  lowerEditingEnabled?: boolean
}) {
  const lowerDisabled = disabled || !lowerEditingEnabled
  const update = <K extends keyof AssessmentDraft>(field: K, next: AssessmentDraft[K]) => onChange({ ...value, [field]: next })
  const textField = (field: "reviewer" | "reviewerTitle" | "defenseTime" | "defenseLocation" | "recorder" | "leader" | "suggestedGrade" | "finalGrade", label: string, lower = false, error?: string | null) => (
    <FormField key={field} id={`assessment-${field}`} label={label} value={value[field]} disabled={lower ? lowerDisabled : disabled} onChange={(_field, next) => update(field, next)} error={error ?? undefined} orientation="horizontal" />
  )
  const dateField = <DocumentDateField id="assessment-date" label="日期" orientation="horizontal" value={value.date} onChange={next => update("date", next)} disabled={lowerDisabled} placeholder="选择日期" error={value.date && !parseDocumentDate(value.date) ? "请选择有效日期。" : undefined} />
  const membersEditor = <div className="grid gap-3">
    {value.members.map((member, index) => (
      <FormField key={index} id={`assessment-member-${index}`} label={`答辩成员 ${index + 1}`} value={member} disabled={lowerDisabled} onChange={(_field, next) => update("members", value.members.map((entry, i) => i === index ? next : entry))} orientation="horizontal" />
    ))}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={lowerDisabled} onClick={() => update("members", [...value.members, ""])}><AnimatedActionIcon icon={PlusIcon} />添加答辩成员</Button>
      <Button type="button" variant="outline" disabled={lowerDisabled || value.members.length === 0} onClick={() => update("members", value.members.slice(0, -1))}><AnimatedActionIcon icon={DeleteIcon} />删除答辩成员</Button>
    </div>
  </div>
  const updateQuestion = (index: number, field: "question" | "answer", body: StructuredBodyValue) => update("questions", value.questions.map((entry, i) => i === index ? { ...entry, [field]: body } : entry))

  return <div className="grid gap-4">
    {!lowerEditingEnabled && activeSection !== "assessment_info" ? <Alert><AlertTitle>评审内容当前仅供查看</AlertTitle></Alert> : null}
    {activeSection === "assessment_info" ? <Card className="border-0 shadow-none ring-0">
      <CardContent className="grid gap-3">
        <dl className="grid gap-3 text-sm">{sharedInformation.map(entry => <div key={entry.label} className="grid grid-cols-2 gap-3"><dt className="text-muted-foreground">{entry.label}</dt><dd className="select-text break-words">{entry.value || "未填写"}</dd></div>)}</dl>
        {type === "reviewer_review" ? <div className="grid gap-3">
          <FormField id="assessment-reviewer" label="评阅教师姓名" value={value.reviewer} onChange={(_field, next) => update("reviewer", next)} disabled={disabled} orientation="horizontal" />
          <FormField id="assessment-reviewerTitle" label="评阅教师职称" value={value.reviewerTitle} onChange={(_field, next) => update("reviewerTitle", next)} suggestions={TEACHER_TITLE_OPTIONS} placeholder="选择或输入职称" disabled={disabled} orientation="horizontal" />
        </div> : null}
        {type === "defense_record" ? <div className="grid gap-3">{textField("defenseTime", "答辩时间")}{textField("defenseLocation", "答辩地点")}</div> : null}
      </CardContent>
    </Card> : null}
    {activeSection === "assessment_suggested_grade" && (type === "advisor_review" || type === "reviewer_review") ? <Card className="border-0 shadow-none ring-0">
      <CardContent className="grid gap-4">{textField("suggestedGrade", "建议成绩", true)}{dateField}</CardContent>
    </Card> : null}
    {activeSection === "assessment_questions" ? <Card className="border-0 shadow-none ring-0">
      <CardContent className="grid gap-4">
        <StructuredContentEditor value={value.comments} guidance={value.writingGuidance.questions} onChange={(comments, guidance) => onChange({ ...value, comments, writingGuidance: { ...value.writingGuidance, questions: guidance ?? null } })} disabled={lowerDisabled} ariaLabel="答辩记录正文" enableDocumentTools={false} enableProcessEquations={false} />
        {value.questions.map((entry, index) => <div key={index} className="grid gap-3 border-b pb-4" role="group" aria-label={`问答 ${index + 1}`}>
          <div className="flex items-center gap-2"><span className="mr-auto text-sm font-medium">问答 {index + 1}</span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`上移问答 ${index + 1}`} disabled={lowerDisabled || index === 0} onClick={() => update("questions", moveAssessmentItem(value.questions, index, -1))}><AnimatedActionIcon icon={ArrowUpIcon} /></Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`下移问答 ${index + 1}`} disabled={lowerDisabled || index === value.questions.length - 1} onClick={() => update("questions", moveAssessmentItem(value.questions, index, 1))}><AnimatedActionIcon icon={ArrowDownIcon} /></Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`删除问答 ${index + 1}`} disabled={lowerDisabled} onClick={() => update("questions", value.questions.filter((_, i) => i !== index))}><AnimatedActionIcon icon={DeleteIcon} /></Button>
          </div>
          <p className="text-sm text-muted-foreground">问题</p>
          <StructuredContentEditor value={entry.question} onChange={next => updateQuestion(index, "question", next)} disabled={lowerDisabled} ariaLabel={`问题 ${index + 1}`} placeholder="输入问题" enableDocumentTools={false} enableProcessEquations={false} />
          <p className="text-sm text-muted-foreground">回答</p>
          <StructuredContentEditor value={entry.answer} onChange={next => updateQuestion(index, "answer", next)} disabled={lowerDisabled} ariaLabel={`回答 ${index + 1}`} placeholder="输入回答" enableDocumentTools={false} enableProcessEquations={false} />
        </div>)}
        <Button type="button" variant="outline" className="w-fit" disabled={lowerDisabled} onClick={() => update("questions", [...value.questions, { question: [], answer: [] }])}><AnimatedActionIcon icon={PlusIcon} />添加问答</Button>
      </CardContent>
    </Card> : null}
    {activeSection === "assessment_members" && type === "defense_record" ? <Card className="border-0 shadow-none ring-0">
      <CardContent className="grid gap-4">{membersEditor}<div className="grid gap-3">
        {type === "defense_record" ? textField("recorder", "记录员姓名", true) : null}{textField("leader", "答辩组长姓名", true)}
      </div>{dateField}</CardContent>
    </Card> : null}
    {activeSection === "assessment_grade" ? <Card className="border-0 shadow-none ring-0">
      <CardContent className="grid gap-4">{textField("finalGrade", "最终成绩", true, assessmentGradeError(value.finalGrade))}
        {dateField}
      </CardContent>
    </Card> : null}
  </div>
}
