import { courses, explainScheduleFailure, fillSchedule, findSchedules } from "./schedule.ts";

if (findSchedules([], { freeDays: ["금"], noMorning: true, lunch: true }).length)
  throw new Error("빈 과목 선택 처리 실패");

const results = findSchedules(courses, { freeDays: ["금"], noMorning: true, lunch: true });
if (!results.length || results.length > 5) throw new Error("가능한 상위 5개 이내 조합을 반환해야 합니다.");
if (results[0].courses.some((course) => course.day === "금")) throw new Error("금요일 공강 조합이 우선이어야 합니다.");
const fallback = findSchedules(courses.filter((course) => course.group === "os"), { freeDays: ["월", "금"], noMorning: false, lunch: false })[0];
if (!fallback || fallback.score >= 100 || !fallback.reasons.length) throw new Error("선호조건 미충족 대안 설명 실패");
if (!explainScheduleFailure(courses.filter((course) => course.group === "os"), { freeDays: ["월", "금"], noMorning: false, lunch: false }).blocked.includes("운영체제"))
  throw new Error("공강 요일 차단 사유 분석 실패");
if (fillSchedule(courses, new Set(["os"]), 6, { freeDays: [], noMorning: false, lunch: false }).size < 2)
  throw new Error("남은 학점 자동 채우기 실패");
const online = { id: "online-1", name: "이러닝", day: "월" as const, start: 0, end: 0, meetings: [], credits: 3, group: "online", color: 1, deliveryMode: "이러닝" as const };
if (!findSchedules([online], { freeDays: [], noMorning: false, lunch: false })[0]?.courses.includes(online))
  throw new Error("시간 미지정 이러닝 포함 실패");
const manySections = Array.from({ length: 12 }, (_, group) => Array.from({ length: 4 }, (_, section) => ({ id: `${group}-${section}`, name: `과목 ${group}`, day: ["월", "화", "수", "목", "금"][group % 5] as "월", start: 9 + section, end: 10 + section, credits: 3, group: `g${group}`, color: 1 }))).flat();
if (findSchedules(manySections, { freeDays: [], noMorning: false, lunch: false }).length > 5)
  throw new Error("대규모 분반 조합 상한 처리 실패");
const conflictingBasket = [
  { id: "a", name: "A", day: "월" as const, start: 9, end: 11, credits: 3, group: "a", color: 1 },
  { id: "b", name: "B", day: "월" as const, start: 10, end: 12, credits: 3, group: "b", color: 2 },
];
const alternatives = findSchedules(conflictingBasket, { freeDays: [], noMorning: false, lunch: false }, 18);
if (alternatives.length < 2 || alternatives.some((schedule) => schedule.courses.length !== 1)) throw new Error("충돌 과목 제외 대안 생성 실패");
const priorityFirst = findSchedules(conflictingBasket, { freeDays: [], noMorning: false, lunch: false, preferredCourses: ["b"], coursePriorities: { b: "1" } }, 18)[0];
if (priorityFirst?.courses[0]?.group !== "b") throw new Error("사용자 과목 우선순위 반영 실패");
if (findSchedules(conflictingBasket.map((course) => ({ ...course, fixed: true })), { freeDays: [], noMorning: false, lunch: false }, 18).length)
  throw new Error("필수 과목 충돌 하드 제약 실패");
console.log("schedule engine check: ok");
