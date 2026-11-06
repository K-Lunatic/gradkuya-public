import handbookIndex from "../data/handbooks/index.json" with { type: "json" };

export type Handbook = { year: number; title: string; pages: { page: number; text: string }[] };
const handbooks = handbookIndex as Handbook[];
const pending = new Map<number, Promise<boolean>>();
const boardUrl = "https://www.kku.ac.kr/ajax/FR_SVC/BBSViewList2.do";
const headers = {
  "User-Agent": "Mozilla/5.0 (compatible; GradKUya/1.0)",
  Referer: "https://www.kku.ac.kr/cms/FR_CON/index.do?MENU_ID=590",
};

type BoardPost = {
  BBS_SEQ: number;
  SUBJECT: string;
  FILE_CNT: number;
  FILE_ORG_NM: string | null;
};

export function findHandbookPost(posts: BoardPost[], year: number) {
  return posts.find((post) =>
    post.FILE_CNT > 0 &&
    post.SUBJECT.includes(String(year)) &&
    /요람/.test(post.SUBJECT) &&
    /\.pdf$/i.test(post.FILE_ORG_NM ?? "")
  ) ?? null;
}

export async function ensureHandbook(year: number) {
  if (handbooks.some((handbook) => handbook.year === year)) return true;
  if (!pending.has(year)) pending.set(year, fetchHandbook(year));
  return pending.get(year)!;
}

export function getDepartmentCurriculum(year: number, department: string) {
  const handbook = selectHandbook(year);
  if (!handbook) return null;

  const name = department.match(/[가-힣A-Za-z]+(?:학과|학부|전공)/g)?.at(-1) ?? department;
  const heading = new RegExp(`(?:^|\\n)[•Ÿ]?\\s*${escapeRegex(name)}\\s*(?:\\n|$)`);
  const start = handbook.pages.findIndex((page) => heading.test(page.text) && page.text.includes("전공목표"));
  if (start < 0) return null;

  const pages = [];
  for (let index = start; index < Math.min(handbook.pages.length, start + 6); index++) {
    const page = handbook.pages[index];
    if (index > start && page.text.includes("전공목표")) break;
    pages.push(page);
  }

  let text = pages.map((page) => page.text).join("\n").replace(/[ \t]+/g, " ");
  const curriculumEnd = text.search(/(?<!소)계\s+\d+\s*과목/);
  if (curriculumEnd >= 0) text = text.slice(0, curriculumEnd);
  const courses = [...text.matchAll(/(전필|전선)\s+([A-Z]{4}\d{5})\s+(.+?)\s+(\d(?:\.\d+)?)\s*\(/g)].map((match) => ({
    type: match[1] === "전필" ? "required" as const : "elective" as const,
    code: match[2],
    name: match[3].replace(/\s+/g, ""),
    credits: Number(match[4]),
  }));
  const unique = [...new Map(courses.map((course) => [course.code, course])).values()];

  return {
    admissionYear: year,
    handbookYear: handbook.year,
    department: name,
    credits: getCreditRequirements(year, name),
    courses: unique,
    source: { title: handbook.title, pages: pages.map((page) => page.page) },
  };
}

export function getLatestHandbookYear() {
  return Math.max(...handbooks.map((handbook) => handbook.year));
}

export function getHandbookYears() {
  return [...new Set(handbooks.map((handbook) => handbook.year))].sort((a, b) => b - a);
}

export function getDepartmentNames(year: number) {
  const handbook = selectHandbook(year);
  if (!handbook) return [];
  const names = new Set<string>();
  for (const page of handbook.pages.filter((item) => item.text.includes("전공목표"))) {
    for (const line of page.text.split("\n")) {
      const name = line.replace(/^[•Ÿ]\s*/, "").trim();
      if (/^[가-힣A-Za-z·‧]+(?:학과|학부|전공)$/.test(name)) names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, "ko"));
}

export function getCreditRequirements(year: number, department: string) {
  const handbook = selectHandbook(year);
  if (!handbook) return null;
  const text = handbook.pages.map((page) => page.text).join("\n").replace(/[ \t]+/g, " ");
  const name = department.match(/[가-힣A-Za-z·‧]+(?:학과|학부|전공)/g)?.at(-1) ?? department;
  const row = text.match(new RegExp(`${escapeRegex(name)}\\s+(\\d+(?:\\(\\d+\\))?|-)[*]*\\s+(\\d+|-)\\s+(\\d+|-)\\s+(\\d+|-)\\s+(?:\\d+|-)\\s+(?:\\d+|-)\\s+(\\d+)`));
  if (!row) return null;
  const value = (index: number) => row[index] === "-" ? 0 : Number(row[index].match(/\d+/)?.[0]) || 0;
  return {
    total: value(5),
    general: value(1),
    majorRequired: value(2),
    majorElective: value(3),
    majorTotal: value(4),
  };
}

const subcategories = [
  "글쓰기", "발표와토론", "외국어기초", "인문기초", "과학기초",
  "글로벌언어", "인간과문화", "인간과사회", "과학과기술", "예술과체육", "융복합",
  "인성", "실무", "실기",
];

export function getCourseSubcategory(year: number, code: string) {
  const handbook = selectHandbook(year);
  if (!handbook) return null;
  for (const page of handbook.pages) {
    const index = page.text.indexOf(code);
    if (index < 0) continue;
    const tail = page.text.slice(index + code.length, index + code.length + 180);
    const found = subcategories
      .map((name) => ({ name, index: tail.search(new RegExp(`(?:\\s|\\))${name}(?:\\s|$)`)) }))
      .filter((item) => item.index >= 0)
      .sort((a, b) => a.index - b.index)[0];
    if (found) return found.name;
  }
  return null;
}

export function getGeneralRequirements(year: number) {
  const handbook = selectHandbook(year);
  const text = handbook?.pages.map((page) => page.text).join("\n") ?? "";
  const total = (name: string) => Number(text.match(new RegExp(`${name}\\s*:\\s*(\\d+)학점\\s*이상`))?.[1]) || 0;
  return [
    {
      category: "기초", label: "기초교양", required: total("기초교양"),
      subcategories: [["글쓰기", 3], ["발표와토론", 3], ["외국어기초", 6], ["인문기초", 3], ["과학기초", 3]] as [string, number][],
    },
    {
      category: "심화", label: "심화교양", required: total("심화교양"),
      subcategories: subcategories.slice(5, 11).map((name) => [name, 2] as [string, number]),
      minimumAreas: Number(text.match(/6개\s*영역\s*중\s*최소\s*(\d+)개/)?.[1]) || 0,
    },
    {
      category: "소양", label: "KU소양", required: total("KU소양"),
      subcategories: [["인성", 3], ["실무", 4], ["실기", 2]] as [string, number][],
    },
  ];
}

function selectHandbook(admissionYear: number) {
  return [...handbooks]
    .filter((handbook) => handbook.year <= admissionYear)
    .sort((a, b) => b.year - a.year)[0] ?? null;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchHandbook(year: number) {
  try {
    const body = new URLSearchParams({
      pageNo: "1", pagePerCnt: "100", MENU_ID: "590", SITE_NO: "2",
      BOARD_SEQ: "13", BOARD_TYPE: "C0301", SEARCH_FLD: "SUBJECT", SEARCH: "",
    });
    const listResponse = await fetch(boardUrl, {
      method: "POST", headers, body, signal: AbortSignal.timeout(10_000),
    });
    if (!listResponse.ok) return false;

    const json = await listResponse.json() as { data?: { list?: BoardPost[] } };
    const post = findHandbookPost(json.data?.list ?? [], year);
    if (!post) return false;

    const pdfResponse = await fetch(
      `https://www.kku.ac.kr/ajaxFile/FR_SVC/BoardZipDown.do?SITE_NO=2&BOARD_SEQ=13&BBS_SEQ=${post.BBS_SEQ}`,
      { headers, signal: AbortSignal.timeout(30_000) },
    );
    if (!pdfResponse.ok) return false;
    const bytes = new Uint8Array(await pdfResponse.arrayBuffer());
    if (bytes.length > 30 * 1024 * 1024 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return false;

    const { extractPdfText } = await import("./pdf-server.ts");
    const result = await extractPdfText(bytes);
    const pageTexts = Array.isArray(result.text) ? result.text : [result.text];
    handbooks.push({ year, title: post.SUBJECT, pages: pageTexts.map((text, index) => ({ page: index + 1, text: text.replace(/\0/g, "") })) });
    return true;
  } catch {
    return false;
  }
}
