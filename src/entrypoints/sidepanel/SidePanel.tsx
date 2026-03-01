/**
 * Vetidia Extension — Side Panel (Primary UI)
 * 4-tab app: Overview | Fill | Vault | Settings
 * Opens when user clicks toolbar icon on any page.
 */
import { useState, useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import {
  EM, BLUE, AMBER, BASE, PANEL, CARD, BRD, BRD_L, TX, TX2, TX3, TX4,
  SANS, MONO, enterStyle, stagger,
} from "@/ui/tokens";
import {
  Btn, Chip, Section, Card as UICard, ConfidenceBadge, TierBadge,
  ProgressBar, TierBreakdownBar, useMountReveal,
} from "@/ui/components";

// ── Design helpers ──
const RED = "oklch(0.65 0.2 25)";
const PURPLE = "oklch(0.72 0.16 300)";

// ── Types ──
interface FillField {
  id: string;
  label: string;
  type: string;
  section: string;
  tier: 1 | 2 | 3 | null;
  confidence: "high" | "medium" | "low" | "none";
  value: string;
  original: string;
  similarity: number | null;
  selector?: string;
  fieldType?: "input" | "select" | "custom-dropdown" | "checkbox" | "radio-group" | "file";
  options?: string[];
  checked?: boolean;
  radioGroupName?: string;
  required?: boolean;
}

interface ResumeItem {
  id: string;
  label: string;
  pdfUrl: string | null;
  docxUrl: string | null;
  jobId: string | null;
  storagePath: string | null;
}

interface FillState {
  status: "idle" | "filling" | "complete";
  fields: FillField[];
  atsName: string;
  company: string;
  role: string;
  filledCount: number;
  totalFillable: number;
}

interface JobDetected {
  ats: string;
  company: string;
  url: string;
  fieldCount: number;
}

interface VaultAnswer {
  id: string;
  question_text: string;
  answer_text: string;
  category: string;
  times_used: number;
  confidence_score: number;
  auto_fill_enabled: boolean;
  is_universal: boolean;
}

interface RecentFill {
  id: string;
  ats_type: string;
  page_url: string;
  fields_attempted: number;
  fields_filled: number;
  created_at: string;
}

interface Settings {
  autoDetect: boolean;
  autoFillTier1: boolean;
  showBadges: boolean;
  tier2Threshold: number;
}

// ── Icons ──
const Icons = {
  home: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  fill: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  vault: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
  settings: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
};

const TABS = [
  { id: "overview", label: "Overview", icon: Icons.home },
  { id: "fill", label: "Fill", icon: Icons.fill },
  { id: "vault", label: "Vault", icon: Icons.vault },
  { id: "settings", label: "Settings", icon: Icons.settings },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ────────────────────────────────────────────────────────────────────────────

function guessSectionFromLabel(label: string): string {
  const l = label.toLowerCase();
  if (/name|email|phone|address|city|state|zip|country|location/i.test(l)) return "Personal Info";
  if (/experience|company|title|role|years/i.test(l)) return "Experience";
  if (/education|degree|school|university|gpa/i.test(l)) return "Education";
  if (/gender|race|ethnicity|veteran|disability|eeo/i.test(l)) return "Demographics";
  if (/author|work|sponsor|visa|clearance|relocat/i.test(l)) return "Work Authorization";
  if (/linkedin|portfolio|website|github/i.test(l)) return "Links";
  return "General";
}

export default function SidePanel() {
  const [currentTab, setCurrentTab] = useState<TabId>("overview");
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [job, setJob] = useState<JobDetected | null>(null);
  const [fillState, setFillState] = useState<FillState>({
    status: "idle", fields: [], atsName: "", company: "", role: "",
    filledCount: 0, totalFillable: 0,
  });
  const [answers, setAnswers] = useState<VaultAnswer[]>([]);
  const [recentFills, setRecentFills] = useState<RecentFill[]>([]);
  const [settings, setSettings] = useState<Settings>({
    autoDetect: true, autoFillTier1: true, showBadges: true, tier2Threshold: 85,
  });
  const [sectionFilter, setSectionFilter] = useState("all");
  const [vaultFilter, setVaultFilter] = useState("all");
  const [expandedAnswer, setExpandedAnswer] = useState<string | null>(null);
  const [resumes, setResumes] = useState<ResumeItem[]>([]);
  const [coverLetters, setCoverLetters] = useState<ResumeItem[]>([]);
  const [selectedResume, setSelectedResume] = useState<string>("default");
  const [selectedCoverLetter, setSelectedCoverLetter] = useState<string>("none");
  const [uploadingResume, setUploadingResume] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [filling, setFilling] = useState(false);
  const show = useMountReveal(30);

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

      // Current tab ATS state
      let hasStoredState = false;
      try {
        const tabState = await chrome.runtime.sendMessage({ type: "GET_TAB_STATE" });
        if (mounted && tabState?.state?.job) { setJob(tabState.state.job); hasStoredState = true; }
        if (mounted && tabState?.state?.fields) {
          hasStoredState = true;
          const f = tabState.state.fields;
          setFillState(prev => ({
            ...prev,
            atsName: f.ats?.toUpperCase() || "",
            fields: (f.fields || []).map((x: any) => ({
              id: x.id, label: x.label, type: x.fieldType || "text",
              section: guessSectionFromLabel(x.label),
              tier: x.tier ?? null, confidence: x.confidence || "none",
              value: x.value || "", original: "", similarity: null,
              selector: x.selector, fieldType: x.fieldType || "input",
              options: x.options, checked: x.checked,
              radioGroupName: x.radioGroupName, required: x.required ?? false,
            })),
            totalFillable: f.totalFieldCount || 0,
          }));
        }
      } catch {}

      // If no stored state, probe current tab URL to see if it's an ATS page and trigger scan
      if (!hasStoredState && mounted) {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.url) {
            const atsPatterns = [
              "greenhouse.io", "lever.co", "myworkdayjobs.com", "ashbyhq.com",
              "icims.com", "smartrecruiters.com", "linkedin.com/jobs",
              "taleo.net", "breezy.hr", "bamboohr.com", "jazz.co",
              "jobvite.com", "recruitee.com", "workable.com",
            ];
            const isATS = atsPatterns.some(p => tab.url!.includes(p));
            if (isATS && tab.id) {
              // Try to trigger a scan — content script may or may not be loaded
              try {
                await chrome.tabs.sendMessage(tab.id, { type: "RESCAN_FIELDS" });
              } catch {
                // Content script not loaded — inject it
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
      }

      // Answers
      try {
        const av = await chrome.runtime.sendMessage({ type: "GET_ANSWER_VAULT" });
        if (mounted && av?.answers) setAnswers(av.answers);
      } catch {}

      // Recent fills
      try {
        const hist = await chrome.runtime.sendMessage({ type: "GET_FILL_HISTORY" });
        if (mounted && hist?.submissions) setRecentFills(hist.submissions);
      } catch {}

      // Settings
      try {
        const stored = await chrome.storage.local.get("vetidiaSettings");
        if (mounted && stored.vetidiaSettings) setSettings(s => ({ ...s, ...stored.vetidiaSettings }));
      } catch {}

      // Resumes & cover letters
      try {
        const res = await chrome.runtime.sendMessage({ type: "GET_USER_RESUMES" });
        if (mounted) {
          if (res?.resumes?.length) {
            setResumes(res.resumes);
            // Auto-select first real resume as default
            setSelectedResume(res.resumes[0].id);
          }
          if (res?.coverLetters?.length) setCoverLetters(res.coverLetters);
        }
      } catch {}
    })();

    return () => { mounted = false; };
  }, []);

  // ── Listen for runtime messages ──
  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === "FILL_STATE_UPDATE") {
        setFillState(prev => ({ ...prev, ...message.payload }));
        if (message.payload?.status === "complete") setCurrentTab("fill");
      }
      if (message.type === "JOB_PAGE_DETECTED") {
        setJob(message.payload);
      }
      if (message.type === "FIELDS_SCANNED") {
        const f = message.payload;
        setFillState(prev => ({
          ...prev,
          atsName: f.ats?.toUpperCase() || prev.atsName,
          totalFillable: f.totalFieldCount || prev.totalFillable,
          fields: (f.fields || []).map((x: any) => ({
            id: x.id, label: x.label, type: x.fieldType || "text",
            section: guessSectionFromLabel(x.label),
            tier: x.tier ?? null,
            confidence: x.confidence || "none",
            value: x.value || "",
            original: "", similarity: null,
            selector: x.selector,
            fieldType: x.fieldType || "input",
            options: x.options,
            checked: x.checked,
            radioGroupName: x.radioGroupName,
            required: x.required ?? false,
          })),
        }));
        setCurrentTab("fill");
      }
      if (message.type === "FILL_COMPLETE") {
        setFillState(prev => ({
          ...prev,
          status: "complete",
          filledCount: message.payload.filledCount,
        }));
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    // Also request current fill state from content script
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (!tab?.id) return;
      try {
        const result = await chrome.tabs.sendMessage(tab.id, { type: "GET_FILL_STATE" });
        if (result?.fields) setFillState(prev => ({ ...prev, ...result }));
      } catch {}
    });

    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // ── Computed ──
  const tierStats = useMemo(() => {
    const t: Record<string, number> = { 1: 0, 2: 0, 3: 0 };
    fillState.fields.forEach(f => { if (f.tier) t[String(f.tier)]++; });
    return t;
  }, [fillState.fields]);

  const sections = useMemo(() => {
    const s: Record<string, FillField[]> = {};
    fillState.fields.forEach(f => {
      const sec = f.section || "General";
      if (!s[sec]) s[sec] = [];
      s[sec].push(f);
    });
    return s;
  }, [fillState.fields]);

  const nonFileFields = fillState.fields.filter(f => f.fieldType !== "file");
  const filteredFields = sectionFilter === "all"
    ? nonFileFields
    : nonFileFields.filter(f => (f.section || "General") === sectionFilter);

  const filled = fillState.filledCount || nonFileFields.filter(f => f.value).length;
  const total = fillState.totalFillable || nonFileFields.length;

  // ── Actions ──
  const handleFieldEdit = (fieldId: string, newValue: string, newChecked?: boolean) => {
    setFillState(prev => ({
      ...prev,
      fields: prev.fields.map(f => f.id === fieldId
        ? { ...f, value: newValue, checked: newChecked ?? f.checked }
        : f),
    }));
  };

  const handleRescan = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      // Try sending to existing content script
      await chrome.tabs.sendMessage(tab.id, { type: "RESCAN_FIELDS" });
    } catch {
      // Content script not loaded — inject it programmatically
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content-scripts/content.js"],
        });
        // Wait for content script to initialize
        await new Promise(r => setTimeout(r, 1500));
        await chrome.tabs.sendMessage(tab.id, { type: "RESCAN_FIELDS" }).catch(() => {});
      } catch (e) {
        console.warn("[Vetidia] Could not inject content script:", e);
      }
    }
  };

  const handleStartFill = async () => {
    setFilling(true);
    setFillState(prev => ({ ...prev, status: "filling" }));
    try {
      const fillable = fillState.fields.filter(f => f.value || f.checked !== undefined);
      const result = await chrome.runtime.sendMessage({
        type: "PANEL_FILL_FIELDS",
        payload: {
          fields: fillable.map(f => ({
            selector: f.selector || f.id,
            value: f.value,
            fieldType: f.fieldType,
            checked: f.checked,
            radioGroupName: f.radioGroupName,
          })),
        },
      });
      setFillState(prev => ({
        ...prev,
        status: "complete",
        filledCount: result?.filled || fillable.length,
      }));
    } catch {
      setFillState(prev => ({ ...prev, status: "idle" }));
    } finally {
      setFilling(false);
    }
  };

  const handleUploadResume = async (type: "resume" | "cover_letter") => {
    const selectedId = type === "resume" ? selectedResume : selectedCoverLetter;
    if (!selectedId || selectedId === "none") return;
    const list = type === "resume" ? resumes : coverLetters;
    const item = list.find(r => r.id === selectedId);
    if (!item?.pdfUrl) return;
    type === "resume" ? setUploadingResume(true) : setUploadingCover(true);
    try {
      await chrome.runtime.sendMessage({
        type: "TRIGGER_FILE_UPLOAD",
        payload: {
          fileUrl: item.storagePath || item.pdfUrl,
          fileName: `${item.label}.pdf`,
          inputType: type,
        },
      });
    } finally {
      type === "resume" ? setUploadingResume(false) : setUploadingCover(false);
    }
  };

  const saveSetting = (key: keyof Settings, val: any) => {
    const next = { ...settings, [key]: val };
    setSettings(next);
    chrome.storage.local.set({ vetidiaSettings: next }).catch(() => {});
  };

  // ── Tab bar ──
  const TabBar = () => (
    <nav style={{
      display: "flex", borderBottom: `1px solid ${BRD}`,
      background: "rgba(255,255,255,0.01)", flexShrink: 0,
    }}>
      {TABS.map(tab => (
        <button key={tab.id} onClick={() => setCurrentTab(tab.id)} style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
          gap: 3, padding: "10px 4px 8px",
          background: "none", border: "none", cursor: "pointer",
          color: currentTab === tab.id ? EM : TX3,
          borderBottom: `2px solid ${currentTab === tab.id ? EM : "transparent"}`,
          transition: "color 0.15s, border-color 0.15s",
          fontSize: 9, fontFamily: SANS, fontWeight: 500,
        }}>
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );

  // ─────────────────────────────────────────────────────────────
  // ── OVERVIEW TAB ──
  // ─────────────────────────────────────────────────────────────
  const OverviewTab = () => {
    const autoFillRate = answers.length > 0
      ? Math.round((answers.filter(a => a.auto_fill_enabled).length / answers.length) * 100) : 0;
    const initials = profile?.name
      ? profile.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()
      : (user?.email?.[0] || "V").toUpperCase();

    return (
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {/* Profile card */}
        <div style={{
          background: CARD, border: `1px solid ${BRD}`, borderRadius: 10,
          padding: 14, marginBottom: 12, display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            background: `linear-gradient(135deg, color-mix(in srgb, ${EM} 25%, ${BASE}), ${CARD})`,
            border: `1px solid color-mix(in srgb, ${EM} 40%, transparent)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, fontWeight: 700, color: EM,
          }}>{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: TX }}>{profile?.name || "Set up profile"}</div>
            <div style={{ fontSize: 11, color: TX3 }}>{profile?.current_title || profile?.email || user?.email || "Not connected"}</div>
          </div>
          {user && (
            <span style={{
              fontSize: 8, fontWeight: 700, color: EM, letterSpacing: "0.05em",
              padding: "2px 6px", borderRadius: 4,
              background: `color-mix(in srgb, ${EM} 12%, transparent)`,
            }}>CONNECTED</span>
          )}
        </div>

        {/* Stats grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
          {[
            { label: "Answers Saved", value: answers.length, unit: "", color: EM },
            { label: "Auto-Fill Rate", value: autoFillRate, unit: "%", color: BLUE },
            { label: "Apps Assisted", value: recentFills.length, unit: "", color: PURPLE },
            { label: "Vault Score", value: profile?.vault_completeness || 0, unit: "%", color: AMBER },
          ].map(stat => (
            <div key={stat.label} style={{
              background: CARD, border: `1px solid ${BRD}`, borderRadius: 8,
              padding: "10px 12px", textAlign: "center",
            }}>
              <div style={{ fontSize: 11, color: TX3, marginBottom: 4 }}>{stat.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: MONO, color: stat.color }}>
                {stat.value}<span style={{ fontSize: 11 }}>{stat.unit}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Current page */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: TX3, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Current Page
          </div>
          {job ? (
            <div style={{
              background: CARD, border: `1px solid color-mix(in srgb, ${EM} 20%, ${BRD})`,
              borderRadius: 10, padding: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, color: EM, letterSpacing: "0.06em",
                  padding: "2px 6px", borderRadius: 4,
                  background: `color-mix(in srgb, ${EM} 12%, transparent)`,
                }}>{job.ats.toUpperCase()}</span>
                <span style={{ fontSize: 11, color: TX2, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.company}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 20, fontWeight: 700, fontFamily: MONO, color: TX }}>{job.fieldCount}</span>
                <span style={{ fontSize: 11, color: TX3 }}>fields detected</span>
              </div>
              <button onClick={() => setCurrentTab("fill")} style={{
                width: "100%", padding: "8px 0", borderRadius: 7, border: "none",
                background: EM, color: "#000", fontSize: 12, fontWeight: 600,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
                ⚡ Fill {job.fieldCount} Fields
              </button>
            </div>
          ) : (
            <div style={{
              background: CARD, border: `1px solid ${BRD}`, borderRadius: 10,
              padding: "20px 16px", textAlign: "center",
            }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>🔍</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: TX2, marginBottom: 4 }}>No application detected</div>
              <div style={{ fontSize: 10, color: TX4, lineHeight: 1.5 }}>
                Navigate to a job application on Greenhouse, Lever, Workday, or any other supported ATS
              </div>
            </div>
          )}
        </div>

        {/* Recent applications */}
        {recentFills.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: TX3, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Recent Applications
            </div>
            {recentFills.slice(0, 5).map((f, i) => {
              const rate = f.fields_attempted > 0 ? Math.round((f.fields_filled / f.fields_attempted) * 100) : 0;
              const domain = (() => { try { return new URL(f.page_url).hostname.replace("www.", ""); } catch { return f.page_url; } })();
              const date = new Date(f.created_at);
              const now = new Date();
              const diff = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
              const dateStr = diff === 0 ? "Today" : diff === 1 ? "1d ago" : `${diff}d ago`;
              return (
                <div key={f.id} style={{
                  background: CARD, border: `1px solid ${BRD}`, borderRadius: 8,
                  padding: "10px 12px", marginBottom: 6,
                  ...enterStyle(show, i * 30 + 200),
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: TX }}>{domain}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10, color: TX4 }}>{dateStr}</div>
                      <span style={{
                        fontSize: 8, fontWeight: 700, color: BLUE, letterSpacing: "0.05em",
                        padding: "1px 5px", borderRadius: 3,
                        background: `color-mix(in srgb, ${BLUE} 12%, transparent)`,
                      }}>{(f.ats_type || "ATS").toUpperCase()}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, height: 4, borderRadius: 2, background: `rgba(255,255,255,0.06)` }}>
                      <div style={{ height: "100%", borderRadius: 2, background: EM, width: `${rate}%`, transition: "width 0.5s" }} />
                    </div>
                    <span style={{ fontSize: 10, color: TX3, fontFamily: MONO }}>{f.fields_filled}/{f.fields_attempted}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // ── FILL TAB ──
  // ─────────────────────────────────────────────────────────────
  const FillTab = () => {
    const sectionNames = ["all", ...Array.from(new Set(nonFileFields.map(f => f.section || "General")))];
    const fillableCount = nonFileFields.filter(f => f.value || f.checked !== undefined).length;
    const manualCount = nonFileFields.filter(f => !f.tier).length;
    const INP: CSSProperties = {
      width: "100%", background: "rgba(255,255,255,0.04)", border: `1px solid ${BRD}`,
      borderRadius: 5, padding: "5px 8px", fontSize: 11, color: TX, fontFamily: SANS,
      boxSizing: "border-box" as const, outline: "none",
    };

    const ResumePickerRow = ({ type }: { type: "resume" | "cover_letter" }) => {
      const isCover = type === "cover_letter";
      const items = isCover ? coverLetters : resumes;
      const selected = isCover ? selectedCoverLetter : selectedResume;
      const setSelected = isCover ? setSelectedCoverLetter : setSelectedResume;
      const uploading = isCover ? uploadingCover : uploadingResume;
      const label = isCover ? "Cover Letter" : "Resume";

      const currentItem = items.find(r => r.id === selected);

      return (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: TX3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
            {currentItem?.pdfUrl && (
              <a href={currentItem.pdfUrl} download={`${currentItem.label}.pdf`} target="_blank" rel="noreferrer"
                style={{ fontSize: 10, color: BLUE, textDecoration: "none", cursor: "pointer" }}>⬇ Download</a>
            )}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <select value={selected} onChange={e => setSelected(e.target.value)}
              style={{ ...INP, flex: 1, cursor: "pointer" }}>
              {isCover && <option value="none">No Cover Letter</option>}
              {items.length === 0 && !isCover && <option value="">No resumes found</option>}
              {items.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <Btn size="sm" variant="ghost"
              disabled={uploading || (isCover && selected === "none") || !currentItem?.pdfUrl}
              onClick={() => handleUploadResume(type)}>
              {uploading ? "..." : "Attach"}
            </Btn>
          </div>
        </div>
      );
    };

    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {/* Header: status or tier summary */}
        <div style={{ padding: "10px 16px", borderBottom: `1px solid ${BRD}`, flexShrink: 0 }}>
          {fillState.status === "complete" ? (
            <div style={{
              background: `color-mix(in srgb, ${EM} 8%, ${CARD})`,
              border: `1px solid color-mix(in srgb, ${EM} 20%, ${BRD})`,
              borderRadius: 8, padding: "8px 12px",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{ fontSize: 14, color: EM }}>✓</span>
              <div>
                <div style={{ fontSize: 11, color: EM, fontWeight: 600 }}>
                  {fillState.filledCount} of {fillState.totalFillable || fillState.fields.length} fields filled
                </div>
                <div style={{ fontSize: 9, color: TX4 }}>
                  {tierStats["1"]} exact · {tierStats["2"]} vault matched · {tierStats["3"]} AI draft
                  {manualCount > 0 && ` · ${manualCount} manual`}
                </div>
              </div>
            </div>
          ) : filling ? (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: TX2 }}>Filling fields...</span>
              </div>
              <ProgressBar progress={50} />
            </div>
          ) : fillState.fields.length > 0 ? (
            <div style={{ display: "flex", gap: 6 }}>
              {[
                { tier: "1", label: "Exact", color: EM, count: tierStats["1"] || 0 },
                { tier: "2", label: "Vault", color: BLUE, count: tierStats["2"] || 0 },
                { tier: "3", label: "AI", color: AMBER, count: tierStats["3"] || 0 },
                { tier: "m", label: "Manual", color: TX4, count: manualCount },
              ].map(t => (
                <div key={t.tier} style={{
                  flex: 1, textAlign: "center", padding: "6px 0", borderRadius: 6,
                  background: `color-mix(in srgb, ${t.color} 6%, transparent)`,
                }}>
                  <div style={{ fontSize: 15, fontWeight: 700, fontFamily: MONO, color: t.color }}>{t.count}</div>
                  <div style={{ fontSize: 8, color: TX4 }}>{t.label}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* No detection — show scan button */}
        {fillState.fields.length === 0 && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: TX2, marginBottom: 6 }}>
              {job ? "Scanning fields..." : "Navigate to a job application"}
            </div>
            <div style={{ fontSize: 11, color: TX4, lineHeight: 1.6, maxWidth: 220, marginBottom: 16 }}>
              {job
                ? "Fields will appear here once the tier cascade completes."
                : "Open a job on Greenhouse, Lever, Workday, etc. and Vetidia will auto-scan."}
            </div>
            <Btn variant="primary" onClick={handleRescan} style={{ padding: "8px 20px" }}>
              🔍 Scan This Page
            </Btn>
          </div>
        )}

        {/* Field list + resume picker */}
        {fillState.fields.length > 0 && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            {/* Resume / Cover Letter pickers */}
            <div style={{ padding: "10px 16px", borderBottom: `1px solid ${BRD}` }}>
              <ResumePickerRow type="resume" />
              <ResumePickerRow type="cover_letter" />
            </div>

            {/* Section filter */}
            {sectionNames.length > 2 && (
              <div style={{ padding: "8px 16px", borderBottom: `1px solid ${BRD}`, display: "flex", gap: 6, overflowX: "auto" }}>
                {sectionNames.map(s => (
                  <Chip key={s} active={sectionFilter === s} onClick={() => setSectionFilter(s)}>
                    {s === "all" ? `All (${fillState.fields.length})` : s}
                  </Chip>
                ))}
              </div>
            )}

            {/* Fields */}
            <div style={{ padding: 12 }}>
              {filteredFields.map((field, i) => (
                <FieldRow key={field.id} field={field} index={i} show={show}
                  onSave={(v, checked) => handleFieldEdit(field.id, v, checked)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Footer: Fill button */}
        {fillState.fields.length > 0 && (
          <div style={{ padding: "10px 14px", borderTop: `1px solid ${BRD}`, display: "flex", gap: 8, flexShrink: 0 }}>
            <Btn variant="ghost" onClick={handleRescan} disabled={filling}>Re-scan</Btn>
            {fillState.status !== "complete" ? (
              <Btn variant="primary" style={{ flex: 1 }} onClick={handleStartFill} disabled={filling || fillableCount === 0}>
                {filling ? "Filling..." : `⚡ Fill ${fillableCount} Fields`}
              </Btn>
            ) : (
              <Btn variant="ghost" style={{ flex: 1 }} onClick={() => setFillState(prev => ({ ...prev, status: "idle" }))}>
                ↺ Re-fill
              </Btn>
            )}
          </div>
        )}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // ── VAULT TAB ──
  // ─────────────────────────────────────────────────────────────
  const VaultTab = () => {
    const cats = ["all", ...Array.from(new Set(answers.map(a => a.category)))];
    const filtered = vaultFilter === "all" ? answers : answers.filter(a => a.category === vaultFilter);

    return (
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {/* Category filter */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {cats.map(c => (
            <Chip key={c} active={vaultFilter === c} onClick={() => setVaultFilter(c)}>
              {c === "all" ? `All (${answers.length})` : c.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
            </Chip>
          ))}
        </div>

        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>��</div>
            <div style={{ fontSize: 12, color: TX2, marginBottom: 6 }}>No saved answers yet</div>
            <div style={{ fontSize: 10, color: TX4, lineHeight: 1.6 }}>
              As you apply to jobs, Vetidia learns your answers and stores them for future autofill.
            </div>
          </div>
        )}

        {filtered.map((a, i) => (
          <VaultAnswerCard key={a.id} answer={a} index={i} show={show}
            expanded={expandedAnswer === a.id}
            onToggle={() => setExpandedAnswer(expandedAnswer === a.id ? null : a.id)}
          />
        ))}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // ── SETTINGS TAB ──
  // ─────────────────────────────────────────────────────────────
  const SettingsTab = () => (
    <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
      <Section title="Behavior">
        {([ 
          { key: "autoDetect" as keyof Settings, label: "Auto-detect ATS pages", desc: "Scan for application forms automatically" },
          { key: "autoFillTier1" as keyof Settings, label: "Auto-fill Tier 1 fields", desc: "Fill name, email, phone without asking" },
          { key: "showBadges" as keyof Settings, label: "Show confidence badges", desc: "Display indicators on filled form fields" },
        ] as const).map(s => (
          <ToggleRow key={s.key} label={s.label} desc={s.desc}
            value={settings[s.key] as boolean}
            onChange={(v) => saveSetting(s.key, v)}
          />
        ))}
      </Section>

      <Section title="Thresholds">
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: TX2 }}>Tier 2 auto-fill threshold</span>
            <span style={{ fontSize: 11, fontFamily: MONO, color: BLUE, fontWeight: 600 }}>{settings.tier2Threshold}%</span>
          </div>
          <input type="range" min={60} max={95} value={settings.tier2Threshold}
            onChange={(e) => saveSetting("tier2Threshold", Number(e.target.value))}
            style={{ width: "100%", accentColor: EM }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: TX4, marginTop: 2 }}>
            <span>More suggestions</span><span>Higher accuracy</span>
          </div>
        </div>
      </Section>

      <Section title="Account">
        <div style={{ fontSize: 11, color: TX3, marginBottom: 8 }}>{user?.email || "Not signed in"}</div>
        <div style={{ display: "flex", gap: 6 }}>
          <Btn variant="ghost" style={{ flex: 1, fontSize: 11, padding: "6px 0" }}
            onClick={async () => {
              const pr = await chrome.runtime.sendMessage({ type: "GET_PROFILE" }).catch(() => null);
              if (pr?.profile) setProfile(pr.profile);
              const av = await chrome.runtime.sendMessage({ type: "GET_ANSWER_VAULT" }).catch(() => null);
              if (av?.answers) setAnswers(av.answers);
            }}>Sync Vault</Btn>
          <Btn variant="ghost" style={{ flex: 1, fontSize: 11, padding: "6px 0" }}
            onClick={async () => {
              await chrome.runtime.sendMessage({ type: "BACKFILL_EMBEDDINGS" }).catch(() => {});
            }}>Sync Embeddings</Btn>
          <Btn variant="ghost" style={{ flex: 1, fontSize: 11, padding: "6px 0" }}
            onClick={() => { chrome.storage.session.clear().catch(() => {}); }}>Clear Cache</Btn>
          <Btn variant="danger" style={{ flex: 1, fontSize: 11, padding: "6px 0" }}
            onClick={() => { chrome.runtime.sendMessage({ type: "SIGN_OUT" }).then(() => setUser(null)).catch(() => {}); }}>
            Sign Out
          </Btn>
        </div>
      </Section>

      <Section title="About">
        <div style={{ fontSize: 10, color: TX4, lineHeight: 1.6 }}>
          Vetidia Extension v0.2.0<br/>
          Career intelligence for job applications.<br/>
          <a href="https://vetidia.app" target="_blank" rel="noreferrer" style={{ color: EM, textDecoration: "none" }}>vetidia.app</a>
        </div>
      </Section>
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  // ── ROOT RENDER ──
  // ─────────────────────────────────────────────────────────────
  return (
    <div style={{
      width: "100%", height: "100vh", background: BASE, color: TX,
      fontFamily: SANS, display: "flex", flexDirection: "column",
      overflow: "hidden", fontSize: 12, lineHeight: 1.5,
    }}>
      {/* Header */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderBottom: `1px solid ${BRD}`,
        background: "rgba(255,255,255,0.01)", flexShrink: 0,
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
            <div style={{ fontSize: 10, color: TX3 }}>Career Intelligence</div>
          </div>
        </div>
        {job && (
          <span style={{
            fontSize: 9, fontWeight: 700, color: EM, letterSpacing: "0.06em",
            padding: "2px 6px", borderRadius: 4,
            background: `color-mix(in srgb, ${EM} 12%, transparent)`,
          }}>{job.ats.toUpperCase()}</span>
        )}
      </header>

      {/* Tab navigation */}
      <TabBar />

      {/* Tab content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {currentTab === "overview" && OverviewTab()}
        {currentTab === "fill" && FillTab()}
        {currentTab === "vault" && VaultTab()}
        {currentTab === "settings" && SettingsTab()}
      </div>
    </div>
  );
}

// ── Sub-components ──

function FieldRow({
  field, index, show, onSave,
}: {
  field: FillField; index: number; show: boolean;
  onSave: (v: string, checked?: boolean) => void;
}) {
  const tierColor = field.tier === 1 ? EM : field.tier === 2 ? BLUE : field.tier === 3 ? AMBER : "rgba(255,255,255,0.2)";
  const tierLabel = field.tier === 1 ? "T1" : field.tier === 2 ? "T2" : field.tier === 3 ? "T3" : "—";
  const isManual = !field.tier;

  const INP: CSSProperties = {
    width: "100%", background: "rgba(255,255,255,0.04)", border: `1px solid ${BRD}`,
    borderRadius: 5, padding: "5px 8px", fontSize: 11, color: TX, fontFamily: SANS,
    boxSizing: "border-box" as const, outline: "none",
  };

  // Render the right editable control based on field type
  const renderControl = () => {
    if (field.fieldType === "checkbox") {
      const isOn = !!field.checked;
      return (
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 11, color: TX }}>
          <div onClick={() => onSave(isOn ? "false" : "true", !isOn)} style={{
            width: 36, height: 20, borderRadius: 10,
            background: isOn ? EM : "rgba(255,255,255,0.12)",
            position: "relative", transition: "background 0.2s", cursor: "pointer",
            border: `1px solid ${isOn ? EM : BRD}`, flexShrink: 0,
          }}>
            <div style={{
              width: 16, height: 16, borderRadius: 8,
              background: "#fff", position: "absolute", top: 1,
              left: isOn ? 17 : 1, transition: "left 0.2s",
              boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
            }} />
          </div>
          {isOn ? "Yes" : "No"}
        </label>
      );
    }

    if (field.fieldType === "radio-group" && field.options?.length) {
      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {field.options.map(opt => (
            <label key={opt} style={{
              display: "flex", alignItems: "center", gap: 4, cursor: "pointer",
              fontSize: 10, color: field.value === opt ? TX : TX3,
              padding: "3px 8px", borderRadius: 5,
              border: `1px solid ${field.value === opt ? EM : BRD}`,
              background: field.value === opt ? `color-mix(in srgb, ${EM} 10%, transparent)` : "transparent",
            }}>
              <input type="radio" name={`field-${field.id}`} value={opt}
                checked={field.value === opt} onChange={() => onSave(opt)}
                style={{ display: "none" }} />
              {opt}
            </label>
          ))}
        </div>
      );
    }

    if ((field.fieldType === "select" || field.fieldType === "custom-dropdown") && field.options?.length) {
      return (
        <select value={field.value} onChange={e => onSave(e.target.value)}
          style={{ ...INP, cursor: "pointer", appearance: "auto" as const }}>
          <option value="">— Select —</option>
          {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    }

    if (field.fieldType === "select" || field.fieldType === "custom-dropdown") {
      return (
        <div>
          <input type="text" value={field.value} onChange={e => onSave(e.target.value)}
            placeholder="Type value (dropdown on page)"
            style={INP} />
          <div style={{ fontSize: 9, color: TX4, marginTop: 3 }}>⚠ Dropdown on page — type the value to fill</div>
        </div>
      );
    }

    if (field.type === "textarea" || field.label.toLowerCase().includes("cover letter") || (field.value && field.value.length > 100)) {
      return (
        <textarea value={field.value} onChange={e => onSave(e.target.value)} rows={3}
          placeholder={isManual ? "Enter value..." : ""}
          style={{ ...INP, resize: "vertical", lineHeight: 1.5 }} />
      );
    }

    return (
      <input type="text" value={field.value} onChange={e => onSave(e.target.value)}
        placeholder={isManual ? "Enter value..." : ""}
        style={INP} />
    );
  };

  return (
    <div style={{
      background: isManual ? `color-mix(in srgb, ${AMBER} 4%, ${CARD})` : CARD,
      border: `1px solid ${isManual ? `color-mix(in srgb, ${AMBER} 20%, ${BRD})` : BRD}`,
      borderRadius: 8, marginBottom: 6, padding: "8px 10px",
      ...enterStyle(show, index * 20),
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
        <span style={{
          fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
          color: tierColor,
          background: `color-mix(in srgb, ${tierColor} 12%, transparent)`,
          flexShrink: 0,
        }}>{tierLabel}</span>
        <span style={{ fontSize: 11, color: TX2, fontWeight: 500, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {field.label}
        </span>
        {field.required && <span style={{ fontSize: 8, color: AMBER, flexShrink: 0 }}>*</span>}
      </div>
      {renderControl()}
    </div>
  );
}

function VaultAnswerCard({
  answer, index, show, expanded, onToggle,
}: {
  answer: VaultAnswer; index: number; show: boolean; expanded: boolean; onToggle: () => void;
}) {
  const catColors: Record<string, string> = {
    technical: BLUE, work_auth: EM, work_authorization: EM,
    motivation: PURPLE, behavioral: AMBER, general: "rgba(255,255,255,0.35)",
    logistics: EM, compensation: AMBER, demographics: PURPLE,
    availability: BLUE,
  };
  const color = catColors[answer.category] || "rgba(255,255,255,0.35)";

  return (
    <div onClick={onToggle} style={{
      background: CARD, border: `1px solid ${expanded ? BRD_L : BRD}`,
      borderRadius: 8, padding: 12, marginBottom: 6, cursor: "pointer",
      ...enterStyle(show, index * 30),
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: TX, lineHeight: 1.5, marginBottom: 4, fontWeight: 500 }}>
            {answer.question_text}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 9, color, fontWeight: 600 }}>
              {answer.category.replace(/_/g, " ")}
            </span>
            <span style={{ fontSize: 9, color: TX4 }}>•</span>
            <span style={{ fontSize: 9, color: TX4 }}>Used {answer.times_used}×</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
          {answer.auto_fill_enabled && (
            <span style={{ fontSize: 8, fontWeight: 700, color: EM, letterSpacing: "0.05em", padding: "1px 5px", borderRadius: 3, background: `color-mix(in srgb, ${EM} 12%, transparent)` }}>AUTO</span>
          )}
          {answer.is_universal && (
            <span style={{ fontSize: 8, fontWeight: 700, color: BLUE, letterSpacing: "0.04em", padding: "1px 5px", borderRadius: 3, background: `color-mix(in srgb, ${BLUE} 12%, transparent)` }}>UNIVERSAL</span>
          )}
        </div>
      </div>
      {expanded && (
        <div onClick={e => e.stopPropagation()} style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BRD}` }}>
          <div style={{
            fontSize: 11, color: TX, lineHeight: 1.6, marginBottom: 10,
            padding: "8px 10px", borderRadius: 6, background: "rgba(255,255,255,0.02)",
          }}>{answer.answer_text}</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 9, color: TX4 }}>Confidence</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 60, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.08)" }}>
                <div style={{ height: "100%", borderRadius: 2, background: answer.confidence_score >= 0.9 ? EM : AMBER, width: `${(answer.confidence_score || 0) * 100}%` }} />
              </div>
              <span style={{ fontSize: 10, fontFamily: "monospace", color: answer.confidence_score >= 0.9 ? EM : AMBER, fontWeight: 600 }}>
                {Math.round((answer.confidence_score || 0) * 100)}%
              </span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: `1px solid ${BRD}`, background: "transparent", color: TX3, fontSize: 10, cursor: "pointer" }}>Edit</button>
            <button style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: `1px solid ${BRD}`, background: "transparent", color: TX3, fontSize: 10, cursor: "pointer" }}>Promote</button>
            <button style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: `1px solid rgba(239,68,68,0.3)`, background: "transparent", color: "rgb(239,68,68)", fontSize: 10, cursor: "pointer" }}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleRow({
  label, desc, value, onChange,
}: {
  label: string; desc: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div onClick={() => onChange(!value)} style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 0", borderBottom: `1px solid ${BRD}`, cursor: "pointer",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: TX, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 10, color: TX4, marginTop: 2 }}>{desc}</div>
      </div>
      <div style={{
        width: 36, height: 20, borderRadius: 10, marginLeft: 12, flexShrink: 0,
        background: value ? EM : "rgba(255,255,255,0.1)",
        transition: "background 0.2s",
        position: "relative",
      }}>
        <div style={{
          position: "absolute", top: 2, left: value ? 18 : 2,
          width: 16, height: 16, borderRadius: 8,
          background: value ? "#000" : "rgba(255,255,255,0.5)",
          transition: "left 0.2s",
        }} />
      </div>
    </div>
  );
}
