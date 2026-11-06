import { fillSchedule, type Course, type Preferences } from "../lib/schedule";

type Request = {
  courses: Course[]; fixedGroups: string[]; maxCredits: number; preferences: Preferences;
  required: string[]; lowGrades: string[]; needed: string[]; priorities: Record<string, string>;
};

self.onmessage = ({ data }: MessageEvent<Request>) => {
  const required = new Set(data.required), low = new Set(data.lowGrades), needed = new Set(data.needed);
  const priority = (course: Course) => data.priorities[course.group] === "!" ? 10_000 : data.priorities[course.group] ? (10 - Number(data.priorities[course.group])) * 200 : 0;
  const definitions = [
    { name: "최선 · 졸업 최우선", description: "남은 전공필수와 부족한 교양 세부영역을 먼저 채웁니다.", score: (course: Course) => priority(course) + Number(required.has(course.group)) * 100 + Number(needed.has(course.category ?? "")) * 60 },
    { name: "차선 · 균형형", description: "졸업요건, 재이수 가능 과목, 사용자 선호를 고르게 반영합니다.", score: (course: Course) => priority(course) + Number(required.has(course.group)) * 80 + Number(low.has(course.group)) * 60 + Number(needed.has(course.category ?? "")) * 45 },
    { name: "대안 · GPA 최우선", description: "이번 학기 개설된 C+ 이하 과목의 재이수 가능성을 가장 먼저 봅니다.", score: (course: Course) => priority(course) + Number(low.has(course.group)) * 100 + Number(required.has(course.group)) * 50 },
  ];
  const plans = definitions.map((definition, index) => {
    const groups = [...fillSchedule(data.courses.toSorted((a, b) => definition.score(b) - definition.score(a)), new Set(data.fixedGroups), data.maxCredits, data.preferences)];
    self.postMessage({ type: "progress", progress: Math.round((index + 1) / definitions.length * 100), label: `${definition.name} 계산 완료` });
    return { name: definition.name, description: definition.description, groups };
  });
  self.postMessage({ type: "done", plans });
};
