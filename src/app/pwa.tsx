"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function PwaControls() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    const installed = window.matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js");
      else navigator.serviceWorker.getRegistrations().then((registrations) => registrations.forEach((registration) => registration.unregister()));
    }
    const ready = (event: Event) => {
      event.preventDefault();
      if (!installed && !sessionStorage.getItem("install-dismissed")) setPrompt(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", ready);
    return () => window.removeEventListener("beforeinstallprompt", ready);
  }, []);

  if (!prompt) return null;
  return <aside className="install-app"><span><b>앱으로 더 빠르게 확인하세요</b>홈 화면에 설치하면 빈자리 알림을 놓치지 않아요.</span><button onClick={async () => {
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
  }}>설치</button><button aria-label="설치 안내 닫기" onClick={() => { sessionStorage.setItem("install-dismissed", "1"); setPrompt(null); }}>×</button></aside>;
}

const tutorialSteps = [
  ["성적표 PDF로 시작", "kis.kku.ac.kr의 성적 → 전체성적 → 전체성적조회에서 출력한 PDF를 올려 주세요."],
  ["졸업요건 확인", "실제 성적, 입학연도 요람, 현재 요람 순서로 남은 학점과 필수 과목을 확인합니다."],
  ["시간표 직접 조정", "추천 시간표의 요일을 누르면 공강으로, 시간 칸을 누르면 제외 시간으로 반영됩니다."],
  ["빈자리 알림 연결", "과목의 종 버튼을 켜고 Discord 웹훅을 연결하면 데스크톱 감시 결과를 모바일로 받을 수 있습니다."],
] as const;

export function FirstVisitTutorial() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const visible = mounted && !dismissed && !localStorage.getItem("tutorial-complete");

  useEffect(() => {
    const dialog = ref.current;
    if (visible && dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
  }, [visible]);

  function finish() {
    localStorage.setItem("tutorial-complete", "1");
    ref.current?.close();
    setDismissed(true);
  }

  return <dialog ref={ref} className="tutorial-modal" onCancel={finish}><div className="tutorial-sheet">
    <div className="tutorial-progress">{tutorialSteps.map((_, index) => <i className={index <= step ? "active" : ""} key={index} />)}</div>
    <span className="tutorial-number">{String(step + 1).padStart(2, "0")}</span>
    <h2>{tutorialSteps[step][0]}</h2><p>{tutorialSteps[step][1]}</p>
    <div className="tutorial-actions"><button onClick={finish}>이미 사용해봤어요</button><span>{step > 0 && <button onClick={() => setStep(step - 1)}>이전</button>}<button className="next" onClick={() => step === tutorialSteps.length - 1 ? finish() : setStep(step + 1)}>{step === tutorialSteps.length - 1 ? "시작하기" : "다음"}</button></span></div>
  </div></dialog>;
}

export function BugReportButton() {
  const ref = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState({ title: "", description: "", steps: "", contact: "" });
  const [status, setStatus] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  function open() {
    setStatus("");
    if (typeof ref.current?.showModal === "function") ref.current.showModal();
    else ref.current?.setAttribute("open", "");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("전송 중...");
    const body = new FormData();
    Object.entries({ ...form, page: location.pathname, userAgent: navigator.userAgent }).forEach(([key, value]) => body.append(key, value));
    files.forEach((file) => body.append("files", file));
    const response = await fetch("/api/bug-report", { method: "POST", body });
    const result = await response.json();
    if (!response.ok) return setStatus(result.error ?? "제보를 전송하지 못했습니다.");
    setForm({ title: "", description: "", steps: "", contact: "" });
    setFiles([]);
    setStatus("제보가 전송됐습니다. 감사합니다.");
  }

  return <><button className="bug-report-button" onClick={open}>버그 제보</button><dialog ref={ref} className="app-modal bug-report-modal"><div className="modal-sheet"><header><h2>버그 제보</h2><button aria-label="닫기" onClick={() => ref.current?.close()}>×</button></header><div className="modal-body"><form className="bug-report-form" onSubmit={submit}>
    <p>개발자 Discord로 전달됩니다. 성적표 내용, 학번, 웹훅 URL 같은 개인정보는 적지 마세요.</p>
    <label>제목<input required maxLength={100} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="예: 모바일에서 시간표가 잘려 보여요" /></label>
    <label>문제 설명<textarea required maxLength={1500} rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="기대한 동작과 실제 동작을 적어 주세요." /></label>
    <label>재현 방법 <small>선택</small><textarea maxLength={1000} rows={3} value={form.steps} onChange={(event) => setForm({ ...form, steps: event.target.value })} placeholder={"1. 시간표 설계 열기\n2. 과목 선택하기\n3. 오류 발생"} /></label>
    <label>이미지·파일 <small>선택 · 최대 3개, 각 5MB</small><input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,.log" onChange={(event) => { const selected = [...(event.target.files ?? [])].slice(0, 3); if (selected.some((file) => file.size > 5 * 1024 * 1024)) setStatus("파일은 각각 5MB 이하여야 합니다."); else { setFiles(selected); setStatus(""); } }} /></label>
    {files.length > 0 && <div className="bug-files">{files.map((file, index) => <span key={`${file.name}-${file.lastModified}`}>{file.name}<button type="button" aria-label={`${file.name} 제거`} onClick={() => setFiles(files.filter((_, fileIndex) => fileIndex !== index))}>×</button></span>)}</div>}
    <label>회신 연락처 <small>선택</small><input maxLength={100} value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} placeholder="이메일 또는 Discord 아이디" /></label>
    <button type="submit" disabled={status === "전송 중..."}>제보 보내기</button>{status && <span>{status}</span>}
  </form></div></div></dialog></>;
}
