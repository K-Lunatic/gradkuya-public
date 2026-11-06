import type { Course } from "./schedule";

const ORIGIN = "https://kupis.kku.ac.kr";
const BASE = `${ORIGIN}/wsugang`;
const CACHE_SECONDS = 60;

type CatalogItem = { lec_cd: string; lec_nm: string; temp_cd?: string };
type Catalog = { rows: CatalogItem[] };
type KupisRow = {
  shyr?: string;
  lec_no: string;
  lec_nm: string;
  isu_nm: string;
  pnt: string;
  lec_tm: string;
  prof: string;
  haksu_id: string;
  clss_no: string;
  tlsn_lmt_rcnt: string;
  tlsn_rcnt: string;
  clse_fg: string;
  params: string;
  sust_list?: string;
  sugang_remk?: string;
  remk?: string;
};

type SourcedRow = KupisRow & { sourceMenu: string; sourceLectCd: string; sourceDepartment: string; sourceArea?: string; affiliations: CourseAffiliation[]; subcategories: string[] };
export type CourseAffiliation = { department: string; category: string };

export type LiveCourse = Course & {
  category: string;
  section: string;
  professor: string;
  roomText: string;
  capacity: number;
  enrolled: number;
  params: string;
  sourceMenu: string;
  sourceLectCd: string;
  affiliations: CourseAffiliation[];
  targetYears: string;
  eligibleDepartments: string;
  enrollmentNote: string;
  deliveryMode: "이러닝" | "대면";
  subcategories: string[];
  restriction: string;
};

export async function getAllCourses() {
  const main = await getText(`${BASE}/core?attribute=timeMain`);
  const year = main.match(/var year = "(\d{4})"/)?.[1];
  const hakgi = main.match(/var hakgi = "([^"]+)"/)?.[1];
  if (!year || !hakgi) throw new Error("수강편람 학기 정보를 찾지 못했습니다.");

  const data = await getText(`${BASE}/html/data/data.js`);
  const hakgwa = parseCatalog(data, "hakgwa");
  const cultArea = parseCatalog(data, "cultArea");
  const hakbu = parseCatalog(data, "hakbu");
  const cultureMenu: Record<string, string> = {
    B04055: "3", B04056: "4", B04060: "11", B04058: "12", B04059: "13",
  };

  const queries = [
    ...hakgwa.rows.map((item) => ({ menu: "1", lectCd: item.lec_cd, sourceDepartment: item.lec_nm, sourceArea: "" })),
    ...cultArea.rows.flatMap((item) => cultureMenu[item.temp_cd ?? ""] ? [{ menu: cultureMenu[item.temp_cd ?? ""], lectCd: item.lec_cd, sourceDepartment: "", sourceArea: item.lec_nm }] : []),
    ...hakbu.rows.map((item) => ({ menu: "8", lectCd: item.lec_cd, sourceDepartment: item.lec_nm, sourceArea: "" })),
    ...["5", "9", "10"].map((menu) => ({ menu, lectCd: "", sourceDepartment: "", sourceArea: "" })),
  ];

  const rows = (await inBatches(queries, 8, async ({ menu, lectCd, sourceDepartment, sourceArea }) =>
    (await getRows(year, hakgi, menu, lectCd)).map((row) => ({ ...row, sourceMenu: menu, sourceLectCd: lectCd, sourceDepartment, sourceArea }))
  )).flat();
  const unique = mergeCourseRows(rows.filter((row) => row.clse_fg === "0"));
  return { year, hakgi, courses: unique.map(toCourse) };
}

export function mergeCourseRows(rows: (KupisRow & Omit<SourcedRow, keyof KupisRow | "affiliations" | "subcategories">)[]) {
  const merged = new Map<string, SourcedRow>();
  for (const row of rows) {
    const key = row.params || `${row.lec_no}@${row.haksu_id}@${row.clss_no}`;
    const current = merged.get(key) ?? { ...row, affiliations: [], subcategories: [] };
    if (row.sourceDepartment && ["전필", "전선"].includes(row.isu_nm) && !current.affiliations.some((item) => item.department === row.sourceDepartment && item.category === row.isu_nm))
      current.affiliations.push({ department: row.sourceDepartment, category: row.isu_nm });
    if (row.sourceArea && !current.subcategories.includes(row.sourceArea)) current.subcategories.push(row.sourceArea);
    merged.set(key, current);
  }
  return [...merged.values()];
}

export async function getVacancies(targets: { menu: string; lectCd: string }[]) {
  const main = await getText(`${BASE}/core?attribute=timeMain`);
  const year = main.match(/var year = "(\d{4})"/)?.[1];
  const hakgi = main.match(/var hakgi = "([^"]+)"/)?.[1];
  if (!year || !hakgi) throw new Error("수강편람 학기 정보를 찾지 못했습니다.");
  const unique = [...new Map(targets.map((target) => [`${target.menu}:${target.lectCd}`, target])).values()].slice(0, 20);
  const rows = (await inBatches(unique, 8, ({ menu, lectCd }) => getRows(year, hakgi, menu, lectCd, true))).flat();
  return rows.map((row) => ({ id: row.params || `${row.lec_no}@${row.haksu_id}@${row.clss_no}`, capacity: Number(row.tlsn_lmt_rcnt) || 0, enrolled: Number(row.tlsn_rcnt) || 0 }));
}

async function getRows(year: string, hakgi: string, menu: string, lectCd: string, fresh = false) {
  const query = new URLSearchParams({ attribute: "timeList", year, hakgi, menu, lectCd, _search: "false", rows: "2000", page: "1", sidx: "", sord: "asc" });
  const result = JSON.parse(await getText(`${BASE}/core?${query}`, fresh)) as { rows?: KupisRow[] };
  return result.rows ?? [];
}

function parseCatalog(source: string, name: string): Catalog {
  const match = source.match(new RegExp(`var\\s+${name}\\s*=\\s*(\\{[\\s\\S]*?\\n\\})\\s*(?=var|$)`));
  return match ? JSON.parse(match[1]) : { rows: [] };
}

function toCourse(row: SourcedRow): LiveCourse {
  const meetings = [...row.lec_tm.matchAll(/([월화수목금])\s*(\d{2})(\d{2})-(\d{2})(\d{2})/g)].map((match) => ({
    day: match[1] as Course["day"],
    start: Number(match[2]) + Number(match[3]) / 60,
    end: Number(match[4]) + Number(match[5]) / 60,
  }));
  const first = meetings[0] ?? { day: "월" as const, start: 0, end: 0 };
  return {
    id: row.params || `${row.lec_no}@${row.haksu_id}@${row.clss_no}`,
    name: row.lec_nm,
    category: row.isu_nm,
    professor: row.prof,
    day: first.day,
    start: first.start,
    end: first.end,
    meetings,
    credits: Number(row.pnt) || 0,
    group: row.haksu_id,
    color: hash(row.haksu_id) % 5 + 1,
    section: row.clss_no,
    roomText: row.lec_tm.trim(),
    capacity: Number(row.tlsn_lmt_rcnt) || 0,
    enrolled: Number(row.tlsn_rcnt) || 0,
    params: row.params,
    sourceMenu: row.sourceMenu,
    sourceLectCd: row.sourceLectCd,
    affiliations: row.affiliations,
    targetYears: row.shyr?.trim() || "전체 학년",
    eligibleDepartments: row.sust_list?.trim() || "별도 제한 없음",
    enrollmentNote: row.sugang_remk?.trim() || "",
    deliveryMode: row.sourceMenu === "9" ? "이러닝" : "대면",
    subcategories: row.subcategories,
    restriction: courseRestriction(row),
  };
}

export function courseRestriction(row: Pick<KupisRow, "lec_nm" | "sugang_remk" | "remk" | "sust_list">) {
  const note = `${row.sugang_remk ?? ""} ${row.remk ?? ""} ${row.sust_list ?? ""}`.replace(/\s+/g, " ");
  if (/(?:외국인|유학생|교환학생).{0,12}(?:전용|대상|한정|만\s*수강)|(?:전용|대상).{0,12}(?:외국인|유학생|교환학생)/.test(note)) return "외국인·유학생 대상 과목";
  if (/^(?:생활한국어|한국어\s*작문)/.test(row.lec_nm) && !/(한국인|내국인).{0,8}(?:수강\s*가능|허용)/.test(note)) return "외국인·유학생 대상 여부 확인 필요";
  return "";
}

async function getText(url: string, fresh = false) {
  const response = await fetch(url, fresh ? { cache: "no-store" } : { next: { revalidate: CACHE_SECONDS } });
  if (!response.ok) throw new Error(`수강편람 조회 실패 (${response.status})`);
  return response.text();
}

async function inBatches<T, R>(items: T[], size: number, task: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += size)
    results.push(...await Promise.all(items.slice(index, index + size).map(task)));
  return results;
}

function hash(value: string) {
  return [...value].reduce((total, char) => total + char.charCodeAt(0), 0);
}
