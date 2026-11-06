import { auditGraduation } from "./graduation.ts";
import type { Transcript } from "./transcript.ts";

const audit = auditGraduation({
  studentId: "202300001",
  name: "홍길동",
  department: "과학기술대학 ICT융합공학부 컴퓨터공학과",
  studentYear: 2,
  totalCredits: 62,
  gpa: 3.20,
  lastSemesterGpa: 3.50,
  courses: [
    { year: 2023, semester: "1학기", category: "전필", code: "NDGE05021", name: "컴퓨터공학개론", credits: 3, grade: "A+" },
    { year: 2026, semester: "1학기", category: "전선", code: "NDGE12137", name: "운영체제", credits: 3, grade: "A+" },
    { year: 2026, semester: "1학기", category: "소양", code: "BKSA67407", name: "군복무경험", credits: 1, grade: "P" },
  ],
} satisfies Transcript);

if (!audit || audit.credits.total !== 132) throw new Error("2023 컴퓨터공학과 요건 매칭 실패");
if (!audit.remainingRequired.some((course) => course.code === "NDGE15060")) throw new Error("미이수 전필 판정 실패");
if (audit.required.find((course) => course.code === "NDGE05021")?.currentType !== "elective") throw new Error("필수→선택 변경 판정 실패");
if (audit.earnedCredits.majorRequired !== 3 || audit.earnedCredits.majorElective !== 3)
  throw new Error("성적표 이수구분 우선 계산 실패");
if (audit.general.find((item) => item.label === "KU소양")?.details.find((item) => item.label === "인성")?.earned !== 1)
  throw new Error("군복무경험 인성영역 판정 실패");
if (audit.general.find((item) => item.label === "KU소양")?.details.find((item) => item.label === "인성")?.courses[0]?.name !== "군복무경험")
  throw new Error("세부영역 이수 과목 목록 실패");
console.log("graduation audit check: ok");
