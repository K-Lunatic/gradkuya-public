import assert from "node:assert/strict";
import { courseRestriction, mergeCourseRows } from "./kupis.ts";

const base = { lec_no: "1", lec_nm: "자료구조", isu_nm: "전필", pnt: "3", lec_tm: "월 0900-1000", prof: "교수", haksu_id: "CS101", clss_no: "01", tlsn_lmt_rcnt: "30", tlsn_rcnt: "20", clse_fg: "0", params: "1@CS101@01", sourceMenu: "1", sourceLectCd: "A", shyr: "2" };
const merged = mergeCourseRows([{ ...base, sourceDepartment: "컴퓨터공학과" }, { ...base, isu_nm: "전선", sourceDepartment: "소프트웨어학과" }]);

assert.equal(merged.length, 1);
assert.deepEqual(merged[0].affiliations, [{ department: "컴퓨터공학과", category: "전필" }, { department: "소프트웨어학과", category: "전선" }]);
const areas = mergeCourseRows([{ ...base, isu_nm: "심화", sourceDepartment: "", sourceArea: "자연과학", sourceMenu: "12" }, { ...base, isu_nm: "심화", sourceDepartment: "", sourceArea: "문화예술", sourceMenu: "12" }]);
assert.deepEqual(areas[0].subcategories, ["자연과학", "문화예술"]);
assert.equal(courseRestriction({ lec_nm: "생활한국어", sugang_remk: "외국인 유학생 전용" }), "외국인·유학생 대상 과목");
assert.equal(courseRestriction({ lec_nm: "자료구조", sugang_remk: "" }), "");
console.log("kupis affiliation merge: ok");
