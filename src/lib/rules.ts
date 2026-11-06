export const RULE_SEQUENCE = 409;

export function parseRuleMetadata(view: string, content: string) {
  const history = view.match(/lawFullContent\.do\?SEQ=409(?:&|&amp;)SEQ_HISTORY=(\d+)/)?.[1];
  const label = content.match(/<div class="history">([\s\S]*?)<\/div>/)?.[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
  const date = label ? [...label.matchAll(/(\d{4})\.(\d{1,2})\.(\d{1,2})\./g)].at(-1) : undefined;
  if (!history || !label || !date) throw new Error("최신 학칙 개정 정보를 찾지 못했습니다.");
  return { sequence: RULE_SEQUENCE, history: Number(history), revisionLabel: label, revisionDate: `${date[1]}-${date[2].padStart(2, "0")}-${date[3].padStart(2, "0")}` };
}
