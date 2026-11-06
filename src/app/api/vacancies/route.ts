import { getVacancies } from "@/lib/kupis";

export async function POST(request: Request) {
  try {
    const { targets } = await request.json() as { targets?: unknown };
    if (!Array.isArray(targets)) return Response.json({ error: "감시 대상을 확인해 주세요." }, { status: 400 });
    const valid = targets.filter((target): target is { menu: string; lectCd: string } =>
      Boolean(target && typeof target === "object" && "menu" in target && "lectCd" in target && typeof target.menu === "string" && typeof target.lectCd === "string")
    );
    return Response.json({ courses: await getVacancies(valid) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "빈자리 조회에 실패했습니다." }, { status: 502 });
  }
}
