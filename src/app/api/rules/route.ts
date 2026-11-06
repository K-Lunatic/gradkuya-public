import { NextResponse } from "next/server";
import { parseRuleMetadata, RULE_SEQUENCE } from "@/lib/rules";

const ORIGIN = "https://rule.konkuk.ac.kr";

export async function GET() {
  try {
    const view = await fetch(`${ORIGIN}/lmxsrv/law/lawFullView.do?SEQ=${RULE_SEQUENCE}`, { next: { revalidate: 86400 } }).then(requireText);
    const history = view.match(/lawFullContent\.do\?SEQ=409(?:&|&amp;)SEQ_HISTORY=(\d+)/)?.[1];
    if (!history) throw new Error("최신 개정번호를 찾지 못했습니다.");
    const content = await fetch(`${ORIGIN}/lmxsrv/law/lawFullContent.do?SEQ=${RULE_SEQUENCE}&SEQ_HISTORY=${history}`, { next: { revalidate: 86400 } }).then(requireText);
    return NextResponse.json({ ...parseRuleMetadata(view, content), checkedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "학칙 확인에 실패했습니다." }, { status: 502 });
  }
}

async function requireText(response: Response) {
  if (!response.ok) throw new Error(`학칙 서버 응답 오류 (${response.status})`);
  return response.text();
}
