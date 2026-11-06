import { parseTranscript } from "./transcript.ts";

const result = parseTranscript(`
학번 202300001 성명 가상학생 학과 컴퓨터공학과 학년 4
총 취득학점 108 총 평균평점 4.17
2025학년도 2학기
전필 BKSA11049 자료구조 3.0 A+
`);
if (result.studentId !== "202300001" || result.name !== "가상학생") throw new Error("학생 정보 파싱 실패");
if (result.courses[0]?.code !== "BKSA11049" || result.courses[0]?.grade !== "A+") throw new Error("과목 파싱 실패");
if (result.courses[0]?.category !== "전필") throw new Error("이수구분 파싱 실패");
console.log("transcript parser check: ok");
