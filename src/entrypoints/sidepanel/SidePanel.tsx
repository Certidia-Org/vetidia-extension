/**
 * Vetidia Extension — Side Panel
 *
 * Single-screen design. No tabs. One purpose: fill this application.
 *
 * States:
 *   1. Not on ATS page     → "Navigate to a job application"
 *   2. ATS detected, no auth → "Sign in to autofill [N] fields"
 *   3. Scanning             → Live progress animation
 *   4. Fields ready         → Grouped by action needed, fill button
 *   5. Fill complete        → Success state with stats
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import type { CSSProperties } from "react";

// ── Design Tokens (inline for single-file simplicity) ──
const EM = "oklch(0.7678 0.1655 162.1890)";
const BLUE = "oklch(0.7 0.15 250)";
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
  /** Simplified status for UI */
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

// ── Helpers ──

function classifyField(f: { tier: number | null; confidence: string; value: string }): "ready" | "suggested" | "manual" {
  if (f.tier === 1 && f.value) return "ready";
  if ((f.tier === 2 || f.tier === 3) && f.value) return "suggested";
  return "manual";
}

function fieldSection(label: string): string {
  const l = label.toLowerCase();
  if (/name|email|phone|address|city|state|zip|country|location/i.test(l)) return "Personal Info";
  if (/linkedin|portfolio|website|github/i.test(l)) return "Links";
  if (/author|work|sponsor|visa|clearance|relocat/i.test(l)) return "Work Authorization";
  if (/gender|race|ethnicity|veteran|disability|eeo/i.test(l)) return "Demographics";
  if (/salary|compensation|pay/i.test(l)) return "Compensation";
  if (/experience|company|title|role|years/i.test(l)) return "Experience";
  return "Other Questions";
}

// ═══════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════

export default function SidePanel() {
  // ── State ──
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

  // ── Computed ──
  const readyFields = useMemo(() => fields.filter((f) => f.status === "ready"), [fields]);
  const suggestedFields = useMemo(() => fields.filter((f) => f.status === "suggested"), [fields]);
  const manualFields = useMemo(() => fields.filter((f) => f.status === "manual"), [fields]);
  const fillableFields = useMemo(
    () => fields.filter((f) => f.value || f.checked !== undefined),
    [fields],
  );

  // ── Load data on mount ──
  useEffect(() => {
    let mounted = true;

    (async () => {
      // Auth state
      try {
        const auth = await chrome.runtime.sendMessage({ type: "GET_AUTH_STATE" });
        if (mounted && auth?.user) setUser(auth.user);
      } catch {}

      // Profile
      try {
        const pr = await chrome.runtime.sendMessage({ type: "GET_CACHED_PROFILE" });
        if (mounted && pr?.profile) setProfile(pr.profile);
      } catch {}

      // Check if current tab has stored state
      try {
        const tabState = await chrome.runtime.sendMessage({ type: "GET_TAB_STATE" });
        if (mounted && tabState?.state?.job) setJob(tabState.state.job);
        if (mounted && tabState?.state?.fields) {
          const f = tabState.state.fields;
          setFields(
            (f.fields || []).map((x: Record<string, unknown>) => ({
              id: x.id as string,
              label: x.label as string,
              tier: (x.tier as number) ?? null,
              confidence: (x.confidence as string) || "none",
              value: (x.value as string) || "",
              selector: x.selector as string,
              fieldType: (x.fieldType as string) || "input",
              options: x.options as string[],
              checked: x.checked as boolean,
              radioGroupName: x.radioGroupName as string,
              required: (x.required as boolean) ?? false,
              status: classifyField({
                tier: (x.tier as number) ?? null,
                confidence: (x.confidence as string) || "none",
                value: (x.value as string) || "",
              }),
            })),
          );
          setScanStatus({ status: "complete" });
        }
      } catch {}

      // If no stored state, probe current tab
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url && !job) {
          const atsPatterns = [
            "greenhouse.io", "lever.co", "myworkdayjobs.com", "ashbyhq.com",
            "icims.com", "smartrecruiters.com", "linkedin.com/jobs",
            "taleo.net", "breezy.hr", "bamboohr.com", "jazz.co",
            "jobvite.com", "recruitee.com", "workable.com",
          ];
          const isATS = atsPatterns.some((p) => tab.url!.includes(p));
          if (isATS && tab.id) {
            try {
              await chrome.tabs.sendMessage(tab.id, { type: "RESCAN_FIELDS" });
            } catch {
              try {
                await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  files: ["content-scripts/content.js"],
                });
              } catch {}
            }
          }
        }
      } catch {}

      // Resumes
      try {
        const res = await chrome.runtime.sendMessage({ type: "GET_USER_RESUMES" });
        if (mounted && res?.resumes?.length) {
          setResumes(res.resumes);
          setSelectedResume(res.resumes[0].id);
        }
        if (mounted && res?.coverLetters?.length) setCoverLetters(res.coverLetters);
      } catch {}
    })();

    return () => { mounted = false; };
  }, []);

  // ── Listen for runtime messages ──
  useEffect(() => {
    const listener = (message: Record<string, unknown>) => {
      if (message.type === "JOB_PAGE_DETECTED") {
        setJob(message.payload as JobDetected);
        setFillResult(null);
        setFields([]);
        setScanStatus({ status: "idle" });
      }
      if (message.type === "SCAN_STATUS") {
        setScanStatus(message.payload as ScanStatus);
      }
      if (message.type === "FIELDS_SCANNED") {
        const f = message.payload as Record<string, unknown>;
        setFields(
          ((f.fields as unknown[]) || []).map((x: unknown) => {
            const field = x as Record<string, unknown>;
            return {
              id: field.id as string,
              label: field.label as string,
              tier: (field.tier as number) ?? null,
              confidence: (field.confidence as string) || "none",
              value: (field.value as string) || "",
              selector: field.selector as string,
              fieldType: (field.fieldType as string) || "input",
              options: field.options as string[],
              checked: field.checked as boolean,
              radioGroupName: field.radioGroupName as string,
              required: (field.required as boolean) ?? false,
              status: classifyField({
                tier: (field.tier as number) ?? null,
                confidence: (field.confidence as string) || "none",
                value: (field.value as string) || "",
              }),
            };
          }),
        );
        setScanStatus({ status: "complete" });
      }
      if (message.type === "FILL_COMPLETE") {
        const p = message.payload as { filledCount: number; total: number };
        setFillResult({ filled: p.filledCount, total: p.total });
        setFilling(false);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // ── Actions ──

  const handleSignIn = useCallback(async () => {
    setSigningIn(true);
    try {
      const result = await chrome.runtime.sendMessage({ type: "SIGN_IN" });
      if (result?.user) {
        setUser(result.user);
        // Trigger rescan now that we're authenticated
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: "RESCAN_FIELDS" }).catch(() => {});
        }
        // Load profile
        const pr = await chrome.runtime.sendMessage({ type: "GET_CACHED_PROFILE" });
        if (pr?.profile) setProfile(pr.profile);
      }
    } catch {}
    setSigningIn(false);
  }, []);

  const handleSignOut = useCallback(async () => {
    await chrome.runtime.sendMessage({ type: "SIGN_OUT" }).catch(() => {});
    setUser(null);
    setProfile(null);
    setFields([]);
    setScanStatus({ status: "idle" });
  }, []);

  const handleRescan = useCallback(async () => {
    setScanStatus({ status: "scanning", step: "Starting scan..." });
    setFields([]);
    setFillResult(null);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "RESCAN_FIELDS" });
    } catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content-scripts/content.js"],
        });
        await new Promise((r) => setTimeout(r, 1500));
        await chrome.tabs.sendMessage(tab.id, { type: "RESCAN_FIELDS" }).catch(() => {});
      } catch {}
    }
  }, []);

  const handleFieldEdit = useCallback((fieldId: string, newValue: string, newChecked?: boolean) => {
    setFields((prev) =>
      prev.map((f) =>
        f.id === fieldId
          ? {
              ...f,
              value: newValue,
              checked: newChecked ?? f.checked,
              status: newValue ? "suggested" : "manual",
            }
          : f,
      ),
    );
  }, []);

  const handleFill = useCallback(async () => {
    setFilling(true);
    setFillResult(null);
    try {
      const toFill = fields.filter((f) => f.value || f.checked !== undefined);
      await chrome.runtime.sendMessage({
        type: "PANEL_FILL_FIELDS",
        payload: {
          fields: toFill.map((f) => ({
            selector: f.selector || f.id,
            value: f.value,
            fieldType: f.fieldType,
            checked: f.checked,
            radioGroupName: f.radioGroupName,
          })),
        },
      });
    } catch {
      setFilling(false);
    }
  }, [fields]);

  const handleUploadFile = useCallback(
    async (type: "resume" | "cover_letter") => {
      const selectedId = type === "resume" ? selectedResume : selectedCover;
      if (!selectedId) return;
      const list = type === "resume" ? resumes : coverLetters;
      const item = list.find((r) => r.id === selectedId);
      if (!item?.pdfUrl) return;
      await chrome.runtime.sendMessage({
        type: "TRIGGER_FILE_UPLOAD",
        payload: {
          fileUrl: item.storagePath || item.pdfUrl,
          fileName: `${item.label}.pdf`,
          inputType: type,
        },
      }).catch(() => {});
    },
    [selectedResume, selectedCover, resumes, coverLetters],
  );

  const handleFillSingle = useCallback(async (field: FillField) => {
    if (!field.value && field.checked === undefined) return;
    try {
      await chrome.runtime.sendMessage({
        type: "PANEL_FILL_FIELDS",
        payload: {
          fields: [{
            selector: field.selector || field.id,
            value: field.value,
            fieldType: field.fieldType,
            checked: field.checked,
            radioGroupName: field.radioGroupName,
          }],
        },
      });
      // Mark field as filled in local state
      setFields((prev) =>
        prev.map((f) => f.id === field.id ? { ...f, status: "ready" as const } : f),
      );
    } catch {}
  }, []);

  // ═══════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════

  const hasFields = fields.length > 0;
  const fileFields = fields.filter((f) => f.fieldType === "file");
  const nonFileFields = fields.filter((f) => f.fieldType !== "file");

  return (
    <div style={{
      width: "100%", height: "100vh", background: BASE, color: TX,
      fontFamily: SANS, display: "flex", flexDirection: "column",
      overflow: "hidden", fontSize: 12, lineHeight: 1.5,
    }}>
      {/* ── Header ── */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderBottom: `1px solid ${BRD}`,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: `linear-gradient(135deg, ${EM}, oklch(0.6 0.14 162))`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 700, color: "#000",
          }}>V</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: TX }}>Vetidia</div>
            <div style={{ fontSize: 10, color: TX3 }}>
              {user ? user.email : "Not signed in"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {job && (
            <span style={{
              fontSize: 9, fontWeight: 700, color: EM, letterSpacing: "0.06em",
              padding: "2px 6px", borderRadius: 4,
              background: `color-mix(in srgb, ${EM} 12%, transparent)`,
            }}>
              {(job.atsDisplayName || job.ats || "").toUpperCase()}
            </span>
          )}
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: 4,
              color: showSettings ? EM : TX3, transition: "color 0.15s",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      {/* ── Settings drawer ── */}
      {showSettings && (
        <div style={{
          padding: "12px 16px", borderBottom: `1px solid ${BRD}`,
          background: "rgba(255,255,255,0.02)", flexShrink: 0,
        }}>
          <div style={{ fontSize: 10, color: TX3, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Account
          </div>
          {user ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: TX2, flex: 1 }}>{user.email}</span>
              <button onClick={handleRescan} style={pillBtn}>Sync</button>
              <button onClick={handleSignOut} style={{ ...pillBtn, color: RED, borderColor: `color-mix(in srgb, ${RED} 30%, transparent)` }}>
                Sign out
              </button>
            </div>
          ) : (
            <button onClick={handleSignIn} disabled={signingIn} style={{ ...pillBtn, background: EM, color: "#000", borderColor: EM }}>
              {signingIn ? "Signing in..." : "Sign in with Google"}
            </button>
          )}
          <div style={{ fontSize: 9, color: TX4, marginTop: 8 }}>
            Vetidia Extension v0.3.0 ·{" "}
            <a href="https://vetidia.app" target="_blank" rel="noreferrer" style={{ color: EM, textDecoration: "none" }}>
              vetidia.app
            </a>
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>

        {/* STATE 1: Not on ATS page */}
        {!job && !user && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", padding: "40px 24px", textAlign: "center",
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: `linear-gradient(135deg, ${EM}, oklch(0.6 0.14 162))`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, fontWeight: 700, color: "#000", marginBottom: 16,
            }}>V</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: TX, marginBottom: 6 }}>Welcome to Vetidia</div>
            <div style={{ fontSize: 11, color: TX3, lineHeight: 1.6, maxWidth: 240, marginBottom: 20 }}>
              Auto-fill job applications on Greenhouse, Lever, Workday, Ashby, and 10+ ATS platforms.
            </div>
            <button
              onClick={handleSignIn}
              disabled={signingIn}
              style={{
                width: "100%", maxWidth: 220, padding: "10px 0", borderRadius: 7, border: "none",
                background: EM, color: "#000", fontSize: 12, fontWeight: 600, cursor: "pointer",
                marginBottom: 12,
              }}
            >
              {signingIn ? "Signing in..." : "Sign in with Google"}
            </button>
            <div style={{ fontSize: 10, color: TX4, lineHeight: 1.5 }}>
              Then navigate to a job application to get started.
            </div>
          </div>
        )}

        {!job && user && (
          <EmptyState
            icon="🔍"
            title="No application detected"
            subtitle="Navigate to a job on Greenhouse, Lever, Workday, Ashby, or any other supported ATS."
          />
        )}

        {/* STATE 2: ATS detected, not authenticated */}
        {job && !user && scanStatus.status !== "scanning" && (
          <div style={{ padding: 16 }}>
            <JobHeader job={job} />
            <div style={{
              background: CARD, border: `1px solid color-mix(in srgb, ${EM} 20%, ${BRD})`,
              borderRadius: 10, padding: "20px 16px", textAlign: "center", marginTop: 12,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TX, marginBottom: 6 }}>
                Sign in to autofill
              </div>
              <div style={{ fontSize: 11, color: TX3, lineHeight: 1.5, marginBottom: 14 }}>
                Vetidia found {job.fieldCount || "multiple"} fields on this {job.atsDisplayName || job.ats} application.
                Sign in to fill them from your profile.
              </div>
              <button
                onClick={handleSignIn}
                disabled={signingIn}
                style={{
                  width: "100%", padding: "10px 0", borderRadius: 7, border: "none",
                  background: EM, color: "#000", fontSize: 12, fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {signingIn ? "Signing in..." : "Sign in with Google"}
              </button>
            </div>
          </div>
        )}

        {/* STATE 3: Scanning */}
        {job && scanStatus.status === "scanning" && (
          <div style={{ padding: 16 }}>
            <JobHeader job={job} />
            <div style={{
              background: CARD, border: `1px solid ${BRD}`, borderRadius: 10,
              padding: "20px 16px", marginTop: 12,
            }}>
              <ScanAnimation step={scanStatus.step || "Scanning..."} />
            </div>
          </div>
        )}

        {/* STATE 3b: Needs auth (detected during scan) */}
        {job && user && scanStatus.status === "needs_auth" && (
          <div style={{ padding: 16 }}>
            <JobHeader job={job} />
            <div style={{
              background: CARD, border: `1px solid color-mix(in srgb, ${AMBER} 20%, ${BRD})`,
              borderRadius: 10, padding: "16px", marginTop: 12,
            }}>
              <div style={{ fontSize: 12, color: AMBER, fontWeight: 600, marginBottom: 6 }}>
                Profile not found
              </div>
              <div style={{ fontSize: 11, color: TX3, lineHeight: 1.5, marginBottom: 12 }}>
                Set up your profile on vetidia.app to start auto-filling applications.
              </div>
              <button onClick={handleRescan} style={pillBtn}>Retry</button>
            </div>
          </div>
        )}

        {/* STATE 4: Fields ready */}
        {job && hasFields && !fillResult && (
          <div>
            <div style={{ padding: "12px 16px 0" }}>
              <JobHeader job={job} />
            </div>

            {/* Summary bar */}
            <div style={{
              display: "flex", gap: 8, padding: "10px 16px",
              borderBottom: `1px solid ${BRD}`,
            }}>
              <StatusPill color={EM} count={readyFields.length} label="Ready" />
              <StatusPill color={AMBER} count={suggestedFields.length} label="Review" />
              <StatusPill color={TX4} count={manualFields.length} label="Manual" />
            </div>

            {/* File uploads (if applicable) */}
            {(resumes.length > 0 || fileFields.length > 0) && (
              <div style={{ padding: "10px 16px", borderBottom: `1px solid ${BRD}` }}>
                {resumes.length > 0 && (
                  <FilePickerRow
                    label="Resume"
                    items={resumes}
                    selected={selectedResume}
                    onSelect={setSelectedResume}
                    onUpload={() => handleUploadFile("resume")}
                  />
                )}
                {coverLetters.length > 0 && (
                  <FilePickerRow
                    label="Cover Letter"
                    items={coverLetters}
                    selected={selectedCover}
                    onSelect={setSelectedCover}
                    onUpload={() => handleUploadFile("cover_letter")}
                  />
                )}
              </div>
            )}

            {/* Fields needing attention first */}
            {manualFields.length > 0 && (
              <FieldSection
                title={`Needs your input (${manualFields.length})`}
                fields={manualFields}
                defaultExpanded={true}
                color={TX4}
                onEdit={handleFieldEdit}
                onFillSingle={handleFillSingle}
              />
            )}

            {/* Fields to review */}
            {suggestedFields.length > 0 && (
              <FieldSection
                title={`Review (${suggestedFields.length})`}
                fields={suggestedFields}
                defaultExpanded={true}
                color={AMBER}
                onEdit={handleFieldEdit}
                onFillSingle={handleFillSingle}
              />
            )}

            {/* Auto-filled fields (collapsed by default) */}
            {readyFields.length > 0 && (
              <FieldSection
                title={`Auto-filled (${readyFields.length})`}
                fields={readyFields}
                defaultExpanded={false}
                color={EM}
                onEdit={handleFieldEdit}
                onFillSingle={handleFillSingle}
              />
            )}
          </div>
        )}

        {/* STATE 5: Fill complete */}
        {fillResult && (
          <div style={{ padding: 16 }}>
            <JobHeader job={job!} />
            <div style={{
              background: CARD, border: `1px solid color-mix(in srgb, ${EM} 25%, ${BRD})`,
              borderRadius: 10, padding: "20px 16px", marginTop: 12, textAlign: "center",
            }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: EM, marginBottom: 4 }}>
                {fillResult.filled} of {fillResult.total} fields filled
              </div>
              <div style={{ fontSize: 11, color: TX3, marginBottom: 14 }}>
                Review the form and submit when ready.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setFillResult(null)} style={{ ...pillBtn, flex: 1 }}>
                  Back to fields
                </button>
                <button
                  onClick={handleRescan}
                  style={{ ...pillBtn, flex: 1, background: EM, color: "#000", borderColor: EM }}
                >
                  Re-scan
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STATE: ATS detected, authenticated, idle (no fields yet, not scanning) */}
        {job && user && !hasFields && scanStatus.status === "idle" && !fillResult && (
          <div style={{ padding: 16 }}>
            <JobHeader job={job} />
            <div style={{
              background: CARD, border: `1px solid ${BRD}`, borderRadius: 10,
              padding: "20px 16px", textAlign: "center", marginTop: 12,
            }}>
              <div style={{ fontSize: 11, color: TX3, marginBottom: 12 }}>
                Waiting for scan to complete...
              </div>
              <button onClick={handleRescan} style={{ ...pillBtn, background: EM, color: "#000", borderColor: EM }}>
                Scan now
              </button>
            </div>
          </div>
        )}

        {/* No fields found */}
        {job && scanStatus.status === "no_fields" && !hasFields && (
          <div style={{ padding: 16 }}>
            <JobHeader job={job} />
            <div style={{
              background: CARD, border: `1px solid ${BRD}`, borderRadius: 10,
              padding: "20px 16px", textAlign: "center", marginTop: 12,
            }}>
              <div style={{ fontSize: 11, color: TX3, marginBottom: 12 }}>
                No form fields detected on this page. Try scrolling down to load the form, or click below to scan again.
              </div>
              <button onClick={handleRescan} style={pillBtn}>
                Retry scan
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Sticky footer: Fill button ── */}
      {hasFields && !fillResult && (
        <div style={{
          padding: "10px 14px", borderTop: `1px solid ${BRD}`,
          display: "flex", gap: 8, flexShrink: 0, background: BASE,
        }}>
          <button onClick={handleRescan} disabled={filling} style={pillBtn}>
            Re-scan
          </button>
          <button
            onClick={handleFill}
            disabled={filling || fillableFields.length === 0}
            style={{
              flex: 1, padding: "9px 0", borderRadius: 7, border: "none",
              background: filling ? TX3 : EM,
              color: "#000", fontSize: 12, fontWeight: 600,
              cursor: filling ? "default" : "pointer",
              opacity: fillableFields.length === 0 ? 0.4 : 1,
              transition: "all 0.15s",
            }}
          >
            {filling ? "Filling..." : `⚡ Fill ${fillableFields.length} Fields`}
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════

const pillBtn: CSSProperties = {
  padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 500,
  fontFamily: SANS, cursor: "pointer",
  background: "rgba(255,255,255,0.04)", color: TX2,
  border: `1px solid ${BRD}`, transition: "all 0.15s",
};

function JobHeader({ job }: { job: JobDetected }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: TX, lineHeight: 1.3 }}>
            {job.company}
          </div>
          {job.jobTitle && (
            <div style={{ fontSize: 11, color: TX2, marginTop: 2 }}>
              {job.jobTitle}
            </div>
          )}
        </div>
        <a
          href={`https://vetidia.app/jobs?url=${encodeURIComponent(job.url)}`}
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: 9, color: EM, textDecoration: "none", padding: "3px 6px",
            borderRadius: 4, border: `1px solid color-mix(in srgb, ${EM} 20%, transparent)`,
            whiteSpace: "nowrap",
          }}
        >
          Open in Vetidia ↗
        </a>
      </div>
    </div>
  );
}

function StatusPill({ color, count, label }: { color: string; count: number; label: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 5, padding: "4px 8px",
      borderRadius: 5, background: `color-mix(in srgb, ${color} 8%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 15%, transparent)`,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0,
      }} />
      <span style={{ fontSize: 11, fontWeight: 600, fontFamily: MONO, color }}>{count}</span>
      <span style={{ fontSize: 10, color: TX3 }}>{label}</span>
    </div>
  );
}

function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "60px 24px", textAlign: "center",
    }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: TX2, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 11, color: TX4, lineHeight: 1.6, maxWidth: 240 }}>{subtitle}</div>
    </div>
  );
}

function ScanAnimation({ step }: { step: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{
        width: 20, height: 20, border: `2px solid ${BRD_L}`,
        borderTopColor: EM, borderRadius: "50%",
        animation: "vetidiaSpin 0.8s linear infinite",
      }} />
      <style>{`@keyframes vetidiaSpin { to { transform: rotate(360deg); } }`}</style>
      <span style={{ fontSize: 11, color: TX2 }}>{step}</span>
    </div>
  );
}

function FilePickerRow({
  label, items, selected, onSelect, onUpload,
}: {
  label: string;
  items: ResumeItem[];
  selected: string;
  onSelect: (id: string) => void;
  onUpload: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 11, color: TX3, minWidth: 75 }}>{label}</span>
      <select
        value={selected}
        onChange={(e) => onSelect(e.target.value)}
        style={{
          flex: 1, padding: "5px 8px", borderRadius: 5, fontSize: 11,
          background: "rgba(255,255,255,0.04)", border: `1px solid ${BRD}`,
          color: TX, fontFamily: SANS, outline: "none",
        }}
      >
        <option value="">None</option>
        {items.map((r) => (
          <option key={r.id} value={r.id}>{r.label}</option>
        ))}
      </select>
      <button onClick={onUpload} disabled={!selected} style={{ ...pillBtn, padding: "4px 8px", fontSize: 10 }}>
        Upload
      </button>
    </div>
  );
}

function FieldSection({
  title, fields, defaultExpanded, color, onEdit, onFillSingle,
}: {
  title: string;
  fields: FillField[];
  defaultExpanded: boolean;
  color: string;
  onEdit: (id: string, value: string, checked?: boolean) => void;
  onFillSingle: (field: FillField) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Group fields by section
  const grouped = useMemo(() => {
    const groups: Record<string, FillField[]> = {};
    for (const f of fields) {
      const sec = fieldSection(f.label);
      if (!groups[sec]) groups[sec] = [];
      groups[sec].push(f);
    }
    return groups;
  }, [fields]);

  return (
    <div style={{ borderBottom: `1px solid ${BRD}` }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "10px 16px", background: "none", border: "none",
          cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{
          width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0,
        }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: TX2, flex: 1 }}>
          {title}
        </span>
        <span style={{
          fontSize: 10, color: TX4, transform: expanded ? "rotate(90deg)" : "none",
          transition: "transform 0.15s",
        }}>
          ▸
        </span>
      </button>

      {expanded && (
        <div style={{ padding: "0 12px 12px" }}>
          {Object.entries(grouped).map(([section, sectionFields]) => (
            <div key={section}>
              {Object.keys(grouped).length > 1 && (
                <div style={{
                  fontSize: 9, color: TX4, fontWeight: 600, textTransform: "uppercase",
                  letterSpacing: "0.06em", padding: "8px 4px 4px",
                }}>
                  {section}
                </div>
              )}
              {sectionFields.map((field) => (
                <FieldRow key={field.id} field={field} onEdit={onEdit} onFillSingle={onFillSingle} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldRow({
  field, onEdit, onFillSingle,
}: {
  field: FillField;
  onEdit: (id: string, value: string, checked?: boolean) => void;
  onFillSingle: (field: FillField) => void;
}) {
  const statusColor = field.status === "ready" ? EM : field.status === "suggested" ? AMBER : TX4;
  const statusIcon = field.status === "ready" ? "✓" : field.status === "suggested" ? "≈" : "·";
  const canFill = !!(field.value || field.checked !== undefined);

  const inputStyle: CSSProperties = {
    width: "100%", background: "rgba(255,255,255,0.04)", border: `1px solid ${BRD}`,
    borderRadius: 5, padding: "5px 8px", fontSize: 11, color: TX,
    fontFamily: SANS, boxSizing: "border-box" as const, outline: "none",
  };

  const renderControl = () => {
    if (field.fieldType === "checkbox") {
      return (
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={!!field.checked}
            onChange={(e) => onEdit(field.id, e.target.checked ? "true" : "false", e.target.checked)}
            style={{ accentColor: EM }}
          />
          <span style={{ fontSize: 11, color: TX2 }}>{field.checked ? "Yes" : "No"}</span>
        </label>
      );
    }

    if (field.fieldType === "select" && field.options?.length) {
      return (
        <select
          value={field.value}
          onChange={(e) => onEdit(field.id, e.target.value)}
          style={inputStyle}
        >
          <option value="">Select...</option>
          {field.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
    }

    if (field.fieldType === "radio-group" && field.options?.length) {
      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {field.options.map((o) => (
            <label key={o} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: TX2, cursor: "pointer" }}>
              <input
                type="radio"
                name={field.radioGroupName || field.id}
                checked={field.value === o}
                onChange={() => onEdit(field.id, o)}
                style={{ accentColor: EM }}
              />
              {o}
            </label>
          ))}
        </div>
      );
    }

    // Default: text input (textarea for long labels suggesting long answers)
    const isLong = /why|describe|tell|explain|experience|interest/i.test(field.label);
    if (isLong) {
      return (
        <textarea
          value={field.value}
          onChange={(e) => onEdit(field.id, e.target.value)}
          rows={3}
          placeholder="Type your answer..."
          style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
        />
      );
    }

    return (
      <input
        type="text"
        value={field.value}
        onChange={(e) => onEdit(field.id, e.target.value)}
        placeholder={field.required ? "Required" : "Optional"}
        style={inputStyle}
      />
    );
  };

  return (
    <div style={{
      padding: "8px 4px", borderBottom: `1px solid rgba(255,255,255,0.03)`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 9, color: statusColor, fontWeight: 700 }}>{statusIcon}</span>
        <span style={{ fontSize: 11, color: TX2, flex: 1 }}>
          {field.label}
          {field.required && <span style={{ color: RED, marginLeft: 2 }}>*</span>}
        </span>
        {canFill && (
          <button
            onClick={() => onFillSingle(field)}
            style={{
              padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 600,
              fontFamily: SANS, cursor: "pointer", background: "rgba(255,255,255,0.04)",
              color: EM, border: `1px solid color-mix(in srgb, ${EM} 25%, transparent)`,
              transition: "all 0.15s", lineHeight: 1.3,
            }}
          >
            Fill
          </button>
        )}
      </div>
      {renderControl()}
    </div>
  );
}
