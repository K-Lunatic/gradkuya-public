import { getAllCourses } from "@/lib/kupis";

export async function GET() {
  try {
    return Response.json(await getAllCourses());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "과목 조회에 실패했습니다." }, { status: 502 });
  }
}
