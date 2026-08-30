export type AcademicCollegeOption = {
  college: string
  majors: Array<{ major: string; classes: string[] }>
}

const SOURCE_ACADEMIC_OPTIONS: AcademicCollegeOption[] = [
  {
    college: "中德智能制造学院",
    majors: [
      {
        major: "机器人工程",
        classes: ["23级机器人1班", "23级机器人2班", "23级机器人3班"],
      },
      {
        major: "机械设计制造及其自动化",
        classes: [
          "22级机械1班",
          "22级机械2班",
          "22级机械3班",
          "22级机械4班",
          "23级机械1班",
          "23级机械2班",
          "23级机械3班",
        ],
      },
      {
        major: "电子科学与技术",
        classes: [
          "22级电子1班",
          "22级电子2班",
          "22级电子3班",
          "22级电子4班",
          "23级电子1班",
          "23级电子2班",
          "23级电子3班",
          "23级电子4班",
          "25级电子3班",
        ],
      },
      {
        major: "自动化",
        classes: [
          "22级自动化1班",
          "22级自动化2班",
          "22级自动化3班",
          "22级自动化4班",
          "23级自动化1班",
          "23级自动化2班",
          "23级自动化3班",
          "25级自动化1班",
        ],
      },
    ],
  },
  {
    college: "人工智能学院",
    majors: [
      {
        major: "人工智能",
        classes: ["25级人工智能1班", "25级人工智能3班"],
      },
      {
        major: "数据科学与大数据技术",
        classes: [
          "22级大数据1班",
          "22级大数据2班",
          "22级大数据3班",
          "22级大数据4班",
          "23级大数据1班",
          "23级大数据2班",
          "23级大数据3班",
        ],
      },
      {
        major: "物联网工程",
        classes: [
          "22级物联网1班",
          "22级物联网2班",
          "22级物联网3班",
          "23级物联网1班",
          "23级物联网2班",
          "23级物联网3班",
          "23级物联网4班",
        ],
      },
      {
        major: "计算机科学与技术",
        classes: [
          "22级计算机1班",
          "22级计算机2班",
          "22级计算机3班",
          "22级计算机4班",
          "23级计算机1班",
          "23级计算机2班",
          "23级计算机3班",
          "25级计算机2班",
        ],
      },
      {
        major: "计算机科学与技术（腾讯安全英才班）",
        classes: ["23级计算机（腾讯）"],
      },
    ],
  },
  {
    college: "健康与环境工程学院",
    majors: [
      {
        major: "智能医学工程",
        classes: [
          "22级智医1班",
          "22级智医2班",
          "22级智医3班",
          "23级智医1班",
          "23级智医2班",
          "23级智医3班",
          "23级智医4班",
        ],
      },
      {
        major: "生物医学工程",
        classes: [
          "22级生医工1班",
          "22级生医工2班",
          "22级生医工3班",
          "23级生医工1班",
          "23级生医工2班",
          "23级生医工3班",
        ],
      },
    ],
  },
  {
    college: "创意设计学院",
    majors: [
      {
        major: "工业设计",
        classes: [
          "22级工设1班",
          "22级工设2班",
          "22级工设3班",
          "23级工设1班",
          "23级工设2班",
        ],
      },
      { major: "新媒体艺术", classes: ["23级新媒体1班"] },
      {
        major: "环境设计",
        classes: ["22级环设1班", "22级环设2班", "23级环设1班", "23级环设2班"],
      },
      {
        major: "艺术与科技",
        classes: ["22级艺科1班", "22级艺科2班", "23级艺科1班", "23级艺科2班"],
      },
      {
        major: "计算机科学与技术专业（数字服饰技术精英班）",
        classes: ["23级计算机（数服）"],
      },
    ],
  },
  {
    college: "商学院",
    majors: [
      {
        major: "国际商务",
        classes: [
          "22级人力资源方向班(IB)",
          "22级营销方向班(IB)",
          "22级金融方向班(IB)",
          "23级人力资源方向班(IB)",
          "23级商务1班",
          "23级营销方向班(IB)",
          "23级金融方向班(IB)",
        ],
      },
      {
        major: "市场营销",
        classes: ["22级电子营销方向班(MKT)", "23级市场1班", "23级市场2班", "25级市场1班"],
      },
      {
        major: "财务管理",
        classes: ["22级智能财务方向班(FM)", "23级财务1班", "23级财务2班"],
      },
    ],
  },
  {
    college: "城市交通与物流学院",
    majors: [
      {
        major: "交通运输",
        classes: ["22级交通1班", "22级交通2班", "23级交通1班", "23级交通2班"],
      },
      {
        major: "物流管理",
        classes: [
          "22级物流1班",
          "22级物流2班",
          "22级物流3班",
          "23级物流1班",
          "23级物流2班",
          "23级物流3班",
        ],
      },
      {
        major: "车辆工程",
        classes: [
          "22级车辆1班",
          "22级车辆2班",
          "22级车辆3班",
          "22级车辆4班",
          "23级车辆1班",
          "23级车辆2班",
          "23级车辆3班",
        ],
      },
    ],
  },
  {
    college: "外国语学院",
    majors: [
      { major: "商务英语", classes: ["23级商英2班", "23级商英3班"] },
      {
        major: "德语",
        classes: ["22级德语1班", "22级德语2班", "23级德语1班", "23级德语2班"],
      },
      {
        major: "英语",
        classes: [
          "22级英语1班",
          "22级英语2班",
          "22级英语3班",
          "23级英语1班",
          "23级英语3班",
          "23级英语4班",
        ],
      },
    ],
  },
  {
    college: "大数据与互联网学院",
    majors: [
      {
        major: "数据科学与大数据技术",
        classes: ["22级大数据3班", "23级大数据2班", "23级大数据3班"],
      },
      { major: "物联网工程", classes: ["23级物联网2班"] },
      { major: "计算机科学与技术", classes: ["23级计算机1班"] },
    ],
  },
  {
    college: "工程物理学院",
    majors: [
      {
        major: "光电信息科学与工程",
        classes: [
          "22级光电1班",
          "22级光电2班",
          "22级光电3班",
          "22级光电4班",
          "22级光电5班",
          "23级光电1班",
          "23级光电2班",
          "23级光电3班",
        ],
      },
      {
        major: "应用物理学",
        classes: ["22级应物1班", "22级应物2班", "23级应物1班", "23级应物2班", "25级应物1班"],
      },
      {
        major: "智能感知工程",
        classes: ["23级智感1班", "23级智感2班", "23级智感3班"],
      },
    ],
  },
  {
    college: "新材料与新能源学院",
    majors: [
      {
        major: "光源与照明",
        classes: ["22级光源1班", "22级光源2班", "23级光源1班", "23级光源2班"],
      },
      {
        major: "新能源科学与工程",
        classes: [
          "22级新能源1班",
          "22级新能源2班",
          "22级新能源3班",
          "23级新能源1班",
          "23级新能源2班",
          "23级新能源3班",
        ],
      },
      {
        major: "材料科学与工程",
        classes: ["22级材料1班", "22级材料2班", "23级材料1班", "23级材料2班"],
      },
    ],
  },
  {
    college: "未来技术学院",
    majors: [
      { major: "人工智能", classes: ["25级新才7班"] },
      { major: "工业设计", classes: ["22级新才4班", "23级新才4班"] },
      { major: "新能源科学与工程", classes: ["23级新才2班"] },
      { major: "材料科学与工程", classes: ["23级新才3班"] },
      { major: "物联网工程", classes: ["22级新才3班"] },
      {
        major: "电子科学与技术",
        classes: ["22级新才2班", "23级新才1班", "25级新才3班"],
      },
    ],
  },
  {
    college: "药学院",
    majors: [
      {
        major: "中药学",
        classes: ["22级中药1班", "22级中药2班", "22级中药3班", "23级中药1班"],
      },
      { major: "中药学（特）", classes: ["22级中药精英班", "23级中药精英班"] },
      { major: "口腔医学技术", classes: ["23级口腔1班", "23级口腔2班"] },
      { major: "生物制药", classes: ["23级生药1班", "23级生药2班"] },
      {
        major: "药学",
        classes: [
          "22级药学1班",
          "22级药学3班",
          "22级药学4班",
          "22级药学5班",
          "23级药学1班",
          "23级药学2班",
          "23级药学3班",
          "23级药学4班",
          "23级药学5班",
        ],
      },
    ],
  },
  {
    college: "集成电路与光电芯片学院",
    majors: [
      {
        major: "微电子科学与工程",
        classes: [
          "22级微电子1班",
          "22级微电子2班",
          "22级微电子3班",
          "22级微电子4班",
          "22级英才班",
          "23级微电子1班",
          "23级微电子2班",
          "23级微电子3班",
          "23级微电子4班",
          "23级英才班",
          "25级微电子1班",
          "25级微电子2班",
          "25级微电子3班",
          "25级微电子4班",
          "25级英才班",
        ],
      },
      {
        major: "集成电路设计与集成系统",
        classes: [
          "22级集成1班",
          "22级集成2班",
          "22级集成3班",
          "23级集成1班",
          "23级集成2班",
          "23级集成3班",
          "25级集成1班",
          "25级集成2班",
          "25级集成3班",
          "25级集成4班",
        ],
      },
      {
        major: "集成电路设计与集成系统（龙芯英才班）",
        classes: ["25级龙芯英才班"],
      },
    ],
  },
  {
    college: "音乐学院",
    majors: [{ major: "音乐表演", classes: ["23级音表1班"] }],
  },
]

const compareText = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0

// Follow the college order used by the university selector. Colleges that are
// not present in this reference keep their repository source order and appear
// after the referenced entries; the screenshot is not used to add new data.
const COLLEGE_DISPLAY_ORDER = [
  "中德智能制造学院",
  "人工智能学院",
  "新材料与新能源学院",
  "城市交通与物流学院",
  "健康与环境工程学院",
  "创意设计学院",
  "商学院",
  "工程物理学院",
  "药学院",
  "外国语学院",
  "未来技术学院",
  "集成电路与光电芯片学院",
  "音乐学院",
  "大数据与互联网学院",
] as const

const collegeDisplayRank = new Map<string, number>(
  COLLEGE_DISPLAY_ORDER.map((college, index) => [college, index]),
)

export function normalizeAcademicClassLabel(className: string): string {
  return className.trim().replace(/^(?:\d{2}|\d{4})\s*级\s*/u, "").trim()
}

export const ACADEMIC_OPTIONS: AcademicCollegeOption[] =
  SOURCE_ACADEMIC_OPTIONS.map((college) => ({
    ...college,
    majors: college.majors.map((major) => ({
      ...major,
      classes: Array.from(
        new Set(major.classes.map(normalizeAcademicClassLabel)),
      ).sort(compareText),
    })),
  })).sort(
    (left, right) =>
      (collegeDisplayRank.get(left.college) ?? COLLEGE_DISPLAY_ORDER.length) -
      (collegeDisplayRank.get(right.college) ?? COLLEGE_DISPLAY_ORDER.length),
  )
