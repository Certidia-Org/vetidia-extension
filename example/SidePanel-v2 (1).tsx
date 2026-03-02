/**
 * Vetidia Extension — Side Panel v2
 *
 * Single-screen design. No tabs. One purpose: fill this application.
 *
 * States:
 *   1. Not on ATS page        → "Navigate to a job application"
 *   2. ATS detected, no auth  → "Sign in to autofill [N] fields"
 *   3. Scanning                → Live progress animation
 *   4. Fields ready            → Grouped by action needed, fill button
 *   5. Fill complete           → Success state with stats
 *
 * Key UX decisions:
 *   - Status pills are FILTERS (click to show only that group)
 *   - Checkboxes that share a parent question are GROUPED into one block
 *   - "Manual" fields split into Required (expanded) vs Optional (collapsed)
 *   - No per-field "Fill" buttons — bulk fill at bottom
 *   - File inputs render as file pickers, not text inputs
 *   - "Attach" labels detected as file upload fields
 */
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";

// ── Design Tokens ──
const EM = "oklch(0.7678 0.1655 162.1890)";
const AMBER = "oklch(0.78 0.16 80)";
const RED = "oklch(0.65 0.2 25)";
const BASE = "#0e0e0e";
const CARD = "#141414";
const BRD = "rgba(255,255,255,0.07)";
const BRD_L = "rgba(255,255,255,0.12)";
const TX = "rgba(255,255,255,0.88)";
const TX2 = "rgba(255,255,255,0.55)";
const TX3 = "rgba(255,255,255,0.35)";
const TX4 = "rgba(255,255,255,0.22)";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif";
const MONO = "ui-monospace,'Cascadia Code','Source Code Pro',Menlo,monospace";

// ── Types ──

interface FillField {
  id: string;
  label: string;
  tier: number | null;
  confidence: string;
  value: string;
  selector?: string;
  fieldType?: string;
  options?: string[];
  checked?: boolean;
  radioGroupName?: string;
  required?: boolean;
  status: "ready" | "suggested" | "manual";
}

interface JobDetected {
  ats: string;
  atsDisplayName: string;
  company: string;
  jobTitle: string;
  url: string;
  fieldCount: number;
}

interface ScanStatus {
  status: "idle" | "scanning" | "needs_auth" | "complete" | "no_fields" | "error";
  step?: string;
  error?: string;
}

interface ResumeItem {
  id: string;
  label: string;
  pdfUrl: string | null;
  storagePath: string | null;
}

interface CheckboxGroup {
  parentLabel: string;
  fields: FillField[];
  section: string;
}

type StatusFilter = "all" | "ready" | "suggested" | "manual";

// ── Classification helpers ──

function classifyField(f: { tier: number | null; confidence: string; value: string }): "ready" | "suggested" | "manual" {
  if (f.tier === 1 && f.value) return "ready";
  if ((f.tier === 2 || f.tier === 3) && f.value) return "suggested";
  return "manual";
}

function fieldSection(label: string): string {
  const l = label.toLowerCase();
  if (/^(first|last)?\s*name$|email|phone|address|city|state|zip|country|location/i.test(l)) return "Personal Info";
  if (/linkedin|portfolio|website|github|url/i.test(l)) return "Links";
  if (/authoriz|work.*auth|sponsor|visa|clearance|relocat|citizen|permit/i.test(l)) return "Work Authorization";
  if (/gender|sex.*orient|pronoun|race|ethni|veteran|disab|eeo|indigenous|identif/i.test(l)) return "Demographics & EEO";
  if (/arab|black|chinese|filipino|japanese|korean|latin|south\s*asian|southeast|west\s*asian|white|first\s*nation|metis|inuk/i.test(l)) return "Demographics & EEO";
  if (/coordin.*impair|mobility|speech|hearing|visual|learning|psychiatric|cognitive|physical.*disab/i.test(l)) return "Demographics & EEO";
  if (/salary|compensation|pay|wage|expect/i.test(l)) return "Compensation";
  if (/experience|company|employer|title|role|years.*exp/i.test(l)) return "Experience";
  if (/education|school|university|degree|gpa/i.test(l)) return "Education";
  if (/resume|cv|cover.*letter|attach|upload/i.test(l)) return "Documents";
  if (/start.*date|availab|notice|earliest/i.test(l)) return "Availability";
  if (/hear.*about|referr|source|how.*find/i.test(l)) return "Referral";
  return "Other Questions";
}

function isFileUploadField(f: FillField): boolean {
  if (f.fieldType === "file") return true;
  const l = f.label.toLowerCase().trim();
  if (l === "attach" || l === "attachment") return true;
  if (/resume.*upload|upload.*resume|attach.*resume|attach.*cv/i.test(l)) return true;
  if (/cover.*letter.*upload|upload.*cover|attach.*cover/i.test(l)) return true;
  return false;
}

function needsTextarea(label: string): boolean {
  return /why|describe|tell\s|explain|interest|motivation|about.*you|cover.*letter|additional.*info|comments|notes|salary|expectations|compensation/i.test(label);
}

function groupCheckboxFields(fields: FillField[]): { singles: FillField[]; groups: CheckboxGroup[] } {
  const singles: FillField[] = [];
  const groups: CheckboxGroup[] = [];
  const ETHNICITY = /^(arab|black|chinese|filipino|japanese|korean|latin\s*american|south\s*asian|southeast\s*asian|west\s*asian|white)$/i;
  const INDIGENOUS = /^(first\s*nations?|metis|inuk|inuit)$/i;
  const DISABILITY = /^(coordination|mobility|speech|hearing|visual|learning|psychiatric|non-visible|developmental|ongoing|i\s*don)/i;
  const ethnicity: FillField[] = [];
  const indigenous: FillField[] = [];
  const disability: FillField[] = [];

  for (const f of fields) {
    if (f.fieldType !== "checkbox") { singles.push(f); continue; }
    const l = f.label.trim();
    if (ETHNICITY.test(l)) ethnicity.push(f);
    else if (INDIGENOUS.test(l)) indigenous.push(f);
    else if (DISABILITY.test(l)) disability.push(f);
    else singles.push(f);
  }

  if (ethnicity.length > 1) groups.push({ parentLabel: "Ethnic group(s) you identify with", fields: ethnicity, section: "Demographics & EEO" });
  else singles.push(...ethnicity);
  if (indigenous.length > 1) groups.push({ parentLabel: "Do you identify as indigenous?", fields: indigenous, section: "Demographics & EEO" });
  else singles.push(...indigenous);
  if (disability.length > 1) groups.push({ parentLabel: "Disability or impairment", fields: disability, section: "Demographics & EEO" });
  else singles.push(...disability);

  return { singles, groups };
}

// ═══════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════

export default function SidePanel() {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [job, setJob] = useState<JobDetected | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus>({ status: "idle" });
  const [fields, setFields] = useState<FillField[]>([]);
  const [resumes, setResumes] = useState<ResumeItem[]>([]);
  const [coverLetters, setCoverLetters] = useState<ResumeItem[]>([]);
  const [selectedResume, setSelectedResume] = useState<string>("");
  const [selectedCover, setSelectedCover] = useState<string>("");
  const [filling, setFilling] = useState(false);
  const [fillResult, setFillResult] = useState<{ filled: number; total: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // ── Computed ──
  const nonFileFields = useMemo(() => fields.filter((f) => !isFileUploadField(f)), [fields]);
  const fileUploadFields = useMemo(() => fields.filter((f) => isFileUploadField(f)), [fields]);
  const readyFields = useMemo(() => nonFileFields.filter((f) => f.status === "ready"), [nonFileFields]);
  const suggestedFields = useMemo(() => nonFileFields.filter((f) => f.status === "suggested"), [nonFileFields]);
  const manualFields = useMemo(() => nonFileFields.filter((f) => f.status === "manual"), [nonFileFields]);
  const manualRequired = useMemo(() => manualFields.filter((f) => f.required), [manualFields]);
  const manualOptional = useMemo(() => manualFields.filter((f) => !f.required), [manualFields]);
  const fillableFields = useMemo(() => fields.filter((f) => (f.value || f.checked !== undefined) && !isFileUploadField(f)), [fields]);

  const groupedReady = useMemo(() => groupCheckboxFields(readyFields), [readyFields]);
  const groupedSuggested = useMemo(() => groupCheckboxFields(suggestedFields), [suggestedFields]);
  const groupedManualReq = useMemo(() => groupCheckboxFields(manualRequired), [manualRequired]);
  const groupedManualOpt = useMemo(() => groupCheckboxFields(manualOptional), [manualOptional]);

  const parseFields = useCallback((rawFields: unknown[]) => {
    return rawFields.map((x: unknown) => {
      const f = x as Record<string, unknown>;
      return {
        id: f.id as string, label: f.label as string,
        tier: (f.tier as number) ?? null, confidence: (f.confidence as string) || "none",
        value: (f.value as string) || "", selector: f.selector as string,
        fieldType: (f.fieldType as string) || "input", options: f.options as string[],
        checked: f.checked as boolean, radioGroupName: f.radioGroupName as string,
        required: (f.required as boolean) ?? false,
        status: classifyField({ tier: (f.tier as number) ?? null, confidence: (f.confidence as string) || "none", value: (f.value as string) || "" }),
      };
    });
  }, []);

  // ── Init ──
  useEffect(() => {
    let m = true;
    (async () => {
      try { const a = await chrome.runtime.sendMessage({ type: "GET_AUTH_STATE" }); if (m && a?.user) setUser(a.user); } catch {}
      try { const p = await chrome.runtime.sendMessage({ type: "GET_CACHED_PROFILE" }); if (m && p?.profile) setProfile(p.profile); } catch {}
      try {
        const ts = await chrome.runtime.sendMessage({ type: "GET_TAB_STATE" });
        if (m && ts?.state) {
          restoreTabState(ts.state as Record<string, unknown>);
        }
      } catch {}
      // If no stored state and we're on an ATS page, trigger a scan
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url) {
          const ats = ["greenhouse.io","lever.co","myworkdayjobs.com","ashbyhq.com","icims.com","smartrecruiters.com","linkedin.com/jobs","taleo.net","breezy.hr","bamboohr.com","jazz.co","jobvite.com","recruitee.com","workable.com"];
          if (ats.some((p) => tab.url!.includes(p)) && tab.id) {
            try { await chrome.tabs.sendMessage(tab.id, { type: "RESCAN_FIELDS" }); }
            catch { try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content-scripts/content.js"] }); } catch {} }
          }
        }
      } catch {}
      try {
        const r = await chrome.runtime.sendMessage({ type: "GET_USER_RESUMES" });
        if (m && r?.resumes?.length) { setResumes(r.resumes); setSelectedResume(r.resumes[0].id); }
        if (m && r?.coverLetters?.length) setCoverLetters(r.coverLetters);
      } catch {}
    })();
    return () => { m = false; };
  }, [parseFields, restoreTabState]);

  // ── Restore full state from a tab context payload ──
  const restoreTabState = useCallback((payload: Record<string, unknown>) => {
    const jobData = payload.job as JobDetected | null;
    const fieldsData = payload.fields as Record<string, unknown> | null;
    const scanData = payload.scanStatus as ScanStatus | null;
    const fillData = payload.fillResult as { filled: number; total: number } | null;

    setJob(jobData || null);
    setFillResult(fillData || null);
    setFilling(false);
    setStatusFilter("all");

    if (fieldsData?.fields) {
      setFields(parseFields(fieldsData.fields as unknown[]));
      setScanStatus(scanData || { status: "complete" });
    } else {
      setFields([]);
      setScanStatus(scanData || { status: jobData ? "idle" : "idle" });
    }
  }, [parseFields]);

  // ── Listen for messages (including TAB_CONTEXT_CHANGED) ──
  useEffect(() => {
    const listener = (msg: Record<string, unknown>) => {
      // ★ TAB SWITCH — this is the instant context swap
      if (msg.type === "TAB_CONTEXT_CHANGED") {
        restoreTabState(msg.payload as Record<string, unknown>);
        return;
      }
      // Content script pushed new data for the current tab
      if (msg.type === "JOB_PAGE_DETECTED") { setJob(msg.payload as JobDetected); setFillResult(null); setFields([]); setScanStatus({ status: "idle" }); setStatusFilter("all"); }
      if (msg.type === "SCAN_STATUS") setScanStatus(msg.payload as ScanStatus);
      if (msg.type === "FIELDS_SCANNED") { const f = msg.payload as Record<string, unknown>; setFields(parseFields((f.fields as unknown[]) || [])); setScanStatus({ status: "complete" }); }
      if (msg.type === "FILL_COMPLETE") {
        const p = msg.payload as { filledCount: number; total: number };
        setFillResult({ filled: p.filledCount, total: p.total }); setFilling(false);
        // Persist fill result to tab state
        chrome.runtime.sendMessage({ type: "SAVE_PANEL_STATE", payload: { fillResult: { filled: p.filledCount, total: p.total } } }).catch(() => {});
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [parseFields, restoreTabState]);

  // ── Actions ──
  const handleSignIn = useCallback(async () => {
    setSigningIn(true);
    try {
      const result = await chrome.runtime.sendMessage({ type: "SIGN_IN" });
      if (result?.user) {
        setUser(result.user);
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "RESCAN_FIELDS" }).catch(() => {});
        const pr = await chrome.runtime.sendMessage({ type: "GET_CACHED_PROFILE" }); if (pr?.profile) setProfile(pr.profile);
      }
    } catch {} setSigningIn(false);
  }, []);

  const handleSignOut = useCallback(async () => {
    await chrome.runtime.sendMessage({ type: "SIGN_OUT" }).catch(() => {});
    setUser(null); setProfile(null); setFields([]); setScanStatus({ status: "idle" });
  }, []);

  const handleRescan = useCallback(async () => {
    setScanStatus({ status: "scanning", step: "Starting scan..." }); setFields([]); setFillResult(null); setStatusFilter("all");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try { await chrome.tabs.sendMessage(tab.id, { type: "RESCAN_FIELDS" }); }
    catch { try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content-scripts/content.js"] }); await new Promise((r) => setTimeout(r, 1500)); await chrome.tabs.sendMessage(tab.id, { type: "RESCAN_FIELDS" }).catch(() => {}); } catch {} }
  }, []);

  // ── Debounced save of field state back to background per-tab storage ──
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveFieldsToTab = useCallback((updatedFields: FillField[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      chrome.runtime.sendMessage({
        type: "SAVE_PANEL_STATE",
        payload: {
          fields: {
            fields: updatedFields.map((f) => ({
              id: f.id, label: f.label, tier: f.tier, confidence: f.confidence,
              value: f.value, selector: f.selector, fieldType: f.fieldType,
              options: f.options, checked: f.checked, radioGroupName: f.radioGroupName,
              required: f.required,
            })),
          },
        },
      }).catch(() => {});
    }, 300);
  }, []);

  const handleFieldEdit = useCallback((fieldId: string, newValue: string, newChecked?: boolean) => {
    setFields((prev) => {
      const updated = prev.map((f) => f.id === fieldId ? { ...f, value: newValue, checked: newChecked ?? f.checked, status: (newValue ? "suggested" : "manual") as "suggested" | "manual" } : f);
      saveFieldsToTab(updated);
      return updated;
    });
  }, [saveFieldsToTab]);

  const handleFill = useCallback(async () => {
    setFilling(true); setFillResult(null);
    try {
      const toFill = fields.filter((f) => (f.value || f.checked !== undefined) && !isFileUploadField(f));
      await chrome.runtime.sendMessage({ type: "PANEL_FILL_FIELDS", payload: { fields: toFill.map((f) => ({ selector: f.selector || f.id, value: f.value, fieldType: f.fieldType, checked: f.checked, radioGroupName: f.radioGroupName })) } });
    } catch { setFilling(false); }
  }, [fields]);

  const handleUploadFile = useCallback(async (type: "resume" | "cover_letter") => {
    const id = type === "resume" ? selectedResume : selectedCover;
    if (!id) return;
    const item = (type === "resume" ? resumes : coverLetters).find((r) => r.id === id);
    if (!item?.pdfUrl) return;
    await chrome.runtime.sendMessage({ type: "TRIGGER_FILE_UPLOAD", payload: { fileUrl: item.storagePath || item.pdfUrl, fileName: `${item.label}.pdf`, inputType: type } }).catch(() => {});
  }, [selectedResume, selectedCover, resumes, coverLetters]);

  const toggleFilter = useCallback((f: StatusFilter) => setStatusFilter((p) => p === f ? "all" : f), []);

  // ═══════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════
  const hasFields = nonFileFields.length > 0;

  return (
    <div style={{ width: "100%", height: "100vh", background: BASE, color: TX, fontFamily: SANS, display: "flex", flexDirection: "column", overflow: "hidden", fontSize: 12, lineHeight: 1.5 }}>

      {/* ── Header ── */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: `1px solid ${BRD}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0, background: `linear-gradient(135deg, ${EM}, oklch(0.6 0.14 162))`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#000" }}>V</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: TX, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{job ? job.company : "Vetidia"}</div>
            <div style={{ fontSize: 10, color: TX3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{job?.jobTitle || (user ? user.email : "Not signed in")}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
          {job && <span style={{ fontSize: 8, fontWeight: 700, color: EM, letterSpacing: "0.06em", padding: "2px 5px", borderRadius: 3, background: `color-mix(in srgb, ${EM} 12%, transparent)` }}>{(job.atsDisplayName || job.ats || "").toUpperCase()}</span>}
          <button onClick={() => setShowSettings(!showSettings)} style={{ background: "none", border: "none", cursor: "pointer", padding: 3, color: showSettings ? EM : TX4, transition: "color 0.15s", display: "flex" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          </button>
        </div>
      </header>

      {/* ── Settings drawer ── */}
      {showSettings && (
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${BRD}`, background: "rgba(255,255,255,0.015)", flexShrink: 0 }}>
          <div style={{ fontSize: 9, color: TX4, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 6 }}>Account</div>
          {user ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10, color: TX3, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{user.email}</span>
              <Pill onClick={handleRescan}>Sync</Pill>
              <Pill onClick={handleSignOut} danger>Sign out</Pill>
            </div>
          ) : (
            <Pill onClick={handleSignIn} disabled={signingIn} primary>{signingIn ? "Signing in..." : "Sign in with Google"}</Pill>
          )}
          {job?.url && <a href={`https://vetidia.app/jobs?url=${encodeURIComponent(job.url)}`} target="_blank" rel="noreferrer" style={{ display: "block", fontSize: 9, color: EM, marginTop: 6, textDecoration: "none" }}>Open in Vetidia ↗</a>}
          <div style={{ fontSize: 9, color: TX4, marginTop: 6 }}>v0.3.0</div>
        </div>
      )}

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>

        {!job && <EmptyState icon="🔍" title="No application detected" subtitle="Navigate to a job on Greenhouse, Lever, Workday, Ashby, or any supported ATS." />}

        {job && !user && scanStatus.status !== "scanning" && (
          <div style={{ padding: 14 }}>
            <Card glow><div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TX, marginBottom: 4 }}>Sign in to autofill</div>
              <div style={{ fontSize: 11, color: TX3, lineHeight: 1.5, marginBottom: 12 }}>{job.fieldCount ? `Found ${job.fieldCount} fields` : "Fields detected"} on this {job.atsDisplayName || job.ats} application.</div>
              <button onClick={handleSignIn} disabled={signingIn} style={{ width: "100%", padding: "9px 0", borderRadius: 6, border: "none", background: EM, color: "#000", fontSize: 12, fontWeight: 600, fontFamily: SANS, cursor: "pointer" }}>{signingIn ? "Signing in..." : "Sign in with Google"}</button>
            </div></Card>
          </div>
        )}

        {job && scanStatus.status === "scanning" && (
          <div style={{ padding: 14 }}><Card><Spinner step={scanStatus.step || "Scanning..."} /></Card></div>
        )}

        {job && user && scanStatus.status === "needs_auth" && (
          <div style={{ padding: 14 }}><Card><div style={{ fontSize: 12, color: AMBER, fontWeight: 600, marginBottom: 4 }}>Profile not found</div><div style={{ fontSize: 11, color: TX3, lineHeight: 1.5, marginBottom: 10 }}>Set up your profile on vetidia.app first.</div><Pill onClick={handleRescan}>Retry</Pill></Card></div>
        )}

        {/* ── FIELDS READY ── */}
        {job && hasFields && !fillResult && (
          <>
            {/* Filter bar */}
            <div style={{ display: "flex", gap: 4, padding: "8px 14px", borderBottom: `1px solid ${BRD}`, flexShrink: 0 }}>
              <FilterPill color={EM} count={readyFields.length} label="Ready" active={statusFilter === "ready"} onClick={() => toggleFilter("ready")} />
              <FilterPill color={AMBER} count={suggestedFields.length} label="Review" active={statusFilter === "suggested"} onClick={() => toggleFilter("suggested")} />
              <FilterPill color={TX3} count={manualFields.length} label="Manual" active={statusFilter === "manual"} onClick={() => toggleFilter("manual")} />
            </div>

            {/* Documents */}
            {(resumes.length > 0 || fileUploadFields.length > 0) && (statusFilter === "all" || statusFilter === "manual") && (
              <div style={{ padding: "8px 14px", borderBottom: `1px solid ${BRD}` }}>
                {resumes.length > 0 && <FilePicker label="Resume" items={resumes} selected={selectedResume} onSelect={setSelectedResume} onUpload={() => handleUploadFile("resume")} />}
                {coverLetters.length > 0 && <FilePicker label="Cover letter" items={coverLetters} selected={selectedCover} onSelect={setSelectedCover} onUpload={() => handleUploadFile("cover_letter")} />}
              </div>
            )}

            {/* Required manual fields (always expanded) */}
            {(statusFilter === "all" || statusFilter === "manual") && manualRequired.length > 0 && (
              <FieldGroup title={`Required (${manualRequired.length})`} color={RED} defaultOpen={true} grouped={groupedManualReq} onEdit={handleFieldEdit} />
            )}

            {/* Optional manual fields (collapsed when viewing all) */}
            {(statusFilter === "all" || statusFilter === "manual") && manualOptional.length > 0 && (
              <FieldGroup title={`Optional (${manualOptional.length})`} color={TX4} defaultOpen={statusFilter === "manual"} grouped={groupedManualOpt} onEdit={handleFieldEdit} />
            )}

            {/* Review fields */}
            {(statusFilter === "all" || statusFilter === "suggested") && suggestedFields.length > 0 && (
              <FieldGroup title={`Review (${suggestedFields.length})`} color={AMBER} defaultOpen={true} grouped={groupedSuggested} onEdit={handleFieldEdit} />
            )}

            {/* Auto-filled (collapsed when viewing all) */}
            {(statusFilter === "all" || statusFilter === "ready") && readyFields.length > 0 && (
              <FieldGroup title={`Auto-filled (${readyFields.length})`} color={EM} defaultOpen={statusFilter === "ready"} grouped={groupedReady} onEdit={handleFieldEdit} />
            )}
          </>
        )}

        {/* Fill complete */}
        {fillResult && (
          <div style={{ padding: 14 }}><Card glow><div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>✓</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: EM, marginBottom: 3 }}>{fillResult.filled} of {fillResult.total} fields filled</div>
            <div style={{ fontSize: 11, color: TX3, marginBottom: 12 }}>Review the form and submit when ready.</div>
            <div style={{ display: "flex", gap: 6 }}><Pill onClick={() => setFillResult(null)} style={{ flex: 1 }}>Back</Pill><Pill onClick={handleRescan} primary style={{ flex: 1 }}>Re-scan</Pill></div>
          </div></Card></div>
        )}

        {job && user && !hasFields && !fillResult && scanStatus.status === "idle" && (
          <div style={{ padding: 14 }}><Card><div style={{ textAlign: "center" }}><div style={{ fontSize: 11, color: TX3, marginBottom: 10 }}>Waiting for scan...</div><Pill onClick={handleRescan} primary>Scan now</Pill></div></Card></div>
        )}

        {job && scanStatus.status === "no_fields" && !hasFields && (
          <div style={{ padding: 14 }}><Card><div style={{ textAlign: "center" }}><div style={{ fontSize: 11, color: TX3, marginBottom: 10 }}>No form fields found. Try scrolling to load the form.</div><Pill onClick={handleRescan}>Retry</Pill></div></Card></div>
        )}
      </div>

      {/* ── Footer ── */}
      {hasFields && !fillResult && (
        <div style={{ padding: "8px 12px", borderTop: `1px solid ${BRD}`, display: "flex", gap: 6, flexShrink: 0, background: BASE }}>
          <Pill onClick={handleRescan} disabled={filling}>Re-scan</Pill>
          <button onClick={handleFill} disabled={filling || fillableFields.length === 0} style={{
            flex: 1, padding: "8px 0", borderRadius: 6, border: "none",
            background: filling ? TX3 : EM, color: "#000", fontSize: 12, fontWeight: 600,
            fontFamily: SANS, cursor: filling ? "default" : "pointer",
            opacity: fillableFields.length === 0 ? 0.4 : 1, transition: "all 0.15s",
          }}>{filling ? "Filling..." : `⚡ Fill ${fillableFields.length} Fields`}</button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════

function Pill({ children, onClick, disabled, primary, danger, style: sx }: { children: ReactNode; onClick?: () => void; disabled?: boolean; primary?: boolean; danger?: boolean; style?: CSSProperties }) {
  return <button onClick={onClick} disabled={disabled} style={{
    padding: "5px 10px", borderRadius: 5, fontSize: 10, fontWeight: 500, fontFamily: SANS,
    cursor: disabled ? "default" : "pointer",
    border: `1px solid ${primary ? EM : danger ? `color-mix(in srgb, ${RED} 30%, transparent)` : BRD}`,
    background: primary ? EM : "rgba(255,255,255,0.03)",
    color: primary ? "#000" : danger ? RED : TX2,
    opacity: disabled ? 0.5 : 1, transition: "all 0.15s", ...sx,
  }}>{children}</button>;
}

function Card({ children, glow }: { children: ReactNode; glow?: boolean }) {
  return <div style={{
    background: CARD, borderRadius: 8, padding: 16,
    border: `1px solid ${glow ? `color-mix(in srgb, ${EM} 20%, ${BRD})` : BRD}`,
  }}>{children}</div>;
}

function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "50px 20px", textAlign: "center" }}>
    <div style={{ fontSize: 28, marginBottom: 10 }}>{icon}</div>
    <div style={{ fontSize: 12, fontWeight: 500, color: TX2, marginBottom: 4 }}>{title}</div>
    <div style={{ fontSize: 10, color: TX4, lineHeight: 1.6, maxWidth: 230 }}>{subtitle}</div>
  </div>;
}

function Spinner({ step }: { step: string }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <div style={{ width: 18, height: 18, border: `2px solid ${BRD_L}`, borderTopColor: EM, borderRadius: "50%", animation: "vetidiaSpin 0.8s linear infinite", flexShrink: 0 }} />
    <style>{`@keyframes vetidiaSpin { to { transform: rotate(360deg); } }`}</style>
    <span style={{ fontSize: 11, color: TX2 }}>{step}</span>
  </div>;
}

function FilterPill({ color, count, label, active, onClick }: { color: string; count: number; label: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} style={{
    display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 5,
    cursor: "pointer", border: "none", fontFamily: SANS,
    background: active ? `color-mix(in srgb, ${color} 18%, transparent)` : "rgba(255,255,255,0.02)",
    outline: active ? `1px solid color-mix(in srgb, ${color} 30%, transparent)` : "1px solid transparent",
    transition: "all 0.15s",
  }}>
    <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, flexShrink: 0 }} />
    <span style={{ fontSize: 10, fontWeight: 600, fontFamily: MONO, color: active ? color : TX3 }}>{count}</span>
    <span style={{ fontSize: 9, color: active ? color : TX4 }}>{label}</span>
  </button>;
}

function FilePicker({ label, items, selected, onSelect, onUpload }: { label: string; items: ResumeItem[]; selected: string; onSelect: (id: string) => void; onUpload: () => void }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
    <span style={{ fontSize: 10, color: TX3, minWidth: 55, flexShrink: 0 }}>{label}</span>
    <div style={{ flex: 1, minWidth: 0, position: "relative" as const }}>
      <select value={selected} onChange={(e) => onSelect(e.target.value)} style={{
        width: "100%", padding: "4px 20px 4px 6px", borderRadius: 4, fontSize: 10,
        background: "rgba(255,255,255,0.04)", border: `1px solid ${BRD}`,
        color: TX2, fontFamily: SANS, outline: "none",
        appearance: "none" as const, WebkitAppearance: "none" as const,
      }}>
        <option value="">None</option>
        {items.map((r) => <option key={r.id} value={r.id}>{r.label.length > 30 ? r.label.slice(0, 27) + "…" : r.label}</option>)}
      </select>
      <span style={{ position: "absolute" as const, right: 6, top: "50%", transform: "translateY(-50%)", fontSize: 8, color: TX4, pointerEvents: "none" as const }}>▼</span>
    </div>
    <Pill onClick={onUpload} disabled={!selected} style={{ padding: "3px 6px", fontSize: 9 }}>↑</Pill>
  </div>;
}

// ═══════════════════════════════════════════
// FIELD GROUPS & ROWS
// ═══════════════════════════════════════════

function FieldGroup({ title, color, defaultOpen, grouped, onEdit }: {
  title: string; color: string; defaultOpen: boolean;
  grouped: ReturnType<typeof groupCheckboxFields>;
  onEdit: (id: string, value: string, checked?: boolean) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (grouped.singles.length + grouped.groups.length === 0) return null;

  const sectionMap: Record<string, FillField[]> = {};
  for (const f of grouped.singles) {
    const sec = fieldSection(f.label);
    if (!sectionMap[sec]) sectionMap[sec] = [];
    sectionMap[sec].push(f);
  }

  return <div style={{ borderBottom: `1px solid ${BRD}` }}>
    <button onClick={() => setOpen(!open)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left" as const }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: TX2, flex: 1 }}>{title}</span>
      <span style={{ fontSize: 9, color: TX4, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▸</span>
    </button>
    {open && <div style={{ padding: "0 10px 10px" }}>
      {grouped.groups.map((g) => <CbGroup key={g.parentLabel} group={g} onEdit={onEdit} />)}
      {Object.entries(sectionMap).map(([sec, flds]) => <div key={sec}>
        {Object.keys(sectionMap).length > 1 && <div style={{ fontSize: 9, color: TX4, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.05em", padding: "8px 4px 3px" }}>{sec}</div>}
        {flds.map((f) => <FieldRow key={f.id} field={f} onEdit={onEdit} />)}
      </div>)}
    </div>}
  </div>;
}

/** Grouped checkboxes as compact chip grid */
function CbGroup({ group, onEdit }: { group: CheckboxGroup; onEdit: (id: string, value: string, checked?: boolean) => void }) {
  const [expanded, setExpanded] = useState(false);
  const selected = group.fields.filter((f) => f.checked).length;

  return <div style={{ background: "rgba(255,255,255,0.015)", border: `1px solid ${BRD}`, borderRadius: 6, padding: "8px 10px", marginBottom: 6 }}>
    <button onClick={() => setExpanded(!expanded)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, width: "100%", display: "flex", alignItems: "center", gap: 6, textAlign: "left" as const }}>
      <span style={{ fontSize: 11, color: TX2, flex: 1, lineHeight: 1.4 }}>{group.parentLabel}</span>
      <span style={{ fontSize: 9, color: selected > 0 ? EM : TX4 }}>{selected > 0 ? `${selected} sel` : `${group.fields.length} opts`}</span>
      <span style={{ fontSize: 9, color: TX4, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▸</span>
    </button>
    {expanded && <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 4, marginTop: 8 }}>
      {group.fields.map((f) => (
        <label key={f.id} style={{
          display: "flex", alignItems: "center", gap: 3,
          padding: "3px 8px", borderRadius: 4, cursor: "pointer", fontSize: 10,
          color: f.checked ? TX : TX3,
          background: f.checked ? `color-mix(in srgb, ${EM} 15%, transparent)` : "rgba(255,255,255,0.03)",
          border: `1px solid ${f.checked ? `color-mix(in srgb, ${EM} 25%, transparent)` : "rgba(255,255,255,0.05)"}`,
          transition: "all 0.15s",
        }}>
          <input type="checkbox" checked={!!f.checked} onChange={(e) => onEdit(f.id, e.target.checked ? "true" : "false", e.target.checked)} style={{ display: "none" }} />
          {f.checked && <span style={{ color: EM, fontSize: 9 }}>✓</span>}
          {f.label}
        </label>
      ))}
    </div>}
  </div>;
}

/** Individual field row — no Fill button */
function FieldRow({ field, onEdit }: { field: FillField; onEdit: (id: string, value: string, checked?: boolean) => void }) {
  if (isFileUploadField(field)) return null;

  const sc = field.status === "ready" ? EM : field.status === "suggested" ? AMBER : TX4;
  const si = field.status === "ready" ? "✓" : field.status === "suggested" ? "≈" : "·";
  const inp: CSSProperties = { width: "100%", background: "rgba(255,255,255,0.04)", border: `1px solid ${BRD}`, borderRadius: 4, padding: "5px 8px", fontSize: 11, color: TX, fontFamily: SANS, boxSizing: "border-box" as const, outline: "none" };

  const ctrl = () => {
    if (field.fieldType === "checkbox") {
      return <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "2px 0" }}>
        <div onClick={() => onEdit(field.id, field.checked ? "false" : "true", !field.checked)} style={{ width: 32, height: 18, borderRadius: 9, cursor: "pointer", background: field.checked ? EM : "rgba(255,255,255,0.1)", transition: "background 0.2s", display: "flex", alignItems: "center", padding: "0 2px" }}>
          <div style={{ width: 14, height: 14, borderRadius: "50%", background: field.checked ? "#000" : "rgba(255,255,255,0.4)", transform: field.checked ? "translateX(14px)" : "translateX(0)", transition: "transform 0.2s, background 0.2s" }} />
        </div>
        <span style={{ fontSize: 10, color: TX3 }}>{field.checked ? "Yes" : "No"}</span>
      </label>;
    }
    if (field.fieldType === "select" && field.options?.length) {
      return <select value={field.value} onChange={(e) => onEdit(field.id, e.target.value)} style={inp}>
        <option value="">Select...</option>
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>;
    }
    if (field.fieldType === "radio-group" && field.options?.length) {
      return <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 4 }}>
        {field.options.map((o) => <label key={o} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: TX2, cursor: "pointer", padding: "2px 6px", borderRadius: 4, background: field.value === o ? `color-mix(in srgb, ${EM} 12%, transparent)` : "transparent" }}>
          <input type="radio" name={field.radioGroupName || field.id} checked={field.value === o} onChange={() => onEdit(field.id, o)} style={{ display: "none" }} />
          <span style={{ width: 10, height: 10, borderRadius: "50%", border: `1.5px solid ${field.value === o ? EM : TX4}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {field.value === o && <span style={{ width: 5, height: 5, borderRadius: "50%", background: EM }} />}
          </span>{o}
        </label>)}
      </div>;
    }
    if (needsTextarea(field.label)) {
      return <textarea value={field.value} onChange={(e) => onEdit(field.id, e.target.value)} rows={3} placeholder={field.required ? "Required" : "Optional"} style={{ ...inp, resize: "vertical" as const, minHeight: 54, lineHeight: 1.4 }} />;
    }
    return <input type="text" value={field.value} onChange={(e) => onEdit(field.id, e.target.value)} placeholder={field.required ? "Required" : "Optional"} style={inp} />;
  };

  return <div style={{ padding: "6px 4px", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
      <span style={{ fontSize: 9, color: sc, fontWeight: 700, flexShrink: 0 }}>{si}</span>
      <span style={{ fontSize: 10, color: TX2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
        {field.label}{field.required && <span style={{ color: RED, marginLeft: 2 }}>*</span>}
      </span>
    </div>
    {ctrl()}
  </div>;
}
