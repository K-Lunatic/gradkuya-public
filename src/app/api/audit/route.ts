import { createHmac, randomBytes } from "node:crypto";
import { extractPdfText } from "@/lib/pdf-server";
import { parseTranscript } from "@/lib/transcript";
import type { Transcript } from "@/lib/transcript";
import { auditGraduation } from "@/lib/graduation";
import { ensureHandbook } from "@/lib/handbooks";

const MAX_PDF_SIZE = 10 * 1024 * 1024;
const sessionSecret = process.env.SESSION_SECRET ?? randomBytes(32);

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.includes("application/json")) {
    const transcript = (await request.json().catch(() => null) as { transcript?: Transcript } | null)?.transcript;
    if (!transcript || typeof transcript.studentId !== "string" || typeof transcript.department !== "string" || !Array.isArray(transcript.courses) || transcript.courses.length > 500)
      return Response.json({ error: "저장된 성적 데이터가 올바르지 않습니다." }, { status: 400 });
    await ensureHandbook(transcript.admissionYear ?? Number(transcript.studentId.slice(0, 4)));
    return Response.json({ transcript, graduation: auditGraduation(transcript) });
  }
  const file = (await request.formData()).get("transcript");
  if (!(file instanceof File) || file.type !== "application/pdf")
    return Response.json({ error: "PDF 성적표만 업로드할 수 있습니다." }, { status: 400 });
  if (file.size > MAX_PDF_SIZE)
    return Response.json({ error: "PDF는 10MB 이하여야 합니다." }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
    return Response.json({ error: "올바른 PDF 파일이 아닙니다." }, { status: 400 });

  try {
    const result = await extractPdfText(bytes, true);
    const text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
    if (!text.trim())
      return Response.json({ error: "입력값이 없는 PDF입니다. 성적이 표시된 원본 PDF를 업로드해 주세요." }, { status: 422 });

    const transcript = parseTranscript(text);
    await ensureHandbook(Number(transcript.studentId.slice(0, 4)));
    const sessionId = createHmac("sha256", sessionSecret)
      .update(transcript.studentId).digest("hex");
    return Response.json({ transcript, graduation: auditGraduation(transcript) }, {
      headers: { "Set-Cookie": `gradkuya_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.NODE_ENV === "production" ? "; Secure" : ""}` },
    });
  } catch (error) {
    console.error("[api/audit] PDF analysis failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "PDF 분석에 실패했습니다." }, { status: 422 });
  }
}
