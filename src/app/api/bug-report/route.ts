const attempts = new Map<string, number>();
// ponytail: per-instance rate limit; use shared storage if abuse appears across instances.

export async function POST(request: Request) {
  const webhook = process.env.BUG_REPORT_DISCORD_WEBHOOK_URL;
  if (!webhook) return Response.json({ error: "버그 제보 채널이 아직 연결되지 않았습니다." }, { status: 503 });
  let url: URL;
  try {
    url = new URL(webhook);
    if (url.protocol !== "https:" || !["discord.com", "discordapp.com"].includes(url.hostname) || !url.pathname.startsWith("/api/webhooks/")) throw new Error();
  } catch {
    return Response.json({ error: "버그 제보 웹훅 설정을 확인해 주세요." }, { status: 503 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const now = Date.now();
  if (now - (attempts.get(ip) ?? 0) < 60_000) return Response.json({ error: "제보는 1분 후 다시 보낼 수 있습니다." }, { status: 429 });
  const body = await request.formData();
  const text = (key: string, max: number) => {
    const value = body.get(key);
    return typeof value === "string" ? value.trim().slice(0, max) : "";
  };
  const title = text("title", 100);
  const description = text("description", 1500);
  if (!title || !description) return Response.json({ error: "제목과 문제 설명을 입력해 주세요." }, { status: 400 });
  const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain"]);
  const files = body.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  if (files.length > 3 || files.some((file) => file.size > 5 * 1024 * 1024 || (!allowed.has(file.type) && !(file.type === "" && file.name.endsWith(".log")))))
    return Response.json({ error: "첨부파일은 이미지·PDF·텍스트만 가능하며 각각 5MB, 최대 3개입니다." }, { status: 400 });

  url.searchParams.set("wait", "true");
  const discordBody = new FormData();
  discordBody.append("payload_json", JSON.stringify({
    embeds: [{ title: `🐛 ${title}`, description, color: 0x006b4f, fields: [
      { name: "재현 방법", value: text("steps", 1000) || "미입력" },
      { name: "화면", value: text("page", 200) || "알 수 없음", inline: true },
      { name: "회신 연락처", value: text("contact", 100) || "미입력", inline: true },
      { name: "환경", value: text("userAgent", 500) || "알 수 없음" },
    ], timestamp: new Date().toISOString() }],
    allowed_mentions: { parse: [] },
  }));
  files.forEach((file, index) => discordBody.append(`files[${index}]`, file, file.name));
  const response = await fetch(url, {
    method: "POST", body: discordBody,
  });
  if (!response.ok) return Response.json({ error: "Discord 전송에 실패했습니다." }, { status: 502 });
  attempts.set(ip, now);
  return Response.json({ ok: true });
}
