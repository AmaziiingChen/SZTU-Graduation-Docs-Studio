import type { CheckResult, DocumentType } from "@/types/desktop-api"

export type CheckNavigationTarget = {
  pane: "profile" | "document"
  sectionId?: string
  selector: string
}

const PROFILE_FIELDS: Array<{
  fields: readonly string[]
  selector: string
}> = [
  { fields: ["metadata.title"], selector: '[aria-label="中文题目"]' },
  { fields: ["thesis.englishTitle"], selector: "#englishTitle" },
  { fields: ["metadata.student_name"], selector: "#studentName" },
  { fields: ["metadata.student_id"], selector: "#studentId" },
  { fields: ["metadata.college"], selector: "#college" },
  { fields: ["metadata.major"], selector: "#major" },
  { fields: ["metadata.class_name"], selector: "#className" },
  { fields: ["metadata.advisor"], selector: "#advisor-0" },
  { fields: ["metadata.advisor_title"], selector: "#advisor-title-0" },
  { fields: ["metadata.graduation_year"], selector: "#graduationCohort" },
]

const DOCUMENT_SECTIONS: Record<
  DocumentType,
  Array<{ field: string; sectionId: string; selector: string }>
> = {
  proposal: [
    {
      field: "sections.significance_and_status",
      sectionId: "proposal_significance",
      selector: '[aria-label="本选题的意义及国内外发展状况"]',
    },
    {
      field: "sections.research_content",
      sectionId: "proposal_research",
      selector: '[aria-label="研究内容"]',
    },
    {
      field: "sections.methods_and_means",
      sectionId: "proposal_methods",
      selector: '[aria-label="研究方法与手段"]',
    },
    {
      field: "sections.research_steps",
      sectionId: "proposal_steps",
      selector: '[aria-label="研究步骤"]',
    },
    {
      field: "sections.references",
      sectionId: "proposal_references",
      selector: '[aria-label="参考文献 BibTeX"]',
    },
  ],
  midterm: [
    {
      field: "metadata.check_date",
      sectionId: "document_info",
      selector: "#checkDate",
    },
    {
      field: "sections.directory",
      sectionId: "midterm_directory",
      selector: '[aria-label="论文目录条目"]',
    },
    {
      field: "sections.main_research_content",
      sectionId: "midterm_research",
      selector: '[aria-label="论文主要研究内容"]',
    },
    {
      field: "sections.progress",
      sectionId: "midterm_progress",
      selector: '[aria-label="毕业论文（设计）进展情况"]',
    },
  ],
  thesis: [],
  advisor_review: [
    { field: "sections.comments", sectionId: "assessment_comments", selector: '[aria-label="评审意见"]' },
    { field: "sections.division_of_work", sectionId: "assessment_division", selector: '[aria-label="合作课题分工情况"]' },
    { field: "sections.suggested_grade", sectionId: "assessment_suggested_grade", selector: "#assessment-suggestedGrade" },
    { field: "sections.date", sectionId: "assessment_suggested_grade", selector: "#assessment-date" },
  ],
  reviewer_review: [
    { field: "metadata.reviewer_title", sectionId: "assessment_info", selector: "#assessment-reviewerTitle" },
    { field: "metadata.reviewer", sectionId: "assessment_info", selector: "#assessment-reviewer" },
    { field: "sections.comments", sectionId: "assessment_comments", selector: '[aria-label="评审意见"]' },
    { field: "sections.suggested_grade", sectionId: "assessment_suggested_grade", selector: "#assessment-suggestedGrade" },
    { field: "sections.date", sectionId: "assessment_suggested_grade", selector: "#assessment-date" },
  ],
  defense_record: [
    { field: "metadata.defense_time", sectionId: "assessment_info", selector: "#assessment-defenseTime" },
    { field: "metadata.defense_location", sectionId: "assessment_info", selector: "#assessment-defenseLocation" },
    { field: "metadata.recorder", sectionId: "assessment_members", selector: "#assessment-recorder" },
    { field: "metadata.leader", sectionId: "assessment_members", selector: "#assessment-leader" },
    { field: "sections.questions", sectionId: "assessment_questions", selector: '[aria-label="问题 1"]' },
    { field: "sections.members", sectionId: "assessment_members", selector: '[aria-label="答辩成员 1"]' },
    { field: "sections.date", sectionId: "assessment_members", selector: "#assessment-date" },
  ],
  grade_assessment: [
    { field: "sections.comments", sectionId: "assessment_comments", selector: '[aria-label="答辩小组意见"]' },
    { field: "sections.final_grade", sectionId: "assessment_grade", selector: "#assessment-finalGrade" },
    { field: "sections.date", sectionId: "assessment_grade", selector: "#assessment-date" },
  ],
  task_book: [
    {
      field: "sections.basic_content_and_requirements",
      sectionId: "task_basic",
      selector: '[aria-label="基本内容和要求"]',
    },
    {
      field: "sections.schedule",
      sectionId: "task_schedule",
      selector: '[aria-label="进度安排条目"]',
    },
    {
      field: "sections.required_materials",
      sectionId: "task_materials",
      selector: '[aria-label="需收集的资料及主要参考文献资料"]',
    },
    {
      field: "sections.references",
      sectionId: "task_references",
      selector: '[aria-label="参考文献 BibTeX"]',
    },
    {
      field: "sections.topic_information",
      sectionId: "task_topic",
      selector: '[aria-label="选题性质"]',
    },
  ],
}

function checkField(check: CheckResult): string | null {
  const field = check.details?.field
  if (typeof field === "string") return field
  return check.code === "GRADUATION_YEAR_MISSING"
    ? "metadata.graduation_year"
    : null
}

export function checkNavigationTarget(
  documentType: DocumentType,
  check: CheckResult,
): CheckNavigationTarget | null {
  const field = checkField(check)
  if (!field) return null
  const profile = PROFILE_FIELDS.find(({ fields }) =>
    fields.some((candidate) => field === candidate || field.startsWith(`${candidate}.`) || field.startsWith(`${candidate}[`)),
  )
  if (profile) {
    return { pane: "profile", selector: profile.selector }
  }
  const section = DOCUMENT_SECTIONS[documentType].find((candidate) =>
    field.startsWith(candidate.field),
  )
  return section
    ? {
        pane: "document",
        sectionId: section.sectionId,
        selector: section.selector,
      }
    : null
}
