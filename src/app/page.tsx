"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { explainScheduleFailure, findSchedules, type Course, type Preferences } from "@/lib/schedule";
import type { Transcript } from "@/lib/transcript";
import { decodeShare, encodeShare } from "@/lib/share";

type GraduationAudit = {
  remainingRequired: { code: string; name: string; credits: number; note: string }[];
  credits: { total: number; majorRequired: number; majorElective: number } | null;
  earnedCredits: { total: number; basic: number; advanced: number; ku: number; majorRequired: number; majorElective: number; other: number };
  general: {
    label: string; required: number; earned: number; minimumAreas?: number; completedAreas: number;
    details: { label: string; required: number; earned: number; courses: { code: string; name: string; credits: number; grade: string; year: number; semester: string }[] }[];
  }[];
  allowedCourseCodes: string[];
};

type GeneralRequirement = GraduationAudit["general"][number];

function requirementKey(category: string, detail: string) { return `${category}::${detail}`; }
function generalProgress(item: GeneralRequirement, overrides: Set<string>) {
  const earned = item.earned + item.details.reduce((sum, detail) => sum + (overrides.has(requirementKey(item.label, detail.label)) ? Math.max(0, detail.required - detail.earned) : 0), 0);
  const completedAreas = item.details.filter((detail) => detail.required > 0 && (detail.earned > 0 || overrides.has(requirementKey(item.label, detail.label)))).length;
  return { earned, completedAreas, satisfied: earned >= item.required && completedAreas >= (item.minimumAreas ?? 0) };
}

function sameDepartment(left: string, right: string) {
  const normalize = (value: string) => value.replace(/\s/g, "").replace(/학부$/, "");
  return Boolean(left && right && (normalize(left).includes(normalize(right)) || normalize(right).includes(normalize(left))));
}

const tabs = ["대시보드", "졸업 요건", "GPA 부스터", "시간표 설계", "수강신청"];
const SESSION_KEY = "gradkuya-session";
const RULE_CACHE_KEY = "gradkuya-rule-meta";
const RULE_CHECK_INTERVAL = 24 * 60 * 60 * 1000;

export default function Home() {
  const [activeTab, setActiveTab] = useState("대시보드");
  const [freeDays, setFreeDays] = useState<Course["day"][]>([]);
  const [blockedSlots, setBlockedSlots] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [profile, setProfile] = useState<Transcript | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [liveCourses, setLiveCourses] = useState<DisplayCourse[]>([]);
  const [catalogYear, setCatalogYear] = useState("");
  const [graduation, setGraduation] = useState<GraduationAudit | null>(null);
  const [selectedSchedule, setSelectedSchedule] = useState(false);
  const [plannedGroups, setPlannedGroups] = useState<Set<string>>(new Set());
  const [scheduleIndex, setScheduleIndex] = useState(0);
  const [preferredProfessors, setPreferredProfessors] = useState<string[]>([]);
  const [avoidedProfessors, setAvoidedProfessors] = useState<string[]>([]);
  const [coursePriorities, setCoursePriorities] = useState<Record<string, string>>({});
  const [watchedGroups, setWatchedGroups] = useState<Set<string>>(new Set());
  const [preferredCategories, setPreferredCategories] = useState<string[]>([]);
  const [requirementOverrides, setRequirementOverrides] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [fillAreas, setFillAreas] = useState<Set<string>>(new Set(["내 전공", "교양"]));
  const [strategyPlans, setStrategyPlans] = useState<{ name: string; description: string; groups: string[] }[]>([]);
  const [ruleMeta, setRuleMeta] = useState<{ revisionDate: string; history: number; checkedAt: string } | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<DisplayCourse | null>(null);
  const [confirmedSections, setConfirmedSections] = useState<Record<string, string>>({});
  const [loadedSections, setLoadedSections] = useState<Record<string, string>>({});
  const [savedSchedules, setSavedSchedules] = useState<{ name: string; courseIds: string[] }[]>([]);
  const [excludedGroups, setExcludedGroups] = useState<Set<string>>(new Set());
  const [eligibilityOverrides, setEligibilityOverrides] = useState<Set<string>>(new Set());
  const [strategyProgress, setStrategyProgress] = useState<number | null>(null);
  const [strategyStatus, setStrategyStatus] = useState("");
  const [recommendationChoice, setRecommendationChoice] = useState(false);
  const [share, setShare] = useState<{ url: string; qr: string } | null>(null);
  const strategyWorker = useRef<Worker | null>(null);
  const maxCredits = (profile?.lastSemesterGpa ?? 0) >= 3.7 ? 21 : 18;

  const preferences: Preferences = {
    freeDays, noMorning: false, lunch: false, preferredProfessors, avoidedProfessors,
    preferredCourses: Object.keys(coursePriorities), coursePriorities, preferredCategories,
    blockedSlots: [...blockedSlots].map((slot) => ({ day: slot.slice(0, 1) as Course["day"], hour: Number(slot.slice(2)) })),
  };
  const candidates = liveCourses.filter((course) => plannedGroups.has(course.group) && !excludedGroups.has(course.group) && (!course.restriction || eligibilityOverrides.has(course.group)) && (!confirmedSections[course.group] || confirmedSections[course.group] === course.id) && (!loadedSections[course.group] || loadedSections[course.group] === course.id)).map((course) => ({ ...course, fixed: Boolean(confirmedSections[course.group]) || coursePriorities[course.group] === "!" }));
  const schedules = findSchedules(candidates, preferences, maxCredits);
  const best = schedules[scheduleIndex] ?? schedules[0];
  const exemptCredits = best?.courses.filter((course) => /Nano-LAB|K-Project/i.test(course.name)).reduce((sum, course) => sum + course.credits, 0) ?? 0;
  const countedCredits = (best?.credits ?? 0) - exemptCredits;
  const failure = candidates.length && !best ? explainScheduleFailure(candidates, preferences) : null;
  const totalRequired = graduation?.credits?.total ?? 0;
  const graduationRate = totalRequired ? Math.min(100, Math.round((profile?.totalCredits ?? 0) / totalRequired * 100)) : 0;
  const semesterStats = profile ? getSemesterStats(profile) : [];
  const hasGradedCourses = profile?.courses.some((course) => ["A+", "A", "B+", "B", "C+", "C", "D+", "D", "F"].includes(course.grade)) ?? false;
  const unmetRequirementCount = graduation
    ? graduation.remainingRequired.length + graduation.general.filter((item) => !generalProgress(item, requirementOverrides).satisfied).length
    : 0;

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const cachedRule = JSON.parse(localStorage.getItem(RULE_CACHE_KEY) ?? "null");
        if (cachedRule) setRuleMeta(cachedRule);
        const saved = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
        if (saved?.profile && saved?.graduation) {
          const hasCourseDetails = saved.graduation.general?.every((item: GeneralRequirement) => item.details?.every((detail) => Array.isArray(detail.courses)));
          let restoredGraduation = saved.graduation;
          if (!hasCourseDetails) {
            const response = await fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: saved.profile }) });
            if (response.ok) restoredGraduation = (await response.json()).graduation;
          }
          setProfile(saved.profile); setGraduation(restoredGraduation); setFileName(saved.fileName ?? "");
          setPlannedGroups(new Set(saved.plannedGroups ?? [])); setCoursePriorities(saved.coursePriorities ?? Object.fromEntries((saved.preferredGroups ?? []).map((group: string) => [group, "5"]))); setWatchedGroups(new Set(saved.watchedGroups ?? []));
          setPreferredProfessors(saved.preferredProfessors ?? []); setAvoidedProfessors(saved.avoidedProfessors ?? []); setPreferredCategories(saved.preferredCategories ?? []);
          setFreeDays(saved.freeDays ?? []); setBlockedSlots(new Set(saved.blockedSlots ?? [])); setRequirementOverrides(loadRequirementOverrides(saved.profile.studentId));
          setConfirmedSections(saved.confirmedSections ?? {}); setSavedSchedules(saved.savedSchedules ?? []);
          setExcludedGroups(new Set(saved.excludedGroups ?? []));
          setEligibilityOverrides(new Set(saved.eligibilityOverrides ?? []));
        }
        const token = new URL(location.href).hash.match(/^#share=([\w-]+)$/)?.[1];
        if (token) {
          const shared = await decodeShare<Record<string, unknown>>(token);
          const strings = (key: string) => Array.isArray(shared[key]) ? (shared[key] as unknown[]).filter((value): value is string => typeof value === "string") : [];
          const record = (key: string) => shared[key] && typeof shared[key] === "object" && !Array.isArray(shared[key]) ? Object.fromEntries(Object.entries(shared[key]).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
          if (shared.v !== 1) throw new Error("지원하지 않는 공유 코드입니다.");
          setPlannedGroups(new Set(strings("plannedGroups"))); setCoursePriorities(record("coursePriorities")); setWatchedGroups(new Set(strings("watchedGroups")));
          setPreferredProfessors(strings("preferredProfessors")); setAvoidedProfessors(strings("avoidedProfessors")); setPreferredCategories(strings("preferredCategories"));
          setFreeDays(strings("freeDays").filter((day): day is Course["day"] => ["월", "화", "수", "목", "금"].includes(day))); setBlockedSlots(new Set(strings("blockedSlots"))); setConfirmedSections(record("confirmedSections"));
          setSavedSchedules(Array.isArray(shared.savedSchedules) ? (shared.savedSchedules as { name?: unknown; courseIds?: unknown }[]).filter((item): item is { name: string; courseIds: string[] } => typeof item?.name === "string" && Array.isArray(item.courseIds) && item.courseIds.every((id) => typeof id === "string")) : []); setExcludedGroups(new Set(strings("excludedGroups"))); setEligibilityOverrides(new Set(strings("eligibilityOverrides")));
          history.replaceState(null, "", location.pathname + location.search);
        }
      } catch { localStorage.removeItem(SESSION_KEY); }
      setSessionRestored(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!sessionRestored) return;
    const checkedAt = Date.parse(ruleMeta?.checkedAt ?? "");
    if (Number.isFinite(checkedAt) && Date.now() - checkedAt < RULE_CHECK_INTERVAL) return;
    fetch("/api/rules").then((response) => response.ok ? response.json() : Promise.reject())
      .then((metadata) => { setRuleMeta(metadata); localStorage.setItem(RULE_CACHE_KEY, JSON.stringify(metadata)); })
      .catch(() => undefined);
  }, [sessionRestored, ruleMeta?.checkedAt]);

  useEffect(() => {
    if (!sessionRestored || !profile || !graduation) return;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ profile, graduation, fileName, plannedGroups: [...plannedGroups], coursePriorities, watchedGroups: [...watchedGroups], preferredProfessors, avoidedProfessors, preferredCategories, freeDays, blockedSlots: [...blockedSlots], confirmedSections, savedSchedules, excludedGroups: [...excludedGroups], eligibilityOverrides: [...eligibilityOverrides] }));
  }, [sessionRestored, profile, graduation, fileName, plannedGroups, coursePriorities, watchedGroups, preferredProfessors, avoidedProfessors, preferredCategories, freeDays, blockedSlots, confirmedSections, savedSchedules, excludedGroups, eligibilityOverrides]);

  function toggleRequirementOverride(label: string) {
    const next = new Set(requirementOverrides);
    if (next.has(label)) next.delete(label); else next.add(label);
    setRequirementOverrides(next);
    localStorage.setItem(`requirement-overrides:${profile?.studentId}`, JSON.stringify([...next]));
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY); localStorage.removeItem("vacancy-alerts"); localStorage.removeItem("discord-alerts");
    if (profile) localStorage.removeItem(`requirement-overrides:${profile.studentId}`);
    setProfile(null); setGraduation(null); setFileName(""); setLiveCourses([]); setPlannedGroups(new Set()); setCoursePriorities({}); setWatchedGroups(new Set());
    setPreferredProfessors([]); setAvoidedProfessors([]); setPreferredCategories([]); setFreeDays([]); setBlockedSlots(new Set()); setRequirementOverrides(new Set()); setActiveTab("대시보드");
    setConfirmedSections({}); setLoadedSections({}); setSavedSchedules([]); setExcludedGroups(new Set()); setEligibilityOverrides(new Set());
    setLogoutConfirm(false);
  }

  function toggleExcluded(group: string) {
    const next = new Set(excludedGroups);
    if (next.has(group)) next.delete(group); else {
      next.add(group);
      setPlannedGroups((before) => { const value = new Set(before); value.delete(group); return value; });
      setCoursePriorities((before) => { const value = { ...before }; delete value[group]; return value; });
      setConfirmedSections((before) => { const value = { ...before }; delete value[group]; return value; });
      setLoadedSections((before) => { const value = { ...before }; delete value[group]; return value; });
    }
    setExcludedGroups(next);
  }

  function toggleEligibilityOverride(group: string) {
    setEligibilityOverrides((before) => { const next = new Set(before); if (next.has(group)) next.delete(group); else next.add(group); return next; });
  }

  async function openShare() {
    const token = await encodeShare({ v: 1, plannedGroups: [...plannedGroups], coursePriorities, watchedGroups: [...watchedGroups], preferredProfessors, avoidedProfessors, preferredCategories, freeDays, blockedSlots: [...blockedSlots], confirmedSections, savedSchedules, excludedGroups: [...excludedGroups], eligibilityOverrides: [...eligibilityOverrides] });
    const url = `${location.origin}${location.pathname}#share=${token}`;
    const { default: QRCode } = await import("qrcode");
    setShare({ url, qr: await QRCode.toDataURL(url, { width: 320, margin: 2, color: { dark: "#0d4d3a", light: "#ffffff" } }) });
  }

  function recommendStrategies(resetInputs = false) {
    const activeGroups = resetInputs ? new Set(Object.keys(confirmedSections)) : plannedGroups;
    const activeAreas = resetInputs ? new Set(["내 전공", "교양"]) : fillAreas;
    const activePriorities: Record<string, string> = resetInputs ? {} : coursePriorities;
    const activePreferences: Preferences = resetInputs ? { freeDays: [], noMorning: false, lunch: false, preferredProfessors: [], avoidedProfessors: [], preferredCourses: [], coursePriorities: {}, preferredCategories: [], blockedSlots: [] } : preferences;
    if (resetInputs) {
      setPlannedGroups(activeGroups); setFillAreas(activeAreas); setCoursePriorities({}); setFreeDays([]); setBlockedSlots(new Set()); setPreferredProfessors([]); setAvoidedProfessors([]); setPreferredCategories([]); setLoadedSections({});
    }
    const allowed = liveCourses.filter((course) => activeGroups.has(course.group) || (() => {
      if (course.category === "교직") return activeAreas.has("교직");
      if (["기초", "심화", "소양", "일교"].includes(course.category ?? "")) return activeAreas.has("교양");
      if (course.affiliations?.some((item) => sameDepartment(item.department, profile?.department ?? ""))) return activeAreas.has("내 전공");
      if (["9", "10"].includes(course.sourceMenu ?? "")) return activeAreas.has("융합·특수전공");
      return activeAreas.has("타 전공");
    })()).filter((course) => !excludedGroups.has(course.group) && (!course.restriction || eligibilityOverrides.has(course.group)) && (!confirmedSections[course.group] || confirmedSections[course.group] === course.id));
    const required = new Set(graduation?.remainingRequired.map((item) => item.code));
    const lowGrades = new Set(profile?.courses.filter((item) => ["C+", "C", "D+", "D", "F"].includes(item.grade)).map((item) => item.code));
    const needed = new Set<string>(graduation?.general.filter((item) => !generalProgress(item, requirementOverrides).satisfied).map((item) => item.label === "기초교양" ? "기초" : item.label === "심화교양" ? "심화" : "소양"));
    strategyWorker.current?.terminate();
    const worker = new Worker(new URL("../workers/schedule.worker.ts", import.meta.url), { type: "module" });
    strategyWorker.current = worker; setStrategyProgress(0); setStrategyStatus("과목 후보 정리 중");
    worker.onmessage = (event: MessageEvent<{ type: string; progress?: number; label?: string; plans?: typeof strategyPlans }>) => {
      if (event.data.type === "progress") { setStrategyProgress(event.data.progress ?? 0); setStrategyStatus(event.data.label ?? "조합 계산 중"); }
      if (event.data.type === "done") { setStrategyPlans(event.data.plans ?? []); setStrategyProgress(null); setStrategyStatus(""); worker.terminate(); strategyWorker.current = null; }
    };
    worker.onerror = () => { setStrategyProgress(null); setStrategyStatus("추천 계산에 실패했습니다. 다시 시도해 주세요."); worker.terminate(); strategyWorker.current = null; };
    worker.postMessage({ courses: allowed.map((course) => ({ ...course, fixed: Boolean(confirmedSections[course.group]) || activePriorities[course.group] === "!" })), fixedGroups: [...activeGroups], maxCredits, preferences: activePreferences, required: [...required], lowGrades: [...lowGrades], needed: [...needed], priorities: activePriorities });
  }

  function requestRecommendations() {
    const hasInputs = plannedGroups.size > Object.keys(confirmedSections).length || Object.keys(coursePriorities).length > 0 || freeDays.length > 0 || blockedSlots.size > 0 || preferredProfessors.length > 0 || avoidedProfessors.length > 0 || preferredCategories.length > 0 || fillAreas.size !== 2 || !fillAreas.has("내 전공") || !fillAreas.has("교양");
    if (hasInputs) setRecommendationChoice(true); else recommendStrategies();
  }

  useEffect(() => () => strategyWorker.current?.terminate(), []);

  useEffect(() => {
    if (!profile) return;
    fetch("/api/courses").then((response) => response.ok ? response.json() : Promise.reject())
      .then((result) => { setLiveCourses(result.courses); setCatalogYear(result.year); })
      .catch(() => setLiveCourses([]));
  }, [profile]);

  async function uploadTranscript(file?: File) {
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const body = new FormData();
      body.append("transcript", file);
      const response = await fetch("/api/audit", { method: "POST", body });
      const text = await response.text();
      const result = text.startsWith("{") ? JSON.parse(text) : { error: `서버가 분석 요청을 처리하지 못했습니다. (${response.status})` };
      if (response.ok) {
        setFileName(file.name);
        setProfile(result.transcript);
        setGraduation(result.graduation);
        setRequirementOverrides(loadRequirementOverrides(result.transcript.studentId));
      } else setUploadError(result.error ?? "PDF 분석에 실패했습니다.");
    } catch {
      setUploadError("서버와 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setUploading(false);
    }
  }

  async function startFreshman(data: { name: string; admissionYear: number; department: string; studentYear: number; semester: string }) {
    const response = await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "정보를 확인해 주세요.");
    setProfile(result.transcript);
    setGraduation(result.graduation);
    setRequirementOverrides(loadRequirementOverrides(result.transcript.studentId));
  }

  if (!profile) return <PdfStart uploading={uploading} error={uploadError} upload={uploadTranscript} startFreshman={startFreshman} />;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">G</div>
          <div><strong>졸업할KU야</strong><span>졸업, 이제 확실하게</span></div>
        </div>
        <nav>
          <p>WORKSPACE</p>
          {tabs.map((tab, index) => (
            <button className={activeTab === tab ? "active" : ""} key={tab} onClick={() => setActiveTab(tab)}>
              <span>{["⌂", "◫", "↗", "▦", "⚡"][index]}</span>{tab}
              {tab === "졸업 요건" && unmetRequirementCount > 0 && <i>{unmetRequirementCount}</i>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile">
            <div className="avatar">{profile.name.slice(0, 1)}</div>
            <div><b>{profile.name}</b><small>{profile.department || "소속 정보 없음"} · {profile.provisional ? "학번 발급 전" : profile.studentId}</small></div>
            <button className="logout-button" onClick={() => setLogoutConfirm(true)}>로그아웃</button>
          </div>
        </div>
      </aside>

      <section className="content">
        <header>
          <div>
            <p>{catalogYear ? `${catalogYear}학년도 수강편람` : "수강편람 불러오는 중"}</p>
            <h1>안녕하세요, {profile.name}님 <span>👋</span></h1>
            <small>성적표에 기록된 {profile.courses.length}과목·{profile.totalCredits}학점을 기준으로 분석했습니다.</small>
            {ruleMeta && <small className="rule-status">학칙 {ruleMeta.revisionDate.replaceAll("-", ".")} 개정본 · 최근 확인 {new Date(ruleMeta.checkedAt).toLocaleDateString("ko-KR")}</small>}
          </div>
          <div className="header-actions">
            <ServerClock />
            <VacancyAlerts watched={watchedGroups} courses={liveCourses} />
            <button className="manual-button" onClick={openShare}>설정 공유</button>
            <button className="manual-button" onClick={() => setManual(true)}>사용 안내</button>
            <label className="primary-button">
              {uploading ? "분석 중..." : fileName ? "분석 완료" : "성적표 업로드"}
              <input type="file" accept="application/pdf" onChange={(event) => uploadTranscript(event.target.files?.[0])} />
            </label>
          </div>
        </header>
        <nav className="journey-bar" aria-label="추천 이용 순서">
          {[{ label: "성적 분석", tab: "대시보드" }, { label: "요건 확인", tab: "졸업 요건" }, { label: "과목 담기", tab: "수강신청" }, { label: "시간표 완성", tab: "시간표 설계" }].map((step, index) => <button className={activeTab === step.tab ? "active" : index === 0 || (index === 1 && graduation) || (index === 2 && plannedGroups.size) || (index === 3 && selectedSchedule) ? "done" : ""} key={step.tab} onClick={() => setActiveTab(step.tab)}><i>{index + 1}</i><span>{step.label}</span></button>)}
        </nav>
        <Modal open={manual} title="GradKUya 사용 안내" close={() => setManual(false)}><ol className="pdf-guide"><li><b>성적표 분석</b><span>전체 성적조회 PDF를 올리면 실제 이수 학점과 입학연도 요람을 기준으로 남은 요건을 계산합니다.</span></li><li><b>졸업 요건 확인</b><span>영역별 학점과 세부영역, 남은 전공필수를 확인합니다.</span></li><li><b>바구니 구성</b><span>이번 학기 과목을 담고 별표를 눌러 빈자리를 확인할 관심 과목을 지정합니다.</span></li><li><b>시간표 설계</b><span>요일이나 시간 칸을 눌러 피하고 싶은 시간을 정하면 상위 5개 조합과 감점 사유가 표시됩니다.</span></li><li><b>Discord 빈자리 알림</b><span>상단 Discord 버튼에서 웹훅을 연결하면 데스크톱이 감지한 빈자리 정보를 모바일 Discord로 받을 수 있습니다.</span></li></ol></Modal>
        <Modal open={Boolean(share)} title="플래너 설정 공유" close={() => setShare(null)}>{share && <div className="share-settings"><Image unoptimized width={320} height={320} src={share.qr} alt="플래너 설정 공유 QR 코드" /><div><b>공유 코드</b><code>{share.url.split("#share=")[1].slice(0, 12)}…</code></div><p>QR을 스캔하거나 링크를 열면 바구니·우선순위·교수·시간·제외 설정을 이 기기에 적용합니다. 성적과 개인정보는 포함하지 않습니다.</p><button onClick={async () => { await navigator.clipboard.writeText(share.url); }}>공유 링크 복사</button>{typeof navigator.share === "function" && <button className="secondary" onClick={() => navigator.share({ title: "GradKUya 플래너 설정", url: share.url })}>다른 앱으로 공유</button>}</div>}</Modal>
        <Modal open={logoutConfirm} title="저장된 정보를 초기화할까요?" close={() => setLogoutConfirm(false)}><div className="confirm-dialog"><span className="confirm-icon">!</span><p>성적 분석, 바구니, 시간표 조건, 관심 과목과 Discord 연동 정보가 이 기기에서 삭제됩니다.</p><div><button onClick={() => setLogoutConfirm(false)}>계속 사용</button><button className="danger" onClick={logout}>초기화하고 로그아웃</button></div></div></Modal>
        <Modal open={strategyPlans.length > 0} title="추천 전략 선택" close={() => setStrategyPlans([])}><div className="strategy-plans">{strategyPlans.map((plan, index) => { const names = [...new Set(liveCourses.filter((course) => plan.groups.includes(course.group)).map((course) => course.name))]; return <article key={plan.name}><span>{index + 1}순위</span><h3>{plan.name}</h3><p>{plan.description}</p><small>고정 포함 {plan.groups.length}과목 · {names.slice(0, 5).join(" · ")}{names.length > 5 ? ` 외 ${names.length - 5}과목` : ""}</small><button onClick={() => { setPlannedGroups(new Set(plan.groups)); setLoadedSections({}); setStrategyPlans([]); setScheduleIndex(0); setActiveTab("시간표 설계"); }}>이 전략으로 시간표 만들기</button></article>; })}</div></Modal>
        <Modal open={recommendationChoice} title="현재 설정을 어떻게 반영할까요?" close={() => setRecommendationChoice(false)}><div className="recommendation-choice"><p>바구니, 과목 우선순위 또는 시간·교수 선호가 설정되어 있습니다.</p><button onClick={() => { setRecommendationChoice(false); recommendStrategies(false); }}><b>현재 설정 유지하고 추가 추천</b><span>기존 바구니와 1–9/! 우선순위, 공강·교수 조건을 반영합니다.</span></button><button onClick={() => { setRecommendationChoice(false); recommendStrategies(true); }}><b>선호 설정 초기화 후 새로 추천</b><span>확정 분반, 제외 과목, 수강대상 예외는 보존하고 나머지 조건을 초기화합니다.</span></button></div></Modal>

        {activeTab === "졸업 요건" && <GraduationView graduation={graduation} profile={profile} courses={liveCourses} overrides={requirementOverrides} toggleOverride={toggleRequirementOverride} />}
        {activeTab === "GPA 부스터" && <GpaView profile={profile} courses={liveCourses} planned={plannedGroups} setPlanned={setPlannedGroups} openPlanner={() => setActiveTab("시간표 설계")} />}
        {activeTab === "수강신청" && <CourseView courses={liveCourses} department={profile.department} required={graduation?.remainingRequired.map((course) => course.code) ?? []} completed={profile.courses.map((course) => course.code)} planned={plannedGroups} setPlanned={setPlannedGroups} watched={watchedGroups} setWatched={setWatchedGroups} excluded={excludedGroups} toggleExcluded={toggleExcluded} eligibilityOverrides={eligibilityOverrides} toggleEligibilityOverride={toggleEligibilityOverride} />}

        <section className="hero-grid" hidden={activeTab !== "대시보드"}>
          <article className="graduation-card">
            <div className="card-heading">
              <div>
                <p className="eyebrow">GRADUATION PROGRESS</p>
                <h2>졸업 준비 현황</h2>
              </div>
              <span className="status-badge">{graduation ? (graduation.remainingRequired.length ? "남은 요건 있음" : "전공필수 충족") : "요람 확인 필요"}</span>
            </div>
            <div className="progress-row">
              <div className="ring" style={{ background: `conic-gradient(var(--green) ${graduationRate}%,#edf0f5 0)` }}><span><strong>{graduationRate}</strong>%<small>이수율</small></span></div>
              <div className="credit-progress">
                <div><span>총 이수 학점</span><b>{profile.totalCredits || 0} <small>{totalRequired ? `/ ${totalRequired}학점` : "· 졸업학점 확인 필요"}</small></b></div>
                <div className="bar"><i style={{ width: `${graduationRate}%` }} /></div>
                <p><span>전공필수 <b>{graduation?.earnedCredits.majorRequired ?? 0} / {graduation?.credits?.majorRequired ?? 0}</b></span><span>전공선택 <b>{graduation?.earnedCredits.majorElective ?? 0} / {graduation?.credits?.majorElective ?? 0}</b></span><span>교양 <b>{(graduation?.earnedCredits.basic ?? 0) + (graduation?.earnedCredits.advanced ?? 0) + (graduation?.earnedCredits.ku ?? 0)} / {graduation?.general.reduce((sum, item) => sum + item.required, 0) ?? 0}</b></span></p>
              </div>
            </div>
            <div className="alert">
              <span>!</span><div><b>{graduation ? `전공필수 ${graduation.remainingRequired.length}과목이 남았어요` : "졸업요건 요람을 확인해 주세요"}</b><small>{graduation ? (graduation.remainingRequired.map((course) => course.name).join(" · ") || "입학연도 전공필수 요건을 충족했습니다") : `${profile.studentId.slice(0, 4)}학년도 ${profile.department || "소속 학과"} 데이터가 필요합니다.`}</small></div><button onClick={() => setActiveTab("졸업 요건")}>자세히 보기 →</button>
            </div>
          </article>

          <article className="gpa-card">
            <div className="card-heading"><div><p className="eyebrow">MY GPA</p><h2>전체 평점</h2></div><button onClick={() => setActiveTab("GPA 부스터")}>↗</button></div>
            <div className="gpa-value"><strong>{hasGradedCourses ? profile.gpa.toFixed(2) : "평점 없음"}</strong>{hasGradedCourses && <span>/ 4.5</span>}<em>{profile.courses.length ? `${profile.courses.length}과목 분석` : "수강 이력 없음"}</em></div>
            <div className="mini-chart">{semesterStats.length
              ? semesterStats.map((semester) => <i title={`${semester.label} · ${semester.gpa === null ? "평점 대상 없음" : semester.gpa.toFixed(2)}`} key={semester.key} style={{ height: `${semester.gpa === null ? 8 : Math.max(8, semester.gpa / 4.5 * 100)}%` }} />)
              : <span>성적표에서 학기별 평점을 찾지 못했습니다.</span>}
            </div>
            <div className="semester-row">{semesterStats.map((semester) => <span key={semester.key}>{semester.label}</span>)}</div>
            <div className="limit"><span>{profile.lastSemesterGpa ? "직전학기 평점 기준" : "직전학기 평점 없음 · 기본"} 신청 가능 학점</span><b>{maxCredits}학점</b></div>
          </article>
        </section>

        <section className="section-title" hidden={!["대시보드", "시간표 설계"].includes(activeTab)}>
          <div><h2>이번 학기 스마트 플래너</h2><p>{best ? "선택한 과목과 선호도를 반영한 조합입니다." : "과목을 선택하면 가능한 시간표를 계산합니다."}</p></div>
          <button onClick={() => setActiveTab("시간표 설계")}>전체 조합 보기 →</button>
        </section>
        <ol className="planner-guide" hidden={!["대시보드", "시간표 설계"].includes(activeTab)}><li><b>과목 담기</b><span>카테고리를 열어 후보를 바구니에 담아요.</span></li><li><b>선호 설정</b><span>별표·교수·영역으로 추천 점수를 조정해요.</span></li><li><b>시간 비우기</b><span>요일 또는 시간 칸을 눌러 제외해요.</span></li><li><b>조합 선택</b><span>점수와 감점 사유를 보고 확정해요.</span></li></ol>

        <section className="planner-grid" hidden={!["대시보드", "시간표 설계"].includes(activeTab)}>
          <article className="preference-card">
            <div className="card-heading"><div><p className="eyebrow">PREFERENCES</p><h2>내 시간표 조건</h2></div></div>
            <fieldset className="auto-fill"><legend>꼭 들을 과목 + 남은 학점</legend><p>성적과 졸업요건으로 최대 {maxCredits}학점까지 전략별 최적 조합을 만듭니다. 입력한 조건이 있으면 유지하거나 초기화할 수 있습니다.</p><div>{["내 전공", "교양", "타 전공", "융합·특수전공", "교직"].map((area) => <button type="button" aria-pressed={fillAreas.has(area)} className={fillAreas.has(area) ? "active" : ""} key={area} onClick={() => setFillAreas((before) => { const next = new Set(before); if (next.has(area)) next.delete(area); else next.add(area); return next; })}>{fillAreas.has(area) ? "✓ " : ""}{area}</button>)}</div><small>타 전공·융합·교직은 소속, 선이수, 승인 조건을 직접 확인해야 합니다.</small>{strategyProgress !== null && <div className="strategy-progress" role="status" aria-live="polite"><span><b>{strategyStatus}</b><small>{strategyProgress}%</small></span><i><b style={{ width: `${strategyProgress}%` }} /></i></div>}{strategyProgress === null && strategyStatus && <small className="strategy-error">{strategyStatus}</small>}<button type="button" className="fill-button" disabled={strategyProgress !== null} onClick={requestRecommendations}>{strategyProgress !== null ? "백그라운드 계산 중…" : "전략별 자동 추천 시작"}</button></fieldset>
            <PlannerCoursePicker courses={liveCourses} department={profile.department} required={graduation?.remainingRequired.map((course) => course.code) ?? []} completed={profile.courses.map((course) => course.code)} neededCategories={graduation?.general.filter((item) => !generalProgress(item, requirementOverrides).satisfied).map((item) => item.label === "기초교양" ? "기초" : item.label === "심화교양" ? "심화" : "소양") ?? []} planned={plannedGroups} setPlanned={setPlannedGroups} priorities={coursePriorities} setPriorities={setCoursePriorities} watched={watchedGroups} setWatched={setWatchedGroups} excluded={excludedGroups} toggleExcluded={toggleExcluded} eligibilityOverrides={eligibilityOverrides} toggleEligibilityOverride={toggleEligibilityOverride} preferredCategories={preferredCategories} setPreferredCategories={setPreferredCategories} />
            <ProfessorPreferences courses={liveCourses} preferred={preferredProfessors} avoided={avoidedProfessors} setPreferred={setPreferredProfessors} setAvoided={setAvoidedProfessors} />
            {failure && <div className="schedule-problems">
              {failure.blocked.length > 0 && <p><b>조건에 막힌 과목</b>{failure.blocked.join(" · ")}</p>}
              {failure.conflicts.map(([left, right]) => <p key={`${left}-${right}`}><b>시간 충돌</b>{left} ↔ {right}</p>)}
              {failure.removable.length > 0 && <p><b>빼면 구성 가능</b>{failure.removable.join(" · ")}</p>}
            </div>}
          </article>

          <article className="schedule-card">
            <div className="schedule-top">
              <div><span className="rank">BEST {best ? scheduleIndex + 1 : "-"}</span><h2>추천 시간표 <small>신청 {countedCredits} / 최대 {maxCredits}학점{exemptCredits ? ` · 제한 제외 +${exemptCredits}` : ""}</small></h2><div className="schedule-tabs">{schedules.map((_, index) => <button className={index === scheduleIndex ? "active" : ""} key={index} onClick={() => { setScheduleIndex(index); setSelectedSchedule(false); }}>{index + 1}</button>)}</div></div>
              <div className="score"><span>적합도{best?.preferenceHits ? ` · 선호교수 ${best.preferenceHits}과목` : ""}</span><b>{best?.score ?? 0}<small>점</small></b></div>
            </div>
            <div className="timetable">
              <div className="times"><span /><span>09</span><span>10</span><span>11</span><span>12</span><span>13</span><span>14</span><span>15</span><span>16</span><span>17</span></div>
              {(["월", "화", "수", "목", "금"] as Course["day"][]).map((day) => (
                <div className={freeDays.includes(day) ? "day free-day" : "day"} key={day}><button className="day-header" onClick={() => setFreeDays((before) => before.includes(day) ? before.filter((item) => item !== day) : [...before, day])}>{day}</button>{Array.from({ length: 9 }, (_, i) => {
                  const slot = `${day}-${i + 9}`;
                  const blocked = freeDays.includes(day) || blockedSlots.has(slot);
                  return <button aria-label={`${day}요일 ${i + 9}시 ${blocked ? "제외됨" : "제외"}`} disabled={freeDays.includes(day)} className={blocked ? "time-cell blocked" : "time-cell"} key={i} onClick={() => setBlockedSlots((before) => { const next = new Set(before); if (next.has(slot)) next.delete(slot); else next.add(slot); return next; })} />;
                })}
                  {freeDays.includes(day) && <div className="day-off-label">공강</div>}
                  {best?.courses.flatMap((course) => (course.meetings ?? [course]).map((meeting) => ({ course, meeting }))).filter(({ meeting }) => meeting.day === day).map(({ course, meeting }) => (
                    <button aria-label={`${course.name} 상세 보기`} className={`course c${course.color}`} key={`${course.id}-${meeting.day}-${meeting.start}`} style={{ top: `${41 + (meeting.start - 9) * 31}px`, height: `${(meeting.end - meeting.start) * 31 - 3}px` }} onClick={() => setSelectedCourse(course)}>
                      <b>{course.name}</b><small>{course.professor || "담당교수 미정"} · {formatTime(meeting.start)} - {formatTime(meeting.end)}</small>
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="schedule-footer">{best ? <><span className={countedCredits > maxCredits ? "credit-over" : ""}>{countedCredits > maxCredits ? `${countedCredits - maxCredits}학점 초과` : `${maxCredits - countedCredits}학점 더 신청 가능`}</span><span>{freeDays.length > 0 && `희망 공강 · ${freeDays.join("·")}`}</span><span>{blockedSlots.size > 0 && `희망 제외 · ${blockedSlots.size}칸`}</span><button onClick={() => setSelectedSchedule(true)}>{selectedSchedule ? "선택됨 ✓" : "이 시간표 선택"}</button></> : <span className="empty-schedule">{candidates.length ? "과목 간 시간이 겹쳐 구성할 수 없습니다. 왼쪽의 충돌 안내를 확인하세요." : "왼쪽에서 과목을 선택하면 가능한 분반 조합을 계산합니다."}</span>}</div>
            <div className="schedule-library"><button disabled={!best} onClick={() => { if (!best) return; const courseIds = best.courses.map((course) => course.id); if (!savedSchedules.some((item) => item.courseIds.join() === courseIds.join())) setSavedSchedules([...savedSchedules, { name: `후보 ${savedSchedules.length + 1}`, courseIds }]); }}>현재 조합 저장</button>{savedSchedules.map((saved, index) => <div key={`${saved.name}-${index}`}><button onClick={() => { const selected = liveCourses.filter((course) => saved.courseIds.includes(course.id)); setPlannedGroups(new Set(selected.map((course) => course.group))); setLoadedSections(Object.fromEntries(selected.map((course) => [course.group, course.id]))); setScheduleIndex(0); }}>{saved.name}<small>{saved.courseIds.length}과목</small></button><button aria-label={`${saved.name} 삭제`} onClick={() => setSavedSchedules(savedSchedules.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}</div>
            {best?.reasons.length > 0 && <div className="score-reasons"><b>{best.score}점인 이유</b>{best.reasons.map((reason) => <span key={reason}>− {reason}</span>)}</div>}
          </article>
        </section>

        <Modal open={Boolean(selectedCourse)} title="과목 상세" close={() => setSelectedCourse(null)}>{selectedCourse && <div className="schedule-course-detail">
          <div className="course-detail-heading"><span>{selectedCourse.category || "이수구분 미정"}</span><h3>{selectedCourse.name}</h3><p>{selectedCourse.group} · {selectedCourse.credits}학점</p></div>
          <dl><div><dt>수업 방식</dt><dd>{selectedCourse.deliveryMode || "대면"}</dd></div><div><dt>담당 교수</dt><dd>{selectedCourse.professor || "담당교수 미정"}</dd></div><div><dt>분반</dt><dd>{selectedCourse.section || selectedCourse.id}</dd></div><div><dt>권장 학년</dt><dd>{selectedCourse.targetYears ? `${selectedCourse.targetYears}학년` : "전체 학년"}</dd></div><div><dt>수강 대상</dt><dd>{selectedCourse.eligibleDepartments || "별도 제한 없음"}</dd></div><div><dt>수업 시간</dt><dd>{selectedCourse.deliveryMode === "이러닝" && !(selectedCourse.meetings?.length) ? "온라인 · 세부 운영시간 확인" : (selectedCourse.meetings ?? [selectedCourse]).map((meeting) => `${meeting.day} ${formatTime(meeting.start)}–${formatTime(meeting.end)}`).join(" · ")}</dd></div>{selectedCourse.enrollmentNote && <div><dt>수강 안내</dt><dd>{selectedCourse.enrollmentNote}</dd></div>}</dl>
          <div className="course-detail-actions"><button className={confirmedSections[selectedCourse.group] === selectedCourse.id ? "confirm-course-button active" : "confirm-course-button"} onClick={() => { const next = { ...confirmedSections }; if (next[selectedCourse.group] === selectedCourse.id) delete next[selectedCourse.group]; else next[selectedCourse.group] = selectedCourse.id; setConfirmedSections(next); setLoadedSections({ ...loadedSections, [selectedCourse.group]: selectedCourse.id }); }}>{confirmedSections[selectedCourse.group] === selectedCourse.id ? "수강바구니 확정 해제" : "수강바구니 확정 분반"}</button><button className={excludedGroups.has(selectedCourse.group) ? "exclude-course-button active" : "exclude-course-button"} onClick={() => { toggleExcluded(selectedCourse.group); setSelectedCourse(null); setScheduleIndex(0); }}>{excludedGroups.has(selectedCourse.group) ? "수강 불가 해제" : "수강 불가 · 추천에서 제외"}</button><button className="remove-course-button" onClick={() => { const next = new Set(plannedGroups); next.delete(selectedCourse.group); setPlannedGroups(next); const confirmed = { ...confirmedSections }; delete confirmed[selectedCourse.group]; setConfirmedSections(confirmed); setSelectedCourse(null); setScheduleIndex(0); setSelectedSchedule(false); }}>시간표에서 과목 빼기</button></div>
        </div>}</Modal>

        <footer><span>{fileName && `분석 파일: ${fileName}`} {liveCourses.length > 0 && `· 수강 가능 과목 ${liveCourses.length}개`}</span><DeveloperInfo /></footer>
      </section>
    </main>
  );
}

function loadRequirementOverrides(studentId: string) {
  try { return new Set<string>(JSON.parse(localStorage.getItem(`requirement-overrides:${studentId}`) ?? "[]")); }
  catch { return new Set<string>(); }
}

function getSemesterStats(profile: Transcript) {
  const points: Record<string, number> = { "A+": 4.5, A: 4, "B+": 3.5, B: 3, "C+": 2.5, C: 2, "D+": 1.5, D: 1, F: 0 };
  const terms = new Map<string, { year: number; semester: string; score: number; credits: number }>();
  for (const course of profile.courses) {
    if (!course.year || !course.semester) continue;
    const key = `${course.year}-${course.semester}`;
    const term = terms.get(key) ?? { year: course.year, semester: course.semester, score: 0, credits: 0 };
    if (course.grade in points) {
      term.score += points[course.grade] * course.credits;
      term.credits += course.credits;
    }
    terms.set(key, term);
  }
  return [...terms.entries()].map(([key, term]) => ({
    key,
    label: `${String(term.year).slice(2)}-${term.semester.replace(/\s*학기$/, "").replace("계절", "")}`,
    gpa: term.credits ? term.score / term.credits : null,
  }));
}

function ServerClock() {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [rtt, setRtt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [target, setTarget] = useState("");
  const [armed, setArmed] = useState(false);
  const [notice, setNotice] = useState("");
  const tab = useRef<Window | null>(null);
  const serverNow = now + offset;
  const remaining = target ? new Date(target).getTime() - serverNow : 0;

  async function sync() {
    const started = Date.now();
    try {
      const response = await fetch("/api/server-time", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error();
      const ended = Date.now();
      setOffset(result.serverTime - (started + ended) / 2);
      setRtt(ended - started);
      setNotice("");
    } catch { setNotice("KUPIS 서버 시각을 불러오지 못했습니다."); }
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (!armed || !target || new Date(target).getTime() - (current + offset) > 0) return;
      setArmed(false);
      if (tab.current && !tab.current.closed) {
        tab.current.focus();
        setNotice("입장 시각입니다. 준비한 KUPIS 탭에서 수강신청 메뉴로 이동하세요.");
      } else setNotice("팝업이 차단됐습니다. KUPIS 바로가기를 눌러 주세요.");
    }, armed ? 50 : 250);
    return () => window.clearInterval(timer);
  }, [armed, offset, target]);

  function arm() {
    if (!target || remaining <= 0) return setNotice("현재보다 이후 시각을 선택해 주세요.");
    tab.current = window.open("https://kupis.kku.ac.kr/wsugang/", "gradkuya-kupis");
    if (!tab.current) return setNotice("팝업을 허용한 뒤 다시 시도해 주세요.");
    setArmed(true); setNotice("열린 KUPIS 탭에서 미리 로그인하고 탭을 닫지 마세요."); sync();
  }

  return <><button className="manual-button server-clock-button" onClick={() => { setOpen(true); sync(); }}>서버 시계 {new Date(serverNow).toLocaleTimeString("ko-KR", { hour12: false })}</button><Modal open={open} title="KUPIS 서버 시각 입장" close={() => setOpen(false)}><div className="server-clock-modal"><div className="server-time"><span>KUPIS 기준</span><strong>{new Date(serverNow).toLocaleTimeString("ko-KR", { hour12: false, fractionalSecondDigits: 1 })}</strong><small>{rtt === null ? "동기화 중" : `내 기기와 ${offset >= 0 ? "+" : ""}${Math.round(offset)}ms · 왕복 ${rtt}ms`}</small></div><label>수강신청 입장 시각<input type="datetime-local" step="1" value={target} onChange={(event) => { setTarget(event.target.value); setArmed(false); }} /></label>{target && <div className="server-countdown"><span>남은 시간</span><b>{remaining > 0 ? `${Math.floor(remaining / 60000)}:${String(Math.floor(remaining / 1000) % 60).padStart(2, "0")}.${String(Math.floor(remaining / 100) % 10)}` : "00:00.0"}</b></div>}<button className={armed ? "armed" : ""} onClick={armed ? () => { setArmed(false); tab.current?.close(); } : arm}>{armed ? "입장 준비 취소" : "KUPIS 로그인 탭 준비"}</button><a href="https://kupis.kku.ac.kr/wsugang/" target="_blank" rel="noreferrer">KUPIS 바로가기 ↗</a>{notice && <p>{notice}</p>}<small className="server-clock-note">학번·비밀번호는 GradKUya에 입력하거나 저장하지 않습니다. 열린 KUPIS 탭에서 직접 로그인해 주세요. 브라우저 보안상 다른 사이트의 <code>goMenu(&apos;2&apos;)</code>를 대신 실행할 수 없어 목표 시각에는 로그인 탭을 전면으로 가져옵니다.</small></div></Modal></>;
}

function VacancyAlerts({ watched, courses }: { watched: Set<string>; courses: DisplayCourse[] }) {
  const [enabled, setEnabled] = useState(() => typeof window !== "undefined" && localStorage.getItem("vacancy-alerts") === "1" && Notification.permission === "granted");
  const [settings, setSettings] = useState<{ url: string; userId: string }>(() => {
    if (typeof window === "undefined") return { url: "", userId: "" };
    try { return JSON.parse(localStorage.getItem("discord-alerts") || '{"url":"","userId":""}'); }
    catch { return { url: "", userId: "" }; }
  });
  const [configuring, setConfiguring] = useState(false);
  const [discordVerified, setDiscordVerified] = useState(() => typeof window !== "undefined" && Boolean(localStorage.getItem("discord-alerts")));
  const [verificationCode, setVerificationCode] = useState("");
  const [enteredCode, setEnteredCode] = useState("");
  const [testResult, setTestResult] = useState("");
  const [notice, setNotice] = useState("");
  const previous = useRef<Map<string, boolean> | null>(null);

  useEffect(() => {
    if ((!enabled && !discordVerified) || !watched.size) return;
    const check = async () => {
      try {
        const watchedCourses = courses.filter((course) => watched.has(course.group));
        const targets = watchedCourses.map((course) => ({ menu: course.sourceMenu, lectCd: course.sourceLectCd })).filter((target) => target.menu && target.lectCd);
        const result = await fetch("/api/vacancies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targets }) }).then((response) => response.json());
        const seats = (result.courses ?? []) as { id: string; capacity: number; enrolled: number }[];
        const current = new Map(seats.map((course) => [course.id, course.capacity > course.enrolled]));
        if (previous.current) {
          for (const course of watchedCourses) {
            if (previous.current.get(course.id) === false && current.get(course.id) === true) {
              if (enabled) {
                const options = { body: `${course.name} ${course.section ?? ""}분반에 빈자리가 생겼어요.`, icon: "/app-icon.svg", tag: `vacancy-${course.id}` };
                const registration = await navigator.serviceWorker?.getRegistration();
                if (registration) await registration.showNotification("관심 과목 빈자리 알림", options);
                else new Notification("관심 과목 빈자리 알림", options);
              }
              if (discordVerified && settings.url) await sendDiscord(settings, `🚨 **${course.name}** ${course.section ?? ""}분반에 빈자리가 생겼어요.`);
            }
          }
        }
        previous.current = current;
      } catch { /* 다음 확인 주기에 재시도 */ }
    };
    check();
    const timer = window.setInterval(check, 3_000);
    return () => window.clearInterval(timer);
  }, [courses, discordVerified, enabled, settings, watched]);

  async function toggle() {
    if (enabled) {
      localStorage.removeItem("vacancy-alerts");
      setEnabled(false);
      return;
    }
    if (!("Notification" in window)) return setNotice("이 브라우저는 알림을 지원하지 않습니다. Discord 알림을 이용해 주세요.");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return setNotice("알림 권한이 꺼져 있습니다. 브라우저 설정에서 이 사이트의 알림을 허용해 주세요.");
    localStorage.setItem("vacancy-alerts", "1");
    previous.current = null;
    setEnabled(true);
  }

  async function sendVerificationCode() {
    setTestResult("전송 중...");
    try {
      const values = new Uint32Array(1);
      crypto.getRandomValues(values);
      const code = String(100000 + values[0] % 900000);
      await sendDiscord(settings, `🔐 GradKUya 연동 코드: **${code}**`);
      setVerificationCode(code);
      setEnteredCode("");
      setTestResult("Discord로 전송된 6자리 코드를 입력해 주세요.");
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : "전송에 실패했습니다.");
    }
  }

  function verifyDiscord() {
    if (enteredCode !== verificationCode) return setTestResult("인증 코드가 일치하지 않습니다.");
    localStorage.setItem("discord-alerts", JSON.stringify(settings));
    setDiscordVerified(true);
    setVerificationCode("");
    setEnteredCode("");
    setTestResult("Discord 연동이 완료됐습니다.");
  }

  return <div className="notification-controls">
    <button className={enabled ? "notification-button active" : "notification-button"} onClick={toggle} title={watched.size ? `관심 과목 ${watched.size}개 감시 중` : "시간표 설계에서 별표로 관심 과목을 설정하세요"}>🔔 {enabled ? `알림 중 ${watched.size}` : "빈자리 알림"}</button>
    <button className={discordVerified ? "discord-button active" : "discord-button"} onClick={() => setConfiguring(true)}>Discord</button>
    <Modal open={Boolean(notice)} title="알림을 켤 수 없어요" close={() => setNotice("")}><div className="notice-dialog"><span>🔔</span><p>{notice}</p><button onClick={() => setNotice("")}>확인</button></div></Modal>
    <Modal open={configuring} title="Discord 빈자리 알림" close={() => setConfiguring(false)}><div className="discord-settings">
      <ol className="discord-guide">
        <li><b>알림을 받을 채널 열기</b><span>Discord 서버에서 개인 알림용 텍스트 채널을 선택합니다.</span></li>
        <li><b>채널 설정 → 연동</b><span>채널 이름 옆 톱니바퀴를 누르고 ‘연동’ 또는 ‘Integrations’로 이동합니다.</span></li>
        <li><b>웹후크 만들기</b><span>‘웹후크 만들기’를 누르고 메시지를 보낼 채널이 맞는지 확인합니다.</span></li>
        <li><b>웹후크 URL 복사</b><span>‘웹후크 URL 복사’를 눌러 아래 입력창에 붙여넣습니다. URL은 이 기기에만 저장됩니다.</span></li>
        <li><b>등록 코드 인증</b><span>등록 코드를 보낸 뒤 Discord에 도착한 6자리 숫자를 입력하면 연동됩니다.</span></li>
      </ol>
      <label>웹훅 URL<input type="password" value={settings.url} onChange={(event) => { setSettings({ ...settings, url: event.target.value.trim() }); setVerificationCode(""); setDiscordVerified(false); }} placeholder="https://discord.com/api/webhooks/..." /></label>
      <label>내 Discord 사용자 ID <small>선택 · 입력하면 멘션 알림</small><input value={settings.userId} onChange={(event) => { setSettings({ ...settings, userId: event.target.value.replace(/\D/g, "") }); setVerificationCode(""); setDiscordVerified(false); }} placeholder="예: 123456789012345678" /></label>
      <button onClick={sendVerificationCode}>{verificationCode ? "인증 코드 다시 보내기" : "등록 코드 보내기"}</button>
      {verificationCode && <div className="discord-code"><input inputMode="numeric" maxLength={6} value={enteredCode} onChange={(event) => setEnteredCode(event.target.value.replace(/\D/g, ""))} placeholder="6자리 코드" /><button onClick={verifyDiscord}>연동 완료</button></div>}
      {testResult && <span>{testResult}</span>}
    </div></Modal>
  </div>;
}

async function sendDiscord(settings: { url: string; userId: string }, message: string) {
  const url = new URL(settings.url);
  if (url.protocol !== "https:" || !["discord.com", "discordapp.com"].includes(url.hostname) || !url.pathname.startsWith("/api/webhooks/"))
    throw new Error("올바른 Discord 웹훅 URL을 입력해 주세요.");
  const mention = settings.userId ? `<@${settings.userId}> ` : "";
  url.searchParams.set("wait", "true");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: `${mention}${message}`, allowed_mentions: settings.userId ? { users: [settings.userId] } : { parse: [] } }),
  });
  if (!response.ok) throw new Error(response.status === 429 ? "요청이 많습니다. 잠시 후 다시 시도해 주세요." : "웹훅 URL과 채널 권한을 확인해 주세요.");
}

function GraduationView({ graduation, profile, courses, overrides, toggleOverride }: { graduation: GraduationAudit | null; profile: Transcript; courses: Course[]; overrides: Set<string>; toggleOverride: (label: string) => void }) {
  if (!graduation) return <section className="workspace-card"><h2>졸업 요건을 찾지 못했습니다</h2><p>학과명과 입학연도 요람을 확인해 주세요.</p></section>;
  const maxCredits = profile.lastSemesterGpa >= 3.7 ? 21 : 18;
  const remainingCredits = Math.max(0, (graduation.credits?.total ?? 0) - profile.totalCredits);
  const offered = new Set(courses.map((course) => course.group));
  const unavailableRequired = graduation.remainingRequired.filter((course) => !offered.has(course.code));
  const needsNextSemester = profile.studentYear >= 4 && (remainingCredits > maxCredits || unavailableRequired.length > 0);
  const major = [
    ["전공필수", graduation.earnedCredits.majorRequired, graduation.credits?.majorRequired ?? 0],
    ["전공선택", graduation.earnedCredits.majorElective, graduation.credits?.majorElective ?? 0],
  ] as const;
  const general = graduation.general.map((item) => ({ item, progress: generalProgress(item, overrides) }));
  return <section className="workspace">
    <div className="workspace-heading"><div><p className="eyebrow">ADMISSION HANDBOOK AUDIT</p><h2>영역별 졸업 요건</h2></div><span>성적표 학점 우선 적용</span></div>
    {needsNextSemester && <div className="semester-warning"><b>현재 학기만으로 졸업요건 충족이 어렵습니다.</b><span>{remainingCredits > maxCredits ? `남은 ${remainingCredits}학점이 신청 가능 ${maxCredits}학점을 초과합니다. ` : ""}{unavailableRequired.length ? `현재 미개설 필수: ${unavailableRequired.map((course) => course.name).join(", ")}. ` : ""}다음 학기 이수가 필요할 수 있습니다.</span></div>}
    <div className="requirement-grid">
      {general.map(({ item, progress }) => <article className="requirement-card" key={item.label}><span>{progress.satisfied ? (progress.earned !== item.earned ? "예외 충족" : "충족") : "미충족"}</span><h3>{item.label}</h3><strong>{item.earned}<small> / {item.required}학점{progress.earned !== item.earned ? ` · ${progress.earned} 인정` : ""}</small></strong><div className="bar"><i style={{ width: `${Math.min(100, progress.earned / Math.max(1, item.required) * 100)}%` }} /></div></article>)}
      {major.map(([label, earned, required]) => <article className="requirement-card" key={label}><span>{earned >= required ? "충족" : "미충족"}</span><h3>{label}</h3><strong>{earned}<small> / {required}학점</small></strong><div className="bar"><i style={{ width: `${Math.min(100, earned / Math.max(1, required) * 100)}%` }} /></div></article>)}
    </div>
    {general.map(({ item, progress }) => <article className="detail-card" key={item.label}>
      <div><h3>{item.label} 세부영역</h3><p>{item.minimumAreas ? `${item.details.length}개 영역 중 최소 ${item.minimumAreas}개 · 현재 ${progress.completedAreas}개` : "각 세부항목의 학점 조건을 확인하세요."}</p></div>
      <div className="detail-list">{item.details.map((detail) => { const key = requirementKey(item.label, detail.label); const overridden = overrides.has(key); const detailCourses = detail.courses ?? []; return <div className={detail.earned >= detail.required || overridden ? "detail-item done" : "detail-item"} key={detail.label}><details><summary><span><b>{detail.label}</b><small>{detail.earned} / {detail.required}학점{overridden ? " · 예외 인정" : ""}</small></span><i>{detailCourses.length}과목⌄</i></summary><div className="earned-course-list">{detailCourses.length ? detailCourses.map((course) => <span key={`${course.year}-${course.code}`}><b>{course.name}</b><small>{course.code} · {course.year} {course.semester} · {course.credits}학점 · {course.grade}</small></span>) : <p>이 영역으로 분류된 이수 과목이 없습니다.</p>}</div></details>{detail.earned < detail.required && <button className={overridden ? "requirement-override active" : "requirement-override"} onClick={() => toggleOverride(key)}>{overridden ? "예외 해제" : "학점 변경 예외"}</button>}</div>; })}</div>
    </article>)}
    <article className="detail-card"><div><h3>남은 입학연도 전공필수</h3><p>현재 요람에서 선택으로 바뀌어도 입학연도 기준 필수입니다.</p></div>
      <div className="course-list">{graduation.remainingRequired.map((course) => <div key={course.code}><b>{course.name}</b><span>{course.code} · {course.credits}학점</span><small>{course.note}</small></div>)}</div>
    </article>
  </section>;
}

function GpaView({ profile, courses, planned, setPlanned, openPlanner }: { profile: Transcript; courses: DisplayCourse[]; planned: Set<string>; setPlanned: (value: Set<string>) => void; openPlanner: () => void }) {
  const [target, setTarget] = useState(4);
  const [strategy, setStrategy] = useState<"retake" | "replace">("retake");
  const low = profile.courses.filter((course) => ["C+", "C", "D+", "D", "F"].includes(course.grade));
  const points: Record<string, number> = { "A+": 4.5, A: 4, "B+": 3.5, B: 3, "C+": 2.5, C: 2, "D+": 1.5, D: 1, F: 0 };
  const graded = profile.courses.filter((course) => course.grade in points);
  if (!graded.length) return <section className="workspace"><div className="workspace-heading"><div><p className="eyebrow">GPA SIMULATOR</p><h2>재이수 성적 시뮬레이션</h2></div></div><article className="empty-state"><b>아직 계산할 평점이 없습니다.</b><span>신입생이거나 P/NP 과목만 이수한 경우 정상입니다. 등급이 기재된 성적이 생기면 재이수 효과를 계산합니다.</span></article></section>;
  const credits = graded.reduce((sum, course) => sum + course.credits, 0);
  const current = graded.reduce((sum, course) => sum + points[course.grade] * course.credits, 0);
  const replaced = low.reduce((sum, course) => sum + ((strategy === "retake" ? target : 4.5) - points[course.grade]) * course.credits, 0);
  const expected = credits ? (current + replaced) / credits : profile.gpa;
  return <section className="workspace">
    <div className="workspace-heading"><div><p className="eyebrow">GPA SIMULATOR</p><h2>성적 개선 시뮬레이션</h2><p className="source-order">재이수는 A까지, 포기 후 다른 신규 과목은 A+까지 가정합니다.</p></div>{strategy === "retake" && <label>목표 성적 <select value={target} onChange={(event) => setTarget(Number(event.target.value))}><option value="4">A (최대)</option><option value="3.5">B+</option></select></label>}</div>
    <div className="strategy-tabs"><button className={strategy === "retake" ? "active" : ""} onClick={() => setStrategy("retake")}><b>동일 과목 재이수</b><span>최대 A · 개설 과목을 바구니에 담기</span></button><button className={strategy === "replace" ? "active" : ""} onClick={() => setStrategy("replace")}><b>취득학점 포기 + 신규 과목</b><span>신규 과목 최대 A+ · 포기 조건 별도 확인</span></button></div>
    <article className="gpa-simulation"><div><span>현재 평점</span><strong>{profile.gpa.toFixed(2)}</strong></div><b>→</b><div><span>예상 평점</span><strong>{expected.toFixed(2)}</strong></div><em>+{Math.max(0, expected - profile.gpa).toFixed(2)}</em></article>
    {strategy === "replace" && <article className="policy-note"><b>취득학점 포기는 자동 확정할 수 없어요.</b><span>3학기 이상 등록, C+ 이하, 수료학점보다 남는 학점 범위 등의 조건이 있으며 복구할 수 없습니다. 아래 예상치는 같은 학점의 신규 과목을 A+로 이수한다고 가정합니다.</span><a href="https://eng.kku.ac.kr/mbshome/mbs/wwwkr/subview.do?id=wwwkr_050101180000" target="_blank" rel="noreferrer">학교 공식 안내 확인 ↗</a><button onClick={openPlanner}>허용 영역을 골라 신규 과목 채우기</button></article>}
    <article className="detail-card"><div><h3>C+ 이하 과목</h3><p>성적표에 실제 기재된 학점으로 계산합니다.</p></div><div className="course-list gpa-course-list">{low.map((course) => { const offered = courses.some((item) => item.group === course.code); return <div key={`${course.year}-${course.code}`}><b>{course.name}</b><span>{course.year} {course.semester} · {course.credits}학점</span><small>현재 {course.grade} → {strategy === "retake" ? `재이수 ${target === 4 ? "A" : "B+"}` : "포기 후 신규 과목 A+ 가정"}</small>{strategy === "retake" && <button disabled={!offered || planned.has(course.code)} onClick={() => setPlanned(new Set(planned).add(course.code))}>{planned.has(course.code) ? "바구니에 담김" : offered ? "재이수 바구니 담기" : "이번 학기 미개설"}</button>}</div>; })}</div></article>
  </section>;
}

type DisplayCourse = Course & { category?: string; professor?: string; capacity?: number; enrolled?: number; params?: string; section?: string; sourceMenu?: string; sourceLectCd?: string; targetYears?: string; eligibleDepartments?: string; enrollmentNote?: string; deliveryMode?: "이러닝" | "대면"; subcategories?: string[]; restriction?: string; affiliations?: { department: string; category: string }[] };

function courseCategories(course: DisplayCourse, department = "") {
  if (course.deliveryMode === "이러닝" || course.sourceMenu === "9") return [`이러닝 · ${course.category || "기타"}`];
  const affiliations = course.affiliations?.filter((item) => !department || item.department === department) ?? [];
  return affiliations.length ? affiliations.map((item) => `${item.department} · ${item.category}`) : [course.category || "기타"];
}

function courseSubcategories(course: DisplayCourse) {
  return course.subcategories?.filter(Boolean).length ? course.subcategories : ["세부영역 미분류"];
}

function PlannerCoursePicker({ courses, department, required, completed, neededCategories, planned, setPlanned, priorities, setPriorities, watched, setWatched, excluded, toggleExcluded, eligibilityOverrides, toggleEligibilityOverride, preferredCategories, setPreferredCategories }: {
  courses: DisplayCourse[]; department: string; required: string[]; completed: string[]; neededCategories: string[];
  planned: Set<string>; setPlanned: (value: Set<string>) => void;
  priorities: Record<string, string>; setPriorities: (value: Record<string, string>) => void;
  watched: Set<string>; setWatched: (value: Set<string>) => void;
  excluded: Set<string>; toggleExcluded: (group: string) => void;
  eligibilityOverrides: Set<string>; toggleEligibilityOverride: (group: string) => void;
  preferredCategories: string[]; setPreferredCategories: (value: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [showOtherMajors, setShowOtherMajors] = useState(false);
  const visible = courses.filter((course) => showOtherMajors || !["전필", "전선"].includes(course.category ?? "") || course.affiliations?.some((item) => sameDepartment(item.department, department)));
  const unique = [...new Map(visible.map((course) => [course.group, course])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const matches = (course: DisplayCourse) => !query || `${course.name} ${course.group} ${course.category}`.toLowerCase().includes(query.toLowerCase());
  const requiredSet = new Set(required);
  const completedSet = new Set(completed);
  const selected = unique.filter((course) => planned.has(course.group));
  return <div className="course-picker">
    <label className="picker-search">과목 선택<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="과목명·학수번호 검색" /></label>
    <label className="other-major-toggle"><input type="checkbox" checked={showOtherMajors} onChange={(event) => setShowOtherMajors(event.target.checked)} />타 전공 전필·전선 포함</label>
    <CoursePickerGroup title="꼭 들어야 하는 과목" courses={unique.filter((course) => requiredSet.has(course.group) && matches(course))} planned={planned} excluded={excluded} toggleExcluded={toggleExcluded} eligibilityOverrides={eligibilityOverrides} toggleEligibilityOverride={toggleEligibilityOverride} status={(course) => ["졸업 필수", ...(completedSet.has(course.group) ? ["이미 이수"] : [])]} add={(group) => setPlanned(new Set(planned).add(group))} />
    <CoursePickerGroup title="학점이 부족한 영역" courses={unique.filter((course) => !requiredSet.has(course.group) && !completedSet.has(course.group) && neededCategories.includes(course.category ?? "") && matches(course))} planned={planned} excluded={excluded} toggleExcluded={toggleExcluded} eligibilityOverrides={eligibilityOverrides} toggleEligibilityOverride={toggleEligibilityOverride} status={() => ["학점 부족 영역"]} add={(group) => setPlanned(new Set(planned).add(group))} />
    <CoursePickerGroup title="선택·요건 충족 영역" courses={unique.filter((course) => !requiredSet.has(course.group) && (completedSet.has(course.group) || !neededCategories.includes(course.category ?? "")) && matches(course))} planned={planned} excluded={excluded} toggleExcluded={toggleExcluded} eligibilityOverrides={eligibilityOverrides} toggleEligibilityOverride={toggleEligibilityOverride} status={(course) => completedSet.has(course.group) ? ["이미 이수"] : ["선택 가능"]} add={(group) => setPlanned(new Set(planned).add(group))} />
    <div className="preferred-areas"><span>선호 영역</span>{["전필", "전선", "기초", "심화", "소양"].map((category) => <button className={preferredCategories.includes(category) ? "active" : ""} key={category} onClick={() => setPreferredCategories(preferredCategories.includes(category) ? preferredCategories.filter((item) => item !== category) : [...preferredCategories, category])}>{category}</button>)}</div>
    <div className="basket"><b>바구니 <small>{selected.length} · 우선순위 1이 가장 높고 !는 필수</small></b>{selected.map((course) => <div key={course.group}><select aria-label={`${course.name} 우선순위`} className={priorities[course.group] === "!" ? "priority must" : "priority"} value={priorities[course.group] ?? ""} onChange={(event) => { const next = { ...priorities }; if (event.target.value) next[course.group] = event.target.value; else delete next[course.group]; setPriorities(next); }}><option value="">-</option><option value="!">!</option>{[1,2,3,4,5,6,7,8,9].map((value) => <option key={value}>{value}</option>)}</select><button aria-label="빈자리 알림" title="빈자리 알림" className={watched.has(course.group) ? "watch active" : "watch"} onClick={() => { const next = new Set(watched); if (next.has(course.group)) next.delete(course.group); else next.add(course.group); setWatched(next); }}>🔔</button><span>{course.name}<small>{priorities[course.group] === "!" ? "필수 · " : priorities[course.group] ? `우선순위 ${priorities[course.group]} · ` : ""}{course.category} · {course.credits}학점</small></span><button onClick={() => { const next = new Set(planned); next.delete(course.group); setPlanned(next); }}>×</button></div>)}</div>
  </div>;
}

function CoursePickerGroup({ title, courses, planned, excluded, toggleExcluded, eligibilityOverrides, toggleEligibilityOverride, status, add }: { title: string; courses: DisplayCourse[]; planned: Set<string>; excluded: Set<string>; toggleExcluded: (group: string) => void; eligibilityOverrides: Set<string>; toggleEligibilityOverride: (group: string) => void; status: (course: DisplayCourse) => string[]; add: (group: string) => void }) {
  const [openCategory, setOpenCategory] = useState("");
  const [modalQuery, setModalQuery] = useState("");
  const available = courses.filter((course) => !planned.has(course.group));
  const categories = [...new Set(available.flatMap((course) => courseCategories(course)))];
  const categoryCourses = available.filter((course) => courseCategories(course).includes(openCategory));
  const modalCourses = categoryCourses.filter((course) => !modalQuery || `${course.name} ${course.group} ${course.professor}`.toLowerCase().includes(modalQuery.toLowerCase()));
  const modalSubcategories = [...new Set(modalCourses.flatMap(courseSubcategories))];
  return <section className="picker-group"><h4>{title}<small>{available.length}</small></h4><div className="category-toggles">{categories.map((category) => {
    const count = available.filter((course) => courseCategories(course).includes(category)).length;
    return <button className={openCategory === category ? "active" : ""} key={category} onClick={() => setOpenCategory(openCategory === category ? "" : category)}><b>{category}</b><small>{count}과목</small></button>;
  })}</div>
    <Modal open={Boolean(openCategory)} title={openCategory} close={() => { setOpenCategory(""); setModalQuery(""); }}><div className="course-modal"><div className="course-modal-intro"><b>{title}</b><span>{modalSubcategories.length}개 세부영역 · {categoryCourses.length}개 과목</span></div><label className="course-modal-search"><span>⌕</span><input autoFocus value={modalQuery} onChange={(event) => setModalQuery(event.target.value)} placeholder="과목명·학수번호·교수 검색" /></label><div className="modal-subcategory-list">{modalSubcategories.map((subcategory) => <section className="modal-subcategory" key={subcategory}><h3><span>{subcategory}</span><small>{modalCourses.filter((course) => courseSubcategories(course).includes(subcategory)).length}과목</small></h3><div className="modal-course-list">{modalCourses.filter((course) => courseSubcategories(course).includes(subcategory)).map((course) => { const restricted = Boolean(course.restriction && !eligibilityOverrides.has(course.group)); const labels = [...status(course), ...(excluded.has(course.group) ? ["추천 제외"] : []), ...(restricted ? ["수강대상 제한"] : [])]; return <button className={excluded.has(course.group) ? "excluded-course" : restricted ? "restricted-course" : labels.includes("이미 이수") ? "completed-course" : ""} key={`${subcategory}-${course.group}`} onClick={() => excluded.has(course.group) ? toggleExcluded(course.group) : restricted ? toggleEligibilityOverride(course.group) : add(course.group)}><span className="course-card-copy"><span className="course-statuses">{labels.map((item) => <em className={item === "학점 부족 영역" ? "needed" : item === "이미 이수" ? "completed" : item === "추천 제외" ? "excluded" : item === "수강대상 제한" ? "restricted" : ""} key={item}>{item}</em>)}</span><b>{course.name}</b><small><em>{course.credits}학점</em><span className="course-meta">{course.group} · {course.professor || "담당교수 미정"} · {restricted ? course.restriction : course.targetYears ? `${course.targetYears}학년 권장` : "전체 학년"}</span></small></span><i aria-hidden="true">{excluded.has(course.group) ? "제외 해제" : restricted ? "예외 포함" : "담기 ＋"}</i></button>; })}</div></section>)}{!modalCourses.length && <p className="modal-empty">검색 결과가 없습니다.</p>}</div></div></Modal>
  </section>;
}

function ProfessorPreferences({ courses, preferred, avoided, setPreferred, setAvoided }: {
  courses: DisplayCourse[]; preferred: string[]; avoided: string[];
  setPreferred: (value: string[]) => void; setAvoided: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const professors = [...new Set(courses.map((course) => course.professor).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "ko"));
  const groups = [...new Set(courses.flatMap((course) => course.affiliations?.map((item) => item.department) ?? [course.deliveryMode === "이러닝" ? "이러닝" : course.category || "기타"]))].sort((a, b) => a.localeCompare(b, "ko"));
  const groupProfessors = (group: string) => professors.filter((name) => courses.some((course) => course.professor === name && (course.affiliations?.some((item) => item.department === group) || (!course.affiliations?.length && (course.deliveryMode === "이러닝" ? group === "이러닝" : (course.category || "기타") === group)))));
  const toggle = (value: string, type: "preferred" | "avoided") => {
    if (!value) return;
    if (type === "preferred") { setPreferred(preferred.includes(value) ? preferred.filter((name) => name !== value) : [...preferred, value]); setAvoided(avoided.filter((name) => name !== value)); }
    else { setAvoided(avoided.includes(value) ? avoided.filter((name) => name !== value) : [...avoided, value]); setPreferred(preferred.filter((name) => name !== value)); }
  };
  return <div className="professor-preferences">
    <button className="professor-modal-trigger" onClick={() => setOpen(true)}><span><b>교수 선호 설정</b><small>학과·영역별로 여러 명 선택</small></span><i>선호 {preferred.length} · 기피 {avoided.length} ›</i></button>
    <div>{preferred.map((name) => <button className="preferred" key={name} onClick={() => setPreferred(preferred.filter((item) => item !== name))}>선호 · {name} ×</button>)}{avoided.map((name) => <button className="avoided" key={name} onClick={() => setAvoided(avoided.filter((item) => item !== name))}>기피 · {name} ×</button>)}</div>
    <Modal open={open} title="교수 선호 설정" close={() => { setOpen(false); setQuery(""); }}><div className="professor-modal"><input className="modal-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="교수명 검색" /><p>한 교수는 선호 또는 기피 중 하나로만 설정됩니다.</p><div className="professor-groups">{groups.map((group) => { const names = groupProfessors(group).filter((name) => name.includes(query)); return names.length ? <section key={group}><h3>{group}<small>{names.length}명</small></h3>{names.map((name) => <div className="professor-row" key={`${group}-${name}`}><b>{name}</b><span><button className={preferred.includes(name) ? "active preferred" : ""} onClick={() => toggle(name, "preferred")}>선호</button><button className={avoided.includes(name) ? "active avoided" : ""} onClick={() => toggle(name, "avoided")}>기피</button></span></div>)}</section> : null; })}</div></div></Modal>
  </div>;
}

function CourseView({ courses, department: ownDepartment, required, completed, planned, setPlanned, watched, setWatched, excluded, toggleExcluded, eligibilityOverrides, toggleEligibilityOverride }: {
  courses: DisplayCourse[]; department: string; required: string[]; completed: string[]; planned: Set<string>; setPlanned: (value: Set<string>) => void;
  watched: Set<string>; setWatched: (value: Set<string>) => void;
  excluded: Set<string>; toggleExcluded: (group: string) => void;
  eligibilityOverrides: Set<string>; toggleEligibilityOverride: (group: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState(ownDepartment);
  const [openCatalog, setOpenCatalog] = useState<{ section: string; category: string } | null>(null);
  const requiredSet = new Set(required);
  const completedSet = new Set(completed);
  const unique = [...new Map(courses.map((course) => [course.group, course])).values()];
  const departments = [...new Set(unique.flatMap((course) => course.affiliations?.map((item) => item.department) ?? []))].sort((a, b) => a.localeCompare(b, "ko"));
  const shown = unique.filter((course) => (!department || !["전필", "전선"].includes(course.category ?? "") || course.affiliations?.some((item) => sameDepartment(item.department, department))) && (!query || `${course.name} ${course.group} ${course.professor}`.toLowerCase().includes(query.toLowerCase())));
  const sections = [
    { title: "졸업을 위해 수강해야 할 과목", courses: shown.filter((course) => requiredSet.has(course.group) && !planned.has(course.group)) },
    { title: "바구니", courses: shown.filter((course) => planned.has(course.group)) },
    { title: "제외한 과목", courses: shown.filter((course) => excluded.has(course.group)) },
    { title: "추가로 듣지 않아도 되는 과목", courses: shown.filter((course) => !requiredSet.has(course.group) && !planned.has(course.group) && !excluded.has(course.group)) },
  ];
  const openCourses = openCatalog ? sections.find((section) => section.title === openCatalog.section)?.courses.filter((course) => courseCategories(course, department).includes(openCatalog.category)) ?? [] : [];
  const openSubcategories = [...new Set(openCourses.flatMap(courseSubcategories))];
  return <section className="workspace">
    <div className="workspace-heading"><div><p className="eyebrow">CURRENT COURSE CATALOG</p><h2>현재 학년도 개설 과목</h2></div><input className="course-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="과목명·학수번호·교수 검색" /></div>
    <p className="source-order">학점과 이수구분은 현재 수강편람 값을 사용하며, 입학연도 요람은 졸업 인정 여부에만 적용합니다.</p>
    <label className="catalog-view-control">전공 구분<select value={department} onChange={(event) => setDepartment(event.target.value)}><option value={ownDepartment}>내 전공 · {ownDepartment}</option><option value="">타 전공 모두 포함</option>{departments.filter((name) => !sameDepartment(name, ownDepartment)).map((name) => <option key={name}>{name}</option>)}</select></label>
    {sections.map((section) => { const categories = [...new Set(section.courses.flatMap((course) => courseCategories(course, department)))]; return <div className="catalog-section" key={section.title}><h3>{section.title}<small>{section.courses.length}과목</small></h3>
      <div className="catalog-category-grid">{categories.map((category) => { const count = section.courses.filter((course) => courseCategories(course, department).includes(category)).length; return <button key={category} onClick={() => setOpenCatalog({ section: section.title, category })}><span>{category}</span><b>{count}<small>과목</small></b><i>보기 →</i></button>; })}</div>
      {!section.courses.length && <p className="empty-category">해당 과목이 없습니다.</p>}
    </div>; })}
    <Modal open={Boolean(openCatalog)} title={openCatalog?.category ?? "과목 구분"} close={() => setOpenCatalog(null)}><div className="catalog-modal"><div className="catalog-modal-summary"><b>{openCatalog?.section}</b><span>{openSubcategories.length}개 세부영역 · {openCourses.length}과목</span></div><div className="catalog-subcategory-list">{openSubcategories.map((subcategory) => <section className="catalog-subcategory" key={subcategory}><h3><span>{subcategory}</span><small>{openCourses.filter((course) => courseSubcategories(course).includes(subcategory)).length}과목</small></h3><div className="catalog-list">{openCourses.filter((course) => courseSubcategories(course).includes(subcategory)).map((course) => <article key={`${subcategory}-${course.group}`}>
      <div><span>{course.category || "기타"}</span>{requiredSet.has(course.group) && <em>졸업 필수</em>}{completedSet.has(course.group) && <em>이수 완료</em>}{course.restriction && !eligibilityOverrides.has(course.group) && <em className="restriction-tag">수강대상 제한</em>}<h3>{course.name}</h3><p>{course.group} · {course.professor || "담당교수 미정"} · {course.credits}학점{course.restriction ? ` · ${course.restriction}` : ""}</p></div>
      <small>{courses.filter((item) => item.group === course.group).length}개 분반</small>
      <div className="catalog-actions"><button className={watched.has(course.group) ? "watching" : ""} onClick={() => { const next = new Set(watched); if (next.has(course.group)) next.delete(course.group); else next.add(course.group); setWatched(next); }}>{watched.has(course.group) ? "🔔 알림 신청됨" : "🔕 빈자리 알림"}</button><button disabled={excluded.has(course.group) || Boolean(course.restriction && !eligibilityOverrides.has(course.group))} onClick={() => { const next = new Set(planned); if (next.has(course.group)) next.delete(course.group); else next.add(course.group); setPlanned(next); }}>{excluded.has(course.group) ? "추천 제외됨" : course.restriction && !eligibilityOverrides.has(course.group) ? "수강대상 확인 필요" : planned.has(course.group) ? "바구니에서 빼기" : "바구니에 담기"}</button><button className={excluded.has(course.group) ? "excluded" : "exclude"} onClick={() => toggleExcluded(course.group)}>{excluded.has(course.group) ? "제외 해제" : "이 과목 제외"}</button>{course.restriction && <button className="eligibility" onClick={() => toggleEligibilityOverride(course.group)}>{eligibilityOverrides.has(course.group) ? "제한 예외 해제" : "허가·자격 확인됨"}</button>}</div>
    </article>)}</div></section>)}</div></div></Modal>
  </section>;
}

function formatTime(value: number) {
  const hour = Math.floor(value);
  return `${String(hour).padStart(2, "0")}:${String(Math.round((value - hour) * 60)).padStart(2, "0")}`;
}

function Modal({ open, title, close, children, mobileOnly = false }: { open: boolean; title: string; close: () => void; children: React.ReactNode; mobileOnly?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (mobileOnly && !window.matchMedia("(max-width: 700px)").matches) {
      if (dialog.open) dialog.close();
      return;
    }
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (!open && dialog.open) dialog.close();
  }, [mobileOnly, open]);
  return <dialog className={mobileOnly ? "app-modal mobile-only" : "app-modal"} ref={ref} onClose={close} onClick={(event) => { if (event.target === ref.current) close(); }}>
    <div className="modal-sheet"><header><h2>{title}</h2><button aria-label="닫기" onClick={close}>×</button></header><div className="modal-body">{children}</div></div>
  </dialog>;
}

function PdfStart({ uploading, error, upload, startFreshman }: { uploading: boolean; error: string; upload: (file?: File) => void; startFreshman: (data: { name: string; admissionYear: number; department: string; studentYear: number; semester: string }) => Promise<void> }) {
  const [guide, setGuide] = useState(false);
  const [freshman, setFreshman] = useState(false);
  const [options, setOptions] = useState<{ years: number[]; departments: Record<string, string[]> }>({ years: [], departments: {} });
  const [form, setForm] = useState({ name: "", admissionYear: 0, department: "", studentYear: 1, semester: "1학기" });
  const [freshmanError, setFreshmanError] = useState("");
  async function openFreshman() {
    setFreshman(true);
    if (options.years.length) return;
    const result = await fetch("/api/onboarding").then((response) => response.json());
    const year = result.years?.[0] ?? 0;
    setOptions(result);
    setForm((before) => ({ ...before, admissionYear: year, department: result.departments?.[year]?.[0] ?? "" }));
  }
  return <main className="start-page">
    <section className="start-card">
      <div className="start-brand"><div className="brand-mark">G</div><strong>졸업할KU야</strong></div>
      <p className="eyebrow">NO PASSWORD, JUST YOUR RECORD</p>
      <h1>성적표 한 장으로<br />졸업 준비를 시작하세요.</h1>
      <p className="start-copy">학사정보시스템에서 저장한 ‘개인별 전체 성적조회’ PDF 한 장이면 됩니다. 비밀번호나 학교 계정은 입력하지 않습니다.</p>
      <label className="upload-box">
        <span>PDF</span>
        <b>{uploading ? "성적표를 분석하고 있어요..." : "전체 성적조회 PDF 선택"}</b>
        <small>건국대학교 GLOCAL · 최대 10MB</small>
        <input disabled={uploading} type="file" accept="application/pdf" onChange={(event) => upload(event.target.files?.[0])} />
      </label>
      <button className="freshman-button" onClick={openFreshman}>저는 새내기에요</button>
      <button className="guide-button" onClick={() => setGuide(true)}>성적표 PDF는 어디서 받나요?</button>
      {error && <p className="upload-error">{error}</p>}
      <div className="privacy-note"><b>AI 없이 안전하게 분석</b><span>규칙 기반으로 서버 메모리에서만 읽고 원본 PDF는 저장하지 않습니다.</span></div>
      <DeveloperInfo />
      <Modal open={freshman} title="새내기 정보 직접 입력" close={() => setFreshman(false)}><form className="freshman-form" onSubmit={async (event) => { event.preventDefault(); setFreshmanError(""); try { await startFreshman(form); } catch (reason) { setFreshmanError(reason instanceof Error ? reason.message : "정보를 확인해 주세요."); } }}>
        <p>학번과 성적표가 없어도 입학연도 요람과 현재 개설 과목으로 시간표를 준비할 수 있어요.</p>
        <label>이름 <small>선택</small><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="입력하지 않으면 ‘새내기’로 표시" /></label>
        <div><label>입학연도<select value={form.admissionYear} onChange={(event) => { const admissionYear = Number(event.target.value); setForm({ ...form, admissionYear, department: options.departments[admissionYear]?.[0] ?? "" }); }}>{options.years.map((year) => <option key={year}>{year}</option>)}</select></label><label>현재 학년<select value={form.studentYear} onChange={(event) => setForm({ ...form, studentYear: Number(event.target.value) })}>{[1, 2, 3, 4].map((year) => <option key={year} value={year}>{year}학년</option>)}</select></label></div>
        <label>학과<select value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })}>{(options.departments[form.admissionYear] ?? []).map((department) => <option key={department}>{department}</option>)}</select></label>
        <label>시작 학기<select value={form.semester} onChange={(event) => setForm({ ...form, semester: event.target.value })}><option>1학기</option><option>2학기</option></select></label>
        <ul className="freshman-tips"><li>수강바구니에 담아도 수강신청 완료가 아니므로 신청 기간에 다시 확인하세요.</li><li>수강신청 사이트 팝업을 허용하고, 신청 후에는 수강내역조회를 확인하세요.</li><li>학번 발급 후 성적표를 다시 올리면 실제 이수 내역으로 분석이 교체됩니다.</li></ul>
        {freshmanError && <span className="upload-error">{freshmanError}</span>}<button type="submit" disabled={!form.admissionYear || !form.department}>시간표 준비 시작</button>
      </form></Modal>
      <Modal open={guide} title="성적표 PDF 준비 방법" close={() => setGuide(false)}><ol className="pdf-guide"><li><b>학사정보시스템 접속</b><span><a href="https://kis.kku.ac.kr" target="_blank" rel="noreferrer">kis.kku.ac.kr</a>에 로그인합니다.</span></li><li><b>전체성적조회 열기</b><span>성적 → 전체성적 → 전체성적조회 순서로 이동합니다.</span></li><li><b>출력 → PDF로 저장</b><span>출력을 누른 뒤 이름, 학번, 이수구분, 학점과 등급이 보이는 원본 PDF로 저장합니다.</span></li><li><b>GradKUya에 업로드</b><span>캡처 이미지나 수정된 PDF가 아닌 저장한 원본을 사용해 주세요.</span></li></ol></Modal>
    </section>
    <aside className="start-visual"><div><span>01</span><b>PDF 업로드</b></div><i /><div><span>02</span><b>정보 자동 추출</b></div><i /><div><span>03</span><b>맞춤 졸업 분석</b></div></aside>
  </main>;
}

function DeveloperInfo() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const developer = process.env.NEXT_PUBLIC_DEVELOPER_NAME || "GradKUya 개발팀";
  const contact = process.env.NEXT_PUBLIC_DEVELOPER_CONTACT;
  const account = process.env.NEXT_PUBLIC_DONATION_ACCOUNT;
  return <><button className="developer-button" onClick={() => setOpen(true)}>개발자 · 커피 후원</button><Modal open={open} title="개발자 정보" close={() => setOpen(false)}><div className="developer-info">
    <div><span>개발</span><b>{developer}</b>{contact && <a href={`mailto:${contact}`}>{contact}</a>}</div>
    <div><span>커피 후원</span>{account ? <><b>{account}</b><button onClick={async () => { await navigator.clipboard.writeText(account); setCopied(true); }}>{copied ? "복사됨 ✓" : "계좌번호 복사"}</button></> : <small>후원 계좌가 아직 등록되지 않았습니다.</small>}</div>
    <p>후원은 선택이며 서비스 이용과 무관합니다.</p>
  </div></Modal></>;
}
