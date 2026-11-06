import assert from "node:assert/strict";
import { parseRuleMetadata } from "./rules.ts";

assert.deepEqual(parseRuleMetadata('<iframe src="/lmxsrv/law/lawFullContent.do?SEQ=409&SEQ_HISTORY=3723#">', '<div class="history">제정 1959.9.9. 221차 개정 2026.7.14.</div>'), {
  sequence: 409, history: 3723, revisionLabel: "제정 1959.9.9. 221차 개정 2026.7.14.", revisionDate: "2026-07-14",
});
console.log("rule metadata check: ok");
