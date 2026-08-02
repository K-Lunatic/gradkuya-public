export type Course = {
  id: string;
  name: string;
  day: "월" | "화" | "수" | "목" | "금";
  start: number;
  end: number;
  meetings?: { day: Course["day"]; start: number; end: number }[];
  credits: number;
  group: string;
  category?: string;
  professor?: string;
  fixed?: boolean;
  color: number;
};

export type Preferences = {
  freeDays: Course["day"][];
  noMorning: boolean;
  lunch: boolean;
  blockedSlots?: { day: Course["day"]; hour: number }[];
  preferredProfessors?: string[];
  avoidedProfessors?: string[];
  preferredCourses?: string[];
  preferredCategories?: string[];
};

export const courses: Course[] = [
  { id: "cs401", name: "캡스톤디자인", day: "화", start: 15, end: 18, credits: 3, group: "capstone", fixed: true, color: 4 },
  { id: "cs302a", name: "운영체제", day: "월", start: 10, end: 12, credits: 3, group: "os", color: 1 },
  { id: "cs302b", name: "운영체제", day: "금", start: 14, end: 16, credits: 3, group: "os", color: 1 },
  { id: "cs318a", name: "데이터베이스", day: "수", start: 13, end: 15, credits: 3, group: "db", color: 2 },
  { id: "cs318b", name: "데이터베이스", day: "월", start: 9, end: 11, credits: 3, group: "db", color: 2 },
  { id: "ge210", name: "기술과사회", day: "목", start: 10, end: 12, credits: 3, group: "society", color: 3 },
  { id: "ge211", name: "기술과사회", day: "금", start: 10, end: 12, credits: 3, group: "society", color: 3 },
  { id: "cs350", name: "웹프로그래밍", day: "수", start: 15, end: 17, credits: 3, group: "web", color: 5 },
  { id: "cs351", name: "웹프로그래밍", day: "목", start: 12, end: 14, credits: 3, group: "web", color: 5 },
];

export function findSchedules(allCourses: Course[], preferences: Preferences) {
  allCourses = allCourses.filter((course) => (course.meetings ?? [course]).every((meeting) => meeting.start > 0));
  if (!allCourses.length) return [];
  const groups = [...new Set(allCourses.map((course) => course.group))];
  let combinations: Course[][] = [[]];
  for (const group of groups) {
    const options = allCourses.filter((course) => course.group === group);
    combinations = combinations.flatMap((selected) => options.map((course) => [...selected, course]));
  }

  return combinations
    .filter((schedule) => !hasConflict(schedule))
    .map((schedule) => {
      const meetings = schedule.flatMap((course) => course.meetings ?? [course]);
      const lunchCount = meetings.filter((meeting) => meeting.start < 13 && meeting.end > 12).length;
      const preferredCount = schedule.filter((course) => course.professor && preferences.preferredProfessors?.includes(course.professor)).length;
      const preferredCourseCount = schedule.filter((course) => preferences.preferredCourses?.includes(course.group)).length;
      const preferredCategoryCount = schedule.filter((course) => course.category && preferences.preferredCategories?.includes(course.category)).length;
      const avoided = schedule.filter((course) => course.professor && preferences.avoidedProfessors?.includes(course.professor));
      const freeDayMeetings = meetings.filter((meeting) => preferences.freeDays.includes(meeting.day));
      const blockedMeetings = meetings.filter((meeting) => preferences.blockedSlots?.some((slot) => slot.day === meeting.day && meeting.start < slot.hour + 1 && meeting.end > slot.hour));
      const morningCount = preferences.noMorning ? meetings.filter((meeting) => meeting.start <= 9).length : 0;
      const reasons = [
        ...new Set(freeDayMeetings.map((meeting) => `${meeting.day}요일 공강 조건 미충족`)),
        ...blockedMeetings.map((meeting) => `${meeting.day}요일 ${Math.floor(meeting.start)}시 제외 시간과 겹침`),
        ...avoided.map((course) => `기피 교수 ${course.professor} 분반 포함`),
        ...(morningCount ? ["오전 9시 수업 포함"] : []),
        ...(preferences.lunch && lunchCount ? ["점심시간 수업 포함"] : []),
      ];
      const penalty = freeDayMeetings.length * 20 + blockedMeetings.length * 18 + avoided.length * 30 + morningCount * 15 + (preferences.lunch ? lunchCount * 12 : 0);
      const hasPositivePreferences = Boolean(preferences.preferredProfessors?.length || preferences.preferredCourses?.length || preferences.preferredCategories?.length);
      return {
        courses: schedule,
        credits: schedule.reduce((sum, course) => sum + course.credits, 0),
        score: Math.max(0, Math.min(100, (hasPositivePreferences ? 90 : 100) + preferredCount * 5 + preferredCourseCount * 5 + preferredCategoryCount * 3 - penalty)),
        preferenceHits: preferredCount + preferredCourseCount + preferredCategoryCount,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export function explainScheduleFailure(allCourses: Course[], preferences: Preferences) {
  const groups = [...new Set(allCourses.map((course) => course.group))];
  const names = new Map(groups.map((group) => [group, allCourses.find((course) => course.group === group)?.name ?? group]));
  const blocked = groups.filter((group) => allCourses.filter((course) => course.group === group).every((course) =>
    (course.meetings ?? [course]).some((meeting) =>
      (preferences.noMorning && meeting.start <= 9) || preferences.freeDays.includes(meeting.day)
      || Boolean(preferences.blockedSlots?.some((slot) => slot.day === meeting.day && meeting.start < slot.hour + 1 && meeting.end > slot.hour))
    )
  ));
  const conflicts: [string, string][] = [];
  for (let left = 0; left < groups.length; left++) for (let right = left + 1; right < groups.length; right++) {
    const a = allCourses.filter((course) => course.group === groups[left]);
    const b = allCourses.filter((course) => course.group === groups[right]);
    if (a.length && b.length && a.every((one) => b.every((two) => hasConflict([one, two]))))
      conflicts.push([names.get(groups[left])!, names.get(groups[right])!]);
  }
  const removable = groups.filter((group) =>
    findSchedules(allCourses.filter((course) => course.group !== group), preferences).length > 0
  ).map((group) => names.get(group)!);
  return { blocked: blocked.map((group) => names.get(group)!), conflicts, removable };
}

function hasConflict(schedule: Course[]) {
  const meetings = schedule.flatMap((course) => (course.meetings ?? [course]).map((meeting) => ({ ...meeting, course: course.id })));
  return meetings.some((meeting, index) => meetings.slice(index + 1).some((other) =>
    meeting.course !== other.course && meeting.day === other.day && meeting.start < other.end && other.start < meeting.end
  ));
}
