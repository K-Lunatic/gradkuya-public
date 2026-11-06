import { decodeShare, encodeShare } from "./share.ts";

const source = { plannedGroups: ["A", "B"], preferredProfessors: ["홍길동"], freeDays: ["금"] };
const restored = await decodeShare<typeof source>(await encodeShare(source));
if (JSON.stringify(restored) !== JSON.stringify(source)) throw new Error("설정 공유 인코딩 실패");
console.log("share settings check: ok");
