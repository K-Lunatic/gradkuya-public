import { findHandbookPost, getCreditRequirements, getDepartmentCurriculum, getDepartmentNames } from "./handbooks.ts";
import { getLatestHandbookYear } from "./handbooks.ts";

const cases = [
  [2023, "컴퓨터공학과", 5],
  [2026, "컴퓨터공학과", 1],
  [2023, "바이오메디컬공학과", 7],
  [2026, "메카트로닉스공학과", 7],
] as const;

for (const [year, department, required] of cases) {
  const curriculum = getDepartmentCurriculum(year, department);
  if (!curriculum || curriculum.courses.filter((course) => course.type === "required").length !== required)
    throw new Error(`${year} ${department} 파싱 실패`);
}
if (!getDepartmentNames(2026).includes("컴퓨터공학과")) throw new Error("새내기 학과 목록 추출 실패");
const credits2026 = getCreditRequirements(2026, "컴퓨터공학과");
if (!credits2026 || credits2026.total !== 132 || credits2026.majorRequired !== 3 || credits2026.majorElective !== 63)
  throw new Error("2026 졸업학점 파싱 실패");
console.log("handbook data check: ok");

if (getLatestHandbookYear() !== 2026) throw new Error("최신 요람 자동 선택 실패");
if (getDepartmentCurriculum(2025, "컴퓨터공학과")?.handbookYear !== 2025)
  throw new Error("입학연도 요람 선택 실패");

const post = findHandbookPost([
  { BBS_SEQ: 1, SUBJECT: "2025학년도 학사 요람", FILE_CNT: 1, FILE_ORG_NM: "2025요람.pdf" },
  { BBS_SEQ: 2, SUBJECT: "2026학년도 학사 요람", FILE_CNT: 1, FILE_ORG_NM: "2026요람.pdf" },
], 2026);
if (post?.BBS_SEQ !== 2) throw new Error("게시판 요람 선택 실패");
