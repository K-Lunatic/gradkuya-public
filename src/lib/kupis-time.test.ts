import { parseKupisTime } from "./kupis-time.ts";

if (parseKupisTime("2026-08-03 14:59:29") !== Date.UTC(2026, 7, 3, 5, 59, 29)) throw new Error("KUPIS KST 변환 실패");
if (parseKupisTime("invalid") !== null) throw new Error("KUPIS 시간 검증 실패");
console.log("kupis server time check: ok");
