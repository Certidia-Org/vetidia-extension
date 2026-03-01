import { getSupabase } from "@/lib/supabase";
import { signInWithGoogle, signOut, getCurrentUser } from "@/lib/auth";
import { classifyFields, generateAnswer } from "@/lib/ai-classifier";
import { matchAnswerFromVault, saveAnswerToVault, updateLearningSignal, logFormSubmission } from "@/lib/answer-vault";
import type { BackgroundMessage, UserProfile } from "@/lib/messaging";

const SUPABASE_URL = "https://jvkvfuohixdajphtkhrz.supabase.co";
const EDGE_FN = `${SUPABASE_URL}/functions/v1`;
const PROFILE_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const WEB_APP_URL = "https://vetidia.app"; // heartbeat target

export default defineBackground(() => {
  console.log("[Vetidia] Service worker started");

  const supabase = getSupabase();

  // ── Side Panel: open on toolbar icon click ──
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }

  // ── Tab badge management ──
  const ATS_URL_PATTERNS = [
    "greenhouse.io", "lever.co", "myworkdayjobs.com", "ashbyhq.com",
    "icims.com", "smartrecruiters.com", "linkedin.com/jobs",
    "taleo.net", "breezy.hr", "bamboohr.com", "jazz.co",
    "jobvite.com", "recruitee.com", "workable.com",
  ];

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete" || !tab.url) return;
    const isATS = ATS_URL_PATTERNS.some((p) => tab.url!.includes(p));
    if (isATS) {
      chrome.action.setBadgeText({ tabId, text: "•" });
      chrome.action.setBadgeBackgroundColor({ tabId, color: "#10b981" });
    } else {
      chrome.action.setBadgeText({ tabId, text: "" });
      // Clear stale tab state
      chrome.storage.session.remove(`tab_${tabId}`).catch(() => {});
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.storage.session.remove(`tab_${tabId}`).catch(() => {});
  });

  supabase.auth.onAuthStateChange((event, _session) => {
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
      console.log(`[Vetidia] Auth event: ${event}`);
      // Refresh profile cache on sign-in
      cacheProfileFromDB().catch(() => {});
    }
    if (event === "SIGNED_OUT") {
      console.log("[Vetidia] User signed out");
      chrome.storage.local.remove(["profileCache", "profileCacheTime"]);
    }
  });

  chrome.runtime.onMessage.addListener(
    (message: BackgroundMessage, sender, sendResponse) => {
      const tabId = sender.tab?.id;
      handleMessage(message, tabId)
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
      return true;
    },
  );

  // Alarms: token refresh (10 min), profile cache refresh (30 min), heartbeat (60 min)
  chrome.alarms.create("refresh-session", { periodInMinutes: 10 });
  chrome.alarms.create("refresh-profile-cache", { periodInMinutes: 30 });
  chrome.alarms.create("heartbeat", { periodInMinutes: 60 });
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "refresh-session") {
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.auth.refreshSession();
    }
    if (alarm.name === "refresh-profile-cache") {
      await cacheProfileFromDB().catch(() => {});
    }
    if (alarm.name === "heartbeat") {
      await sendHeartbeat().catch(() => {});
    }
  });

  // Initial profile cache on startup
  cacheProfileFromDB().catch(() => {});
});

async function handleMessage(message: BackgroundMessage, senderTabId?: number) {
  switch (message.type) {
    case "GET_AUTH_STATE": {
      const user = await getCurrentUser();
      return { user: user ? { id: user.id, email: user.email } : null };
    }

    case "SIGN_IN": {
      return signInWithGoogle();
    }

    case "SIGN_OUT": {
      await signOut();
      return { success: true };
    }

    case "ATS_PAGE_DETECTED" as string:
    case "JOB_PAGE_DETECTED": {
      if (senderTabId) {
        // Set badge icon
        chrome.action.setBadgeText({ tabId: senderTabId, text: "•" });
        chrome.action.setBadgeBackgroundColor({ tabId: senderTabId, color: "#10b981" });
        // Store tab state in session storage
        const tabKey = `tab_${senderTabId}`;
        const existing = await chrome.storage.session.get(tabKey);
        await chrome.storage.session.set({
          [tabKey]: { ...((existing[tabKey] as object) || {}), job: message.payload },
        });
      }
      // Forward to all extension pages (side panel picks this up)
      chrome.runtime.sendMessage({ type: "JOB_PAGE_DETECTED", payload: message.payload }).catch(() => {});
      return { success: true };
    }

    case "GET_PROFILE": {
      const user = await getCurrentUser();
      if (!user) return { profile: null, error: "Not authenticated" };

      // Check cache first
      const cached = await getCachedProfile();
      if (cached) return { profile: cached, source: "cache" };

      // Fetch from application_profiles (single flat table — fast)
      const profile = await fetchAndCacheProfile(user.id, user.email ?? "");
      return { profile, source: "db" };
    }

    case "GET_CACHED_PROFILE": {
      const cached = await getCachedProfile();
      if (cached) return { profile: cached, source: "cache" };
      // If no cache, do a full fetch
      const user = await getCurrentUser();
      if (!user) return { profile: null, error: "Not authenticated" };
      const profile = await fetchAndCacheProfile(user.id, user.email ?? "");
      return { profile, source: "db" };
    }

    case "SYNC_PROFILE": {
      const user = await getCurrentUser();
      if (!user) return { error: "Not authenticated" };
      chrome.storage.local.remove(["profileCache", "profileCacheTime"]);
      const profile = await fetchAndCacheProfile(user.id, user.email ?? "");
      return { profile, synced: true };
    }

    case "GET_DOCUMENTS": {
      const user = await getCurrentUser();
      if (!user) return { documents: [], error: "Not authenticated" };

      const supabase = getSupabase();
      const fileType = (message as { payload?: { fileType?: string } }).payload?.fileType;

      let query = supabase
        .from("documents")
        .select("id, file_name, file_url, file_type, job_id, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (fileType) {
        query = query.eq("file_type", fileType);
      }

      const { data, error } = await query;
      if (error) return { documents: [], error: error.message };
      return { documents: data ?? [] };
    }

    case "GET_FILE_DATA": {
      const user = await getCurrentUser();
      if (!user) return { data: null, error: "Not authenticated" };

      const { fileUrl, fileName } = (message as { payload: { fileUrl: string; fileName: string } }).payload;

      let blob: Blob | null = null;

      // If fileUrl is a full URL (signed URL), fetch it directly
      if (fileUrl.startsWith("http")) {
        try {
          const resp = await fetch(fileUrl);
          if (resp.ok) blob = await resp.blob();
        } catch { /* fall through to storage download */ }
      }

      // Otherwise (or if direct fetch failed), treat as storage path
      if (!blob) {
        const supabase = getSupabase();
        const { data: dlBlob, error } = await supabase.storage
          .from("resumes")
          .download(fileUrl);
        if (error || !dlBlob) {
          return { data: null, error: error?.message ?? "Failed to download file" };
        }
        blob = dlBlob;
      }

      // Convert blob to base64 for transfer to content script
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      // Determine MIME type from file name
      const ext = fileName.split(".").pop()?.toLowerCase();
      const mimeTypes: Record<string, string> = {
        pdf: "application/pdf",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        doc: "application/msword",
        txt: "text/plain",
      };

      return {
        data: base64,
        mimeType: mimeTypes[ext ?? ""] ?? "application/octet-stream",
        fileName,
      };
    }

    case "AI_CLASSIFY_FIELDS": {
      const user = await getCurrentUser();
      if (!user) return { classifications: [], error: "Not authenticated" };

      const { fields } = (message as { payload: { fields: unknown[] } }).payload;
      const classifications = await classifyFields(fields as Parameters<typeof classifyFields>[0]);
      return { classifications };
    }

    case "AI_GENERATE_ANSWER": {
      const user = await getCurrentUser();
      if (!user) return { answer: "", error: "Not authenticated" };

      const { question, profileContext, jobContext, maxLength } =
        (message as { payload: { question: string; profileContext: string; jobContext?: string; maxLength?: number } }).payload;
      // Try Edge Function first (has vault context built-in)
      try {
        const result = await callEdgeFunction("ext-generate-answer", {
          question, jobContext, maxLength: maxLength || 500,
        });
        if (result?.answer) return { answer: result.answer, confidence: "low", tier: 3 };
      } catch {
        // Fallback to local AI classifier
      }
      const result = await generateAnswer(question, profileContext, jobContext, maxLength);
      return result;
    }

    case "MATCH_ANSWER_VAULT": {
      const user = await getCurrentUser();
      if (!user) return { answer: null, error: "Not authenticated" };

      const msg = message as { questionText: string; category?: string };
      // Try Edge Function first (semantic + exact match)
      try {
        const result = await callEdgeFunction("ext-match-answer", {
          questionText: msg.questionText,
          category: msg.category,
        });
        if (result?.match) return { answer: result.match, alternatives: result.alternatives };
      } catch {
        // Fallback to local lib
      }
      const answer = await matchAnswerFromVault(msg.questionText, user.id);
      return { answer };
    }

    case "SAVE_ANSWER": {
      const user = await getCurrentUser();
      if (!user) return { error: "Not authenticated" };

      const msg = message as { questionText: string; answerText: string; category?: string; atsType?: string; pageUrl?: string };
      try {
        const result = await callEdgeFunction("ext-save-answer", {
          questionText: msg.questionText,
          answerText: msg.answerText,
          category: msg.category || "general",
          sourceAts: msg.atsType,
          sourceUrl: msg.pageUrl,
        });
        return { success: true, ...result };
      } catch {
        // Fallback to local lib
        await saveAnswerToVault(user.id, msg.questionText, msg.answerText, msg.category || "general", msg.atsType || null, msg.pageUrl || null);
        return { success: true };
      }
    }

    case "UPDATE_LEARNING": {
      const msg = message as { answerId: string; action: "accepted" | "edited" | "rejected"; editedText?: string };
      try {
        const result = await callEdgeFunction("ext-update-signals", {
          answerId: msg.answerId,
          signal: msg.action,
          editedAnswer: msg.editedText,
        });
        return { success: true, ...result };
      } catch {
        await updateLearningSignal(msg.answerId, msg.action, msg.editedText);
        return { success: true };
      }
    }

    case "LOG_SUBMISSION": {
      const user = await getCurrentUser();
      if (!user) return { error: "Not authenticated" };

      const msg = message as { atsType: string; pageUrl: string; fieldsAttempted: number; fieldsFilled: number; fieldsSkipped: number; fieldDetails: Record<string, unknown>[] };
      await logFormSubmission(
        user.id,
        msg.atsType,
        msg.pageUrl,
        msg.fieldsAttempted,
        msg.fieldsFilled,
        msg.fieldsSkipped,
        msg.fieldDetails,
      );
      return { success: true };
    }

    case "GET_APPLICATION_PROFILE": {
      const user = await getCurrentUser();
      if (!user) return { profile: null, error: "Not authenticated" };

      const supabase = getSupabase();
      const { data } = await supabase
        .from("application_profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      return { profile: data };
    }

    case "GET_ANSWER_VAULT": {
      const user = await getCurrentUser();
      if (!user) return { answers: [], error: "Not authenticated" };

      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("answer_vault")
        .select("id, question_text, answer_text, category, confidence_score, auto_fill_enabled, times_used, times_accepted, is_universal, source_ats, source_company")
        .eq("user_id", user.id)
        .eq("is_current", true)
        .order("category")
        .order("times_used", { ascending: false })
        .limit(200);

      if (error) return { answers: [], error: error.message };

      return {
        answers: (data ?? []).map((a: Record<string, unknown>) => ({
          id: a.id,
          question_text: a.question_text,
          answer_text: a.answer_text,
          category: a.category || "general",
          confidence_score: a.confidence_score,
          auto_fill_enabled: a.auto_fill_enabled,
          times_used: a.times_used,
          times_accepted: a.times_accepted,
          is_universal: a.is_universal,
          source_ats: a.source_ats,
          source_company: a.source_company,
        })),
      };
    }

    case "BACKFILL_EMBEDDINGS": {
      try {
        const result = await callEdgeFunction("ext-backfill-embeddings", {});
        return { success: true, ...result };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Failed" };
      }
    }

    case "GET_ANSWER_VAULT_STATS": {
      const user = await getCurrentUser();
      if (!user) return { answers: [], count: 0, autoFillCount: 0 };

      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("answer_vault")
        .select("id, question_text, answer_text, category, times_used, times_accepted, confidence_score, auto_fill_enabled, is_universal, source_ats")
        .eq("user_id", user.id)
        .eq("is_current", true)
        .order("times_used", { ascending: false })
        .limit(100);

      if (error) return { answers: [], count: 0, autoFillCount: 0, error: error.message };

      const answers = data ?? [];
      return {
        answers,
        count: answers.length,
        autoFillCount: answers.filter((a: { auto_fill_enabled: boolean }) => a.auto_fill_enabled).length,
      };
    }

    case "GET_FILL_HISTORY": {
      const user = await getCurrentUser();
      if (!user) return { submissions: [], count: 0 };

      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("form_submissions")
        .select("id, ats_type, page_url, fields_attempted, fields_filled, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) return { submissions: [], count: 0, error: error.message };

      return { submissions: data ?? [], count: data?.length ?? 0 };
    }

    case "OPEN_SIDE_PANEL": {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          // Use tabId for more reliable opening (Chrome 116+)
          await (chrome.sidePanel as any).open({ tabId: tab.id });
        }
        return { success: true };
      } catch (err) {
        // Fallback: try windowId
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.windowId) {
            await (chrome.sidePanel as any).open({ windowId: tab.windowId });
          }
          return { success: true };
        } catch (err2) {
          return { error: err2 instanceof Error ? err2.message : "Failed to open side panel" };
        }
      }
    }

    case "FIELDS_SCANNED": {
      // Store fields in session storage
      if (senderTabId) {
        const tabKey = `tab_${senderTabId}`;
        const existing = await chrome.storage.session.get(tabKey);
        await chrome.storage.session.set({
          [tabKey]: { ...((existing[tabKey] as object) || {}), fields: message.payload },
        });
      }
      chrome.runtime.sendMessage({ type: "FIELDS_SCANNED", payload: message.payload }).catch(() => {});
      return { success: true };
    }

    case "FILL_COMPLETE": {
      // Store fill results in session storage
      if (senderTabId) {
        const tabKey = `tab_${senderTabId}`;
        const existing = await chrome.storage.session.get(tabKey);
        await chrome.storage.session.set({
          [tabKey]: { ...((existing[tabKey] as object) || {}), fillResult: message.payload },
        });
      }
      chrome.runtime.sendMessage({ type: "FILL_COMPLETE", payload: message.payload }).catch(() => {});
      return { success: true };
    }

    case "GET_TAB_STATE": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { state: null };
      const tabKey = `tab_${tab.id}`;
      const stored = await chrome.storage.session.get(tabKey);
      return { state: stored[tabKey] ?? null };
    }

    case "PANEL_FILL_FIELDS": {
      // Forward to active tab's content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { success: false, error: "No active tab" };
      try {
        const result = await chrome.tabs.sendMessage(tab.id, message);
        return result;
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Content script unreachable" };
      }
    }

    case "TRIGGER_FILE_UPLOAD": {
      // Forward to active tab's content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { success: false, error: "No active tab" };
      try {
        const result = await chrome.tabs.sendMessage(tab.id, message);
        return result;
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Content script unreachable" };
      }
    }

    case "GET_USER_RESUMES": {
      const user = await getCurrentUser();
      if (!user) return { resumes: [], coverLetters: [], error: "Not authenticated" };
      const supabase = getSupabase();

      // 1. Fetch base/uploaded resumes from documents table
      const { data: baseResumes } = await supabase
        .from("documents")
        .select("id, file_name, file_url, file_type, created_at")
        .eq("user_id", user.id)
        .eq("file_type", "resume")
        .order("created_at", { ascending: false })
        .limit(10);

      // 2. Fetch base cover letters from documents table
      const { data: baseCoverLetters } = await supabase
        .from("documents")
        .select("id, file_name, file_url, file_type, created_at")
        .eq("user_id", user.id)
        .eq("file_type", "cover_letter")
        .order("created_at", { ascending: false })
        .limit(10);

      // 3. Fetch tailored resumes (job-specific, with PDFs)
      const { data: tailored } = await supabase
        .from("tailored_resumes")
        .select("id, job_id, pdf_url, docx_url, created_at, version")
        .eq("user_id", user.id)
        .not("pdf_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(20);

      // 4. Fetch tailored cover letters
      const { data: coverLetters } = await supabase
        .from("cover_letters")
        .select("id, job_id, pdf_url, docx_url, created_at, version")
        .eq("user_id", user.id)
        .not("pdf_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(20);

      // 5. Fetch job titles for labeling tailored items
      const jobIds = [...new Set([
        ...(tailored ?? []).map(r => r.job_id).filter(Boolean),
        ...(coverLetters ?? []).map(r => r.job_id).filter(Boolean),
      ])];
      let jobMap: Record<string, string> = {};
      if (jobIds.length > 0) {
        const { data: jobs } = await supabase
          .from("jobs")
          .select("id, title, company")
          .in("id", jobIds);
        if (jobs) {
          jobMap = Object.fromEntries(jobs.map(j => [j.id, `${j.title} @ ${j.company}`]));
        }
      }

      // Build resume list: base resumes first, then tailored
      // Generate signed URLs for Supabase storage paths
      const signUrl = async (path: string | null): Promise<string | null> => {
        if (!path) return null;
        try {
          const { data } = await supabase.storage.from("resumes").createSignedUrl(path, 3600);
          return data?.signedUrl ?? null;
        } catch { return null; }
      };

      const resumes = [];
      for (const r of (baseResumes ?? [])) {
        const signedUrl = await signUrl(r.file_url);
        resumes.push({
          id: r.id,
          label: r.file_name.replace(/\.[^.]+$/, "") || "Profile Resume",
          pdfUrl: signedUrl,
          docxUrl: null as string | null,
          jobId: null as string | null,
          storagePath: r.file_url,
          isBase: true,
        });
      }
      for (const r of (tailored ?? [])) {
        resumes.push({
          id: r.id,
          label: r.job_id ? (jobMap[r.job_id] ?? "Tailored Resume") : "Tailored Resume",
          pdfUrl: r.pdf_url,
          docxUrl: r.docx_url,
          jobId: r.job_id,
          storagePath: null as string | null,
          isBase: false,
        });
      }

      const coverLetterList = [];
      for (const r of (baseCoverLetters ?? [])) {
        const signedUrl = await signUrl(r.file_url);
        coverLetterList.push({
          id: r.id,
          label: r.file_name.replace(/\.[^.]+$/, "") || "Cover Letter",
          pdfUrl: signedUrl,
          docxUrl: null as string | null,
          jobId: null as string | null,
          storagePath: r.file_url,
          isBase: true,
        });
      }
      for (const r of (coverLetters ?? [])) {
        coverLetterList.push({
          id: r.id,
          label: r.job_id ? (jobMap[r.job_id] ?? "Tailored Cover Letter") : "Cover Letter",
          pdfUrl: r.pdf_url,
          docxUrl: r.docx_url,
          jobId: r.job_id,
          storagePath: null as string | null,
          isBase: false,
        });
      }

      return { resumes, coverLetters: coverLetterList };
    }

    default:
      return { error: `Unknown message type: ${(message as { type: string }).type}` };
  }
}

// ─── Profile cache helpers ────────────────────────────────────

async function getCachedProfile(): Promise<UserProfile | null> {
  try {
    const result = await chrome.storage.local.get(["profileCache", "profileCacheTime"]);
    if (result.profileCache && result.profileCacheTime) {
      const age = Date.now() - result.profileCacheTime;
      if (age < PROFILE_CACHE_TTL) return result.profileCache as UserProfile;
    }
  } catch {}
  return null;
}

async function fetchAndCacheProfile(userId: string, email: string): Promise<UserProfile | null> {
  const supabase = getSupabase();

  // Try application_profiles first (flat, fast)
  const { data: ap } = await supabase
    .from("application_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (ap) {
    // Also fetch raw experiences/education for multi-entry ATS forms
    const { data: master } = await supabase
      .from("master_profiles")
      .select("experiences, education")
      .eq("user_id", userId)
      .maybeSingle();

    const exps = (master?.experiences ?? []) as Array<Record<string, unknown>>;
    const edu = (master?.education ?? []) as Array<Record<string, unknown>>;

    const profile: UserProfile = {
      name: [ap.first_name, ap.last_name].filter(Boolean).join(" "),
      first_name: ap.first_name ?? "",
      last_name: ap.last_name ?? "",
      email: ap.email ?? email,
      phone: ap.phone ?? null,
      location: [ap.city, ap.state, ap.country].filter(Boolean).join(", ") || null,
      city: ap.city ?? null,
      state: ap.state ?? null,
      country: ap.country ?? null,
      zip_code: ap.zip_code ?? null,
      address: ap.address ?? null,
      linkedin_url: ap.linkedin_url ?? null,
      portfolio_url: ap.portfolio_url ?? null,
      github_url: ap.github_url ?? null,
      website_url: ap.website_url ?? null,
      current_title: ap.current_title ?? null,
      current_company: ap.current_company ?? null,
      years_of_experience: ap.years_of_experience ?? null,
      summary: ap.summary ?? null,
      education_level: ap.education_level ?? null,
      university: ap.university ?? null,
      field_of_study: ap.field_of_study ?? null,
      graduation_year: ap.graduation_year ?? null,
      gpa: ap.gpa ?? null,
      work_authorization: ap.work_authorization ?? null,
      authorized_to_work: ap.authorized_to_work ?? null,
      citizenship: ap.citizenship ?? null,
      gender: ap.gender ?? null,
      pronouns: ap.pronouns ?? null,
      race_ethnicity: ap.race_ethnicity ?? null,
      veteran_status: ap.veteran_status ?? null,
      disability_status: ap.disability_status ?? null,
      salary_expectation: ap.salary_expectation ?? null,
      desired_salary: ap.desired_salary ?? null,
      start_date: ap.start_date ?? null,
      notice_period: ap.notice_period ?? null,
      willing_to_relocate: ap.willing_to_relocate ?? null,
      remote_preference: ap.remote_preference ?? null,
      referral_source: ap.referral_source ?? null,
      skills: ap.skills ?? null,
      languages_programming: ap.languages_programming ?? null,
      languages_spoken: ap.languages_spoken ?? null,
      previous_company: ap.previous_company ?? null,
      previous_title: ap.previous_title ?? null,
      _experiences: exps.map((e) => ({
        title: String(e.title ?? ""),
        company: String(e.company ?? ""),
        startDate: String(e.startDate ?? ""),
        endDate: String(e.endDate ?? ""),
        description: Array.isArray(e.achievements) && (e.achievements as string[]).length > 0
          ? (e.achievements as string[]).map((a: string) => `• ${a}`).join("\n")
          : String(e.description ?? ""),
        location: String(e.location ?? ""),
      })),
      _education: edu.map((e) => ({
        institution: String((e as Record<string, unknown>).institution ?? ""),
        degree: String((e as Record<string, unknown>).degree ?? ""),
        field: String((e as Record<string, unknown>).field ?? ""),
        startDate: String((e as Record<string, unknown>).startDate ?? ""),
        endDate: String((e as Record<string, unknown>).endDate ?? ""),
        gpa: String((e as Record<string, unknown>).gpa ?? ""),
      })),
    };

    // Cache the profile
    await chrome.storage.local.set({ profileCache: profile, profileCacheTime: Date.now() });
    return profile;
  }

  // Fallback: build from master_profiles (legacy path)
  const { data, error } = await supabase
    .from("master_profiles")
    .select("personal_info, experiences, education, skills")
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;

  const pi = (data.personal_info ?? {}) as Record<string, string>;
  const exps = (data.experiences ?? []) as Array<Record<string, unknown>>;
  const eduArr = (data.education ?? []) as Array<Record<string, unknown>>;
  const skillGroups = (data.skills ?? []) as Array<{ category: string; items: string[] }>;

  const fullName = pi.name ?? "";
  const nameParts = fullName.trim().split(/\s+/);
  const locStr = pi.location ?? "";
  const locParts = locStr.split(",").map((s: string) => s.trim()).filter(Boolean);
  const currentExp = exps[0] as Record<string, string> | undefined;
  const previousExp = exps[1] as Record<string, string> | undefined;
  const firstEdu = eduArr[0] as Record<string, string> | undefined;
  const allSkills = skillGroups.flatMap((g) => g.items);

  let linkedinUrl = pi.linkedin ?? null;
  if (linkedinUrl && !linkedinUrl.startsWith("http")) linkedinUrl = `https://${linkedinUrl}`;

  const profile: UserProfile = {
    name: fullName,
    first_name: nameParts[0] ?? "",
    last_name: nameParts.slice(1).join(" ") ?? "",
    email: pi.email ?? email,
    phone: pi.phone ?? null,
    location: pi.location ?? null,
    city: locParts[0] || null,
    state: locParts.length >= 2 ? locParts[locParts.length - 2] : null,
    country: locParts.length >= 1 ? locParts[locParts.length - 1] : null,
    zip_code: pi.zip_code ?? pi.postal_code ?? null,
    address: pi.address ?? null,
    linkedin_url: linkedinUrl,
    portfolio_url: pi.portfolio ?? pi.website ?? null,
    github_url: pi.github ?? null,
    website_url: pi.website ?? pi.portfolio ?? null,
    current_title: currentExp?.title ?? null,
    current_company: currentExp?.company ?? null,
    years_of_experience: null,
    summary: pi.summary ?? null,
    education_level: firstEdu?.degree ?? null,
    university: firstEdu?.institution ?? null,
    field_of_study: firstEdu?.field ?? null,
    graduation_year: null,
    gpa: firstEdu?.gpa ?? null,
    work_authorization: null, authorized_to_work: null, citizenship: null,
    gender: null, pronouns: null, race_ethnicity: null, veteran_status: null, disability_status: null,
    salary_expectation: null, desired_salary: null, start_date: null, notice_period: null,
    willing_to_relocate: null, remote_preference: null, referral_source: null,
    skills: allSkills.length > 0 ? allSkills.slice(0, 20).join(", ") : null,
    languages_programming: null, languages_spoken: null,
    previous_company: previousExp?.company ?? null,
    previous_title: previousExp?.title ?? null,
    _experiences: exps.map((e) => ({
      title: String(e.title ?? ""), company: String(e.company ?? ""),
      startDate: String(e.startDate ?? ""), endDate: String(e.endDate ?? ""),
      description: Array.isArray(e.achievements) ? (e.achievements as string[]).map((a: string) => `• ${a}`).join("\n") : String(e.description ?? ""),
      location: String(e.location ?? ""),
    })),
    _education: eduArr.map((e) => ({
      institution: String((e as Record<string, unknown>).institution ?? ""),
      degree: String((e as Record<string, unknown>).degree ?? ""),
      field: String((e as Record<string, unknown>).field ?? ""),
      startDate: String((e as Record<string, unknown>).startDate ?? ""),
      endDate: String((e as Record<string, unknown>).endDate ?? ""),
      gpa: String((e as Record<string, unknown>).gpa ?? ""),
    })),
  };

  await chrome.storage.local.set({ profileCache: profile, profileCacheTime: Date.now() });
  return profile;
}

async function cacheProfileFromDB(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  await fetchAndCacheProfile(user.id, user.email ?? "");
}

// ─── Edge Function caller ─────────────────────────────────────

async function callEdgeFunction(fnName: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("No session");

  const resp = await fetch(`${EDGE_FN}/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.access_token}`,
      "apikey": import.meta.env.WXT_SUPABASE_ANON_KEY || "",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Edge Function ${fnName} failed: ${resp.status} ${text}`);
  }

  return resp.json();
}

// ─── Heartbeat ─────────────────────────────────────────────────

async function sendHeartbeat(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return;

  const manifest = chrome.runtime.getManifest();
  try {
    await fetch(`${WEB_APP_URL}/api/extension-heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        extensionVersion: manifest.version,
        browser: "chrome",
      }),
    });
  } catch {
    // Heartbeat is best-effort
  }
}
