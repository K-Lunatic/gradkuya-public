import { auditGraduation } from "@/lib/graduation";
import { getDepartmentNames, getHandbookYears } from "@/lib/handbooks";
import type { Transcript } from "@/lib/transcript";

export function GET() {
  const years = getHandbookYears();
  return Response.json({ years, departments: Object.fromEntries(years.map((year) => [year, getDepartmentNames(year)])) });
}

export async function POST(request: Request) {
  const body = await request.json() as { name?: unknown; admissionYear?: unknown; department?: unknown; studentYear?: unknown; semester?: unknown };
  const admissionYear = Number(body.admissionYear);
  const studentYear = Number(body.studentYear);
  const department = typeof body.department === "string" ? body.department.trim() : "";
  const semester = typeof body.semester === "string" ? body.semester : "";
  if (!getHandbookYears().includes(admissionYear) || !getDepartmentNames(admissionYear).includes(department) || ![1, 2, 3, 4].includes(studentYear) || !["1학기", "2학기"].includes(semester))
    return Response.json({ error: "입학연도, 학과, 학년과 학기를 확인해 주세요." }, { status: 400 });
  const transcript: Transcript = {
    studentId: `${admissionYear}-freshman`, name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : "새내기",
    department, studentYear, totalCredits: 0, gpa: 0, lastSemesterGpa: 0, courses: [],
    provisional: true, admissionYear, currentSemester: semester,
  };
  return Response.json({ transcript, graduation: auditGraduation(transcript) });
}
