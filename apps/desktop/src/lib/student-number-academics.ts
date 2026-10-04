// Nominal admission-code mappings, inferred from the modal college and then the
// modal major within that college in the 2022, 2023 and 2025 reference cohorts.
// These are editable defaults, not a lookup of a student's current enrollment.
// No complete student numbers or other personal records are stored here.
export const STUDENT_NUMBER_ACADEMIC_RULES: Readonly<Record<string, {
  college: string
  majors: Readonly<Record<string, string>>
}>> = {
  "0010": { college: "中德智能制造学院", majors: {
    "1": "机械设计制造及其自动化", "2": "电子科学与技术", "3": "自动化", "4": "机器人工程",
  } },
  "0020": { college: "人工智能学院", majors: {
    "1": "物联网工程", "2": "计算机科学与技术", "3": "数据科学与大数据技术", "4": "计算机科学与技术（腾讯安全英才班）",
  } },
  "0030": { college: "新材料与新能源学院", majors: {
    "1": "光源与照明", "2": "新能源科学与工程", "4": "材料科学与工程",
  } },
  "0040": { college: "城市交通与物流学院", majors: {
    "1": "交通运输", "3": "车辆工程", "4": "物流管理",
  } },
  "0050": { college: "健康与环境工程学院", majors: {
    "1": "生物医学工程", "2": "智能医学工程",
  } },
  "0060": { college: "创意设计学院", majors: {
    "1": "工业设计", "2": "环境设计", "3": "艺术与科技", "4": "新媒体艺术",
  } },
  "0070": { college: "商学院", majors: {
    "1": "国际商务", "2": "财务管理", "3": "市场营销",
  } },
  "0080": { college: "工程物理学院", majors: {
    "1": "应用物理学", "2": "光电信息科学与工程", "3": "智能感知工程",
  } },
  "0100": { college: "外国语学院", majors: {
    "1": "英语", "3": "德语",
  } },
  "0110": { college: "药学院", majors: {
    "0": "中药学（特）", "1": "药学", "2": "中药学", "3": "生物制药", "4": "口腔医学技术",
  } },
  "0120": { college: "集成电路与光电芯片学院", majors: {
    "1": "微电子科学与工程", "2": "集成电路设计与集成系统", "3": "集成电路设计与集成系统（龙芯英才班）",
  } },
  "0130": { college: "音乐学院", majors: { "1": "音乐表演" } },
  "0151": { college: "创意设计学院", majors: { "0": "计算机科学与技术专业（数字服饰技术精英班）" } },
}

export type StudentNumberAcademics = {
  graduationCohort: string
  college?: string
  major?: string
}

export function inferStudentNumberAcademics(studentNumber: string): StudentNumberAcademics | null {
  const value = studentNumber.trim()
  const modernNumber = /^20\d{10}$/.test(value)
  const legacy2018Number = /^2018\d{7}$/.test(value)
  if (!modernNumber && !legacy2018Number) return null

  const admissionYear = Number(value.slice(0, 4))
  if (modernNumber && admissionYear < 2019) return null
  const result: StudentNumberAcademics = { graduationCohort: `${admissionYear + 4}届` }

  // Older cohorts use different codes (including 2021/0120); never apply the
  // current college/major table to them. The user can still edit every field.
  if (admissionYear < 2022) return result
  const rule = STUDENT_NUMBER_ACADEMIC_RULES[value.slice(4, 8)]
  if (!rule) return result
  const major = rule.majors[value[8]]
  return { ...result, college: rule.college, ...(major ? { major } : {}) }
}
