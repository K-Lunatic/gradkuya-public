import { parseKupisTime } from "@/lib/kupis-time";

const TIME_URL = "https://kupis.kku.ac.kr/wsugang/jsp/check/timeCheck.jsp";

export async function GET() {
  try {
    const response = await fetch(`${TIME_URL}?fake=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
    const text = await response.text();
    const serverTime = parseKupisTime(text);
    if (!response.ok || serverTime === null) throw new Error("KUPIS 시간 응답 없음");
    return Response.json({ serverTime }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "KUPIS 서버 시각을 불러오지 못했습니다." }, { status: 502 });
  }
}
