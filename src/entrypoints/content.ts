import { detectATS, isApplicationPage, getATSHandler } from "@/ats";
import { genericHandler, detectFieldsWithAI } from "@/ats/generic";
import { detectFields as detectFieldsNew } from "@/content/detector/field-detector";
import { tier2Match } from "@/content/filler/tier2";
import { tier3Generate } from "@/content/filler/tier3";
import { applyFill } from "@/content/filler/field-filler";
import { setupFormSubmitCapture } from "@/content/capture/answer-capture";
import { startPageObserver, stopPageObserver, watchUrlChanges } from "@/content/detector/page-observer";
import { uploadFileToInput } from "@/content/file-upload";
import type { FieldFillResult, DetectedFieldInfo } from "@/content/filler/types";
import type {
  ContentMessage,
  ATSDetectionResult,
  DetectedField,
  UserProfile,
  FieldFillRequest,
} from "@/lib/messaging";

export default defineContentScript({
  matches: [
    "https://boards.greenhouse.io/*",
    "https://*.greenhouse.io/*",
    "https://jobs.lever.co/*",
    "https://apply.lever.co/*",
    "https://*.myworkdayjobs.com/*",
    "https://*.wd1.myworkdayjobs.com/*",
    "https://*.wd5.myworkdayjobs.com/*",
    "https://*.icims.com/*",
    "https://*.ashbyhq.com/*",
    "https://*.smartrecruiters.com/*",
    "https://*.linkedin.com/*",
    "https://*.taleo.net/*",
    "https://*.breezy.hr/*",
    "https://*.bamboohr.com/*",
    "https://*.jazz.co/*",
    "https://*.jobvite.com/*",
    "https://*.recruitee.com/*",
    "https://*.workable.com/*",
  ],
  allFrames: false,

  main() {
    console.log("[Vetidia] Content script loaded on:", window.location.href);

    const platform = detectATS(window.location.href, document);
    const isApp = isApplicationPage(window.location.href, document);

    if (platform) {
      console.log(`[Vetidia] Detected ATS: ${platform}, isApp: ${isApp}`);
    }

    let overlayActive = false;
    let cachedProfile: UserProfile | null = null;
    let cachedHandler: ReturnType<typeof getATSHandler> = null;
    let cachedFields: DetectedField[] = [];
    let cachedUnmatchedFields: DetectedFieldInfo[] = [];
    const fillResults = new Map<string, FieldFillResult>();
    let captureCleanup: (() => void) | null = null;

    // Initialize on application pages
    if (platform && isApp) {
      initWidget(platform);
    }

    // Watch for SPA navigation
    const stopUrlWatch = watchUrlChanges((newUrl) => {
      const newPlatform = detectATS(newUrl, document);
      const newIsApp = isApplicationPage(newUrl, document);
      if (newPlatform && newIsApp && !overlayActive) {
        initWidget(newPlatform);
      } else if (!newIsApp && overlayActive) {
        cleanup();
      }
    });

    // Workday multi-page wizard
    if (platform === "workday") {
      startPageObserver(() => {
        if (overlayActive && platform) rescanFields(platform);
      }, document.body, 800);
    }

    function cleanup() {
      stopPageObserver();
      captureCleanup?.();
      fillResults.clear();
      overlayActive = false;
    }

    async function initWidget(plat: string) {
      try {
        const delay = plat === "workday" ? 1500 : 500;
        await new Promise((r) => setTimeout(r, delay));

      const specificHandler = getATSHandler(plat as Parameters<typeof getATSHandler>[0]);
      const handler = specificHandler ?? genericHandler;
      const useAI = !specificHandler;
      cachedHandler = handler;

      // Extract job context from the page for AI generation
      const jobContext = extractJobContext(document, plat);

      // Get profile from background (uses cache)
      try {
        const resp = await chrome.runtime.sendMessage({ type: "GET_CACHED_PROFILE" });
        cachedProfile = resp?.profile ?? null;
      } catch {
        return;
      }
      if (!cachedProfile) return;

      // Detect fields using existing ATS handler (Tier 1 mapping)
      let fields = handler.detectFields(document, cachedProfile);

      // Also detect with new universal detector for fields ATS handler missed
      const newFields = detectFieldsNew(document);
      // Total is the union of both detector results
      const allDetectedSelectors = new Set([
        ...fields.map(f => f.selector),
        ...newFields.map(f => f.selector),
      ]);
      const totalFieldCount = allDetectedSelectors.size;

      if (fields.length === 0 && newFields.length === 0) return;

      // Run tier cascade on detected fields
      fillResults.clear();

      // Tier 1: ATS-specific handler results (already matched to profile keys)
      for (const f of fields) {
        if (f.profileKey && f.profileKey !== null) {
          const value = getProfileValue(cachedProfile, f.profileKey);
          if (value) {
            fillResults.set(f.selector || `field-${f.label}`, {
              fieldId: f.selector || `field-${f.label}`,
              label: f.label,
              selector: f.selector || "",
              tier: 1,
              confidence: "high",
              value,
              profileKey: f.profileKey,
              autoFilled: true,
              element: document.querySelector(f.selector) as HTMLElement || document.body,
              originalValue: "",
            });
          }
        }
      }

      // Gather all unmatched fields (from both old and new detectors)
      const matchedSelectors = new Set(
        Array.from(fillResults.values()).map(r => r.selector),
      );
      const unmatchedFields: DetectedFieldInfo[] = [];
      for (const nf of newFields) {
        if (!matchedSelectors.has(nf.selector) && nf.label.length >= 3) {
          unmatchedFields.push(nf);
        }
      }
      // Also include ATS-detected but unmatched fields (no profileKey match)
      for (const f of fields) {
        if (f.profileKey === null && f.label && f.selector && !matchedSelectors.has(f.selector)) {
          const alreadyAdded = unmatchedFields.some((u) => u.selector === f.selector);
          if (!alreadyAdded) {
            const el = document.querySelector(f.selector) as HTMLElement || document.body;
            unmatchedFields.push({
              id: f.selector,
              selector: f.selector,
              label: f.label,
              tagName: el.tagName?.toLowerCase() || "input",
              inputType: (el as HTMLInputElement).type?.toLowerCase(),
              section: "",
              required: !!f.required,
              options: f.options,
              element: el,
            });
          }
        }
      }

      // Tier 2: Semantic match from saved answers for all unmatched fields
      if (unmatchedFields.length > 0) {
        const tier2Results = await Promise.allSettled(
          unmatchedFields.slice(0, 30).map((nf) => tier2Match(nf)),
        );
        for (const result of tier2Results) {
          if (result.status === "fulfilled" && result.value) {
            fillResults.set(result.value.fieldId, result.value);
          }
        }
      }

      // Tier 3: AI generation for remaining unmatched textarea/text fields
      const stillUnmatched = unmatchedFields.filter(
        (nf) => !fillResults.has(nf.selector) && nf.label.length >= 8,
      );
      if (stillUnmatched.length > 0) {
        const tier3Results = await Promise.allSettled(
          stillUnmatched.slice(0, 10).map((nf) => tier3Generate(nf, jobContext)),
        );
        for (const result of tier3Results) {
          if (result.status === "fulfilled" && result.value) {
            fillResults.set(result.value.fieldId, result.value);
          }
        }
      }

      // Add ALL remaining unmatched fields as manual (tier: null) entries
      // so the side panel can show them and let the user fill manually
      const matchedAfterCascade = new Set(Array.from(fillResults.values()).map(r => r.selector));
      for (const nf of unmatchedFields) {
        if (!matchedAfterCascade.has(nf.selector)) {
          fillResults.set(nf.selector, {
            fieldId: nf.selector,
            label: nf.label,
            selector: nf.selector,
            tier: null as unknown as 1, // manual: requires user input
            confidence: "none" as "low",
            value: "",
            profileKey: null as unknown as string,
            autoFilled: false,
            element: nf.element || document.body,
            originalValue: "",
          });
        }
      }

      cachedFields = fields;
      cachedUnmatchedFields = unmatchedFields;
      overlayActive = true;

      // Notify side panel: ATS detected first (fast signal)
      chrome.runtime.sendMessage({
        type: "JOB_PAGE_DETECTED",
        payload: {
          ats: plat,
          company: document.title.replace(/ - .*/, "").trim(),
          url: window.location.href,
          fieldCount: totalFieldCount,
        },
      }).catch(() => {});

      // Then send ALL fields (including manual) now that T2/T3 are complete
      broadcastFieldsScanned(plat, fields, totalFieldCount);

      // For generic handler, run AI classification async to enrich Tier 1 matches
      if (useAI && cachedProfile) {
        detectFieldsWithAI(document, cachedProfile).then((aiFields) => {
          if (cachedProfile) {
            const aiFillable = aiFields.filter((f) => f.profileKey !== null);
            if (aiFillable.length > 0) {
              // Add newly matched fields to Tier 1 results
              for (const af of aiFillable) {
                if (!fillResults.has(af.selector || `field-${af.label}`)) {
                  const value = getProfileValue(cachedProfile!, af.profileKey!);
                  if (value) {
                    fillResults.set(af.selector || `field-${af.label}`, {
                      fieldId: af.selector || `field-${af.label}`,
                      label: af.label,
                      selector: af.selector || "",
                      tier: 1,
                      confidence: "high",
                      value,
                      profileKey: af.profileKey!,
                      autoFilled: true,
                      element: document.querySelector(af.selector) as HTMLElement || document.body,
                      originalValue: "",
                    });
                  }
                }
              }
              cachedFields = aiFields;
              // Re-broadcast updated fields to panel
              broadcastFieldsScanned(plat, aiFields, Math.max(totalFieldCount, aiFields.length));
            }
          }
        }).catch(() => {});
      }

      // Setup answer capture on form submit
      captureCleanup = setupFormSubmitCapture(fillResults, plat);

      // Watch for DOM changes (new fields appearing)
      if (plat !== "workday") {
        startPageObserver(() => {
          if (!overlayActive || !cachedProfile) return;
          const refreshed = handler.detectFields(document, cachedProfile);
          if (refreshed.length !== cachedFields.length) {
            cachedFields = refreshed;
          }
        });
      }
      } catch (err) {
        console.error("[Vetidia] Content script error:", err);
      }
    }

    /** Serialize all detected fields (including manual) and send to background→side panel */
    function broadcastFieldsScanned(plat: string, detectedFields: DetectedField[], totalFieldCount: number) {
      // Merge fill results with original detected field metadata for type/options info
      const fieldMetaMap = new Map<string, DetectedField>(
        detectedFields.map(f => [f.selector, f]),
      );

      // Also build a map from universal detector fields for metadata fallback
      const universalMetaMap = new Map<string, DetectedFieldInfo>(
        cachedUnmatchedFields.map(f => [f.selector, f]),
      );

      const allFields = Array.from(fillResults.values()).map((r) => {
        const meta = fieldMetaMap.get(r.selector);
        const uniMeta = universalMetaMap.get(r.selector);
        // Map universal detector fieldType to messaging fieldType
        const uniFieldType = uniMeta?.fieldType === "select" ? "select"
          : uniMeta?.fieldType === "checkbox" ? "checkbox"
          : uniMeta?.fieldType === "radio" ? "radio-group"
          : uniMeta?.fieldType === "textarea" ? "input"
          : "input";
        return {
          id: r.fieldId,
          label: r.label,
          tier: r.tier ?? null,
          confidence: r.confidence,
          value: r.value || null,
          selector: r.selector,
          fieldType: meta?.fieldType || (meta?.type === "file" ? "file" : uniFieldType),
          options: meta?.options || uniMeta?.options,
          checked: meta?.checked ?? uniMeta?.checked,
          radioGroupName: meta?.radioGroupName || uniMeta?.radioGroupName,
          required: meta?.required ?? uniMeta?.required ?? false,
        };
      });

      chrome.runtime.sendMessage({
        type: "FIELDS_SCANNED",
        payload: {
          ats: plat,
          fields: allFields,
          totalFieldCount,
        },
      }).catch(() => {});
    }

    async function executeFill(
      plat: string,
      handler: ReturnType<typeof getATSHandler>,
      fields: DetectedField[],
    ) {
      if (!cachedProfile || !handler) return;

      try {
      // Apply Tier 1 fills via existing handler
      const fillRequests: FieldFillRequest[] = fields
        .filter((f) => f.profileKey !== null)
        .map((f) => ({
          profileKey: f.profileKey!,
          value: getProfileValue(cachedProfile!, f.profileKey!) || "",
          selector: f.selector,
          confidence: f.confidence || "high",
          fieldType: (f.fieldType || "input") as FieldFillRequest["fieldType"],
          checked: f.checked,
          radioGroupName: f.radioGroupName,
        }));

      const filledCount = await handler.fillFields(document, fillRequests);

      // Apply Tier 2 + Tier 3 fills
      let tier23Filled = 0;
      for (const [, result] of fillResults) {
        if ((result.tier === 2 || result.tier === 3) && result.value) {
          const success = applyFill(result);
          if (success) {
            tier23Filled++;
            // Send learning signal for vault-matched answers
            if (result.tier === 2 && result.autoFilled) {
              chrome.runtime.sendMessage({
                type: "UPDATE_LEARNING",
                answerId: result.fieldId,
                action: "accepted",
              }).catch(() => {});
            }
          }
        }
      }

      const totalFilled = filledCount + tier23Filled;

      // Log submission
      chrome.runtime.sendMessage({
        type: "LOG_SUBMISSION",
        atsType: plat,
        pageUrl: window.location.href,
        fieldsAttempted: fields.length + Array.from(fillResults.values()).filter((r) => r.tier >= 2).length,
        fieldsFilled: totalFilled,
        fieldsSkipped: 0,
        fieldDetails: Array.from(fillResults.values()).map((r) => ({
          label: r.label, tier: r.tier, confidence: r.confidence,
        })),
      }).catch(() => {});

      // Broadcast state to Side Panel
      broadcastFillState(plat, fillResults, totalFilled, fields.length);
      } catch (err) {
        console.error("[Vetidia] Fill error:", err);
      }
    }

    function broadcastFillState(
      plat: string,
      results: Map<string, FieldFillResult>,
      filled: number,
      total: number,
    ) {
      const fields = Array.from(results.values()).map((r) => ({
        id: r.fieldId,
        label: r.label,
        type: r.profileKey || "text",
        section: guessSectionFromLabel(r.label),
        tier: r.tier as 1 | 2 | 3,
        confidence: r.confidence,
        value: r.value,
        original: r.originalValue || "",
        similarity: null,
        selector: r.selector,
      }));

      // Side panel expects data inside payload
      chrome.runtime.sendMessage({
        type: "FILL_STATE_UPDATE",
        payload: {
          status: "complete",
          fields,
          atsName: plat.toUpperCase(),
          company: document.title.split("|")[0]?.trim() || "",
          role: "",
          filledCount: filled,
          totalFillable: total,
        },
      }).catch(() => {});

      // Also send FILL_COMPLETE for the sample-compatible message protocol
      chrome.runtime.sendMessage({
        type: "FILL_COMPLETE",
        payload: {
          ats: plat,
          filledCount: filled,
          totalCount: total,
          results: fields.map((f) => ({ fieldId: f.id, success: !!f.value, tier: f.tier })),
        },
      }).catch(() => {});
    }

    function guessSectionFromLabel(label: string): string {
      const l = label.toLowerCase();
      if (/name|email|phone|address|city|state|zip|country|location/i.test(l)) return "Personal Info";
      if (/experience|company|title|role|years/i.test(l)) return "Experience";
      if (/education|degree|school|university|gpa/i.test(l)) return "Education";
      if (/gender|race|ethnicity|veteran|disability|eeo/i.test(l)) return "Demographics";
      if (/author|work|sponsor|visa|clearance|relocat/i.test(l)) return "Work Authorization";
      return "General";
    }

    /** Re-scan fields on the current page (used by Workday wizard observer). */
    async function rescanFields(plat: string) {
      if (!cachedHandler || !cachedProfile) return;
      const newFields = cachedHandler.detectFields(document, cachedProfile);
      const fillable = newFields.filter((f) => f.profileKey !== null);
      console.log(`[Vetidia] Rescan: ${newFields.length} total, ${fillable.length} fillable`);
      cachedFields = newFields;
      broadcastFieldsScanned(plat, newFields, newFields.length);
    }

    // Listen for messages from service worker / popup / side panel
    chrome.runtime.onMessage.addListener(
      (message: ContentMessage, _sender, sendResponse) => {
        // Handle messages that need access to fill state (closure vars)
        const msgType = (message as { type: string }).type;

        if (msgType === "GET_FILL_STATE") {
          const fields = Array.from(fillResults.values()).map((r) => ({
            id: r.fieldId,
            label: r.label,
            type: r.profileKey || "text",
            section: guessSectionFromLabel(r.label),
            tier: r.tier as 1 | 2 | 3,
            confidence: r.confidence,
            value: r.value,
            original: r.originalValue || "",
            similarity: null,
            selector: r.selector,
          }));
          const plat = detectATS(window.location.href, document) || "";
          sendResponse({
            status: fillResults.size > 0 ? "complete" : "idle",
            fields,
            atsName: plat.toUpperCase(),
            company: document.title.split("|")[0]?.trim() || "",
            role: "",
            filledCount: fields.filter((f) => f.value).length,
            totalFillable: fields.length,
          });
          return true;
        }

        if (msgType === "UPDATE_FIELD_VALUE" || msgType === "UPDATE_FIELD") {
          const msg = message as { type: string; fieldId?: string; newValue?: string; selector?: string; payload?: { fieldId: string; value: string } };
          const fieldId = msg.fieldId || msg.payload?.fieldId || "";
          const newValue = msg.newValue || msg.payload?.value || "";
          const storedResult = fillResults.get(fieldId);
          const targetSelector = msg.selector || storedResult?.selector || "";
          const el = targetSelector ? document.querySelector(targetSelector) as HTMLInputElement | HTMLTextAreaElement : null;
          if (el) {
            const nativeSet = Object.getOwnPropertyDescriptor(
              el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
              "value",
            )?.set;
            if (nativeSet) nativeSet.call(el, newValue);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }
          sendResponse({ success: !!el });
          return true;
        }

        if (msgType === "RESCAN_FIELDS") {
          const plat = detectATS(window.location.href, document);
          if (plat) {
            // If widget was never initialized, do a full init
            if (!overlayActive) {
              initWidget(plat).then(() => sendResponse({ success: true })).catch(() => sendResponse({ success: false }));
            } else {
              rescanFields(plat).then(() => sendResponse({ success: true })).catch(() => sendResponse({ success: false }));
            }
          } else {
            sendResponse({ success: false, error: "No ATS detected" });
          }
          return true;
        }

        // Fill fields from side panel with edited values (selector-based)
        if (msgType === "PANEL_FILL_FIELDS") {
          const msg = message as { type: string; payload: { fields: Array<{ selector: string; value: string; fieldType?: string; checked?: boolean; radioGroupName?: string }> } };
          const plat = detectATS(window.location.href, document) || "generic";
          const handler = getATSHandler(plat as Parameters<typeof getATSHandler>[0]) ?? genericHandler;
          const fillReqs: FieldFillRequest[] = msg.payload.fields.map(f => ({
            profileKey: "",
            value: f.value,
            selector: f.selector,
            confidence: "high",
            fieldType: (f.fieldType || "input") as FieldFillRequest["fieldType"],
            checked: f.checked,
            radioGroupName: f.radioGroupName,
          }));
          handler.fillFields(document, fillReqs).then(filled => {
            // Broadcast completion
            chrome.runtime.sendMessage({
              type: "FILL_COMPLETE",
              payload: { ats: plat, filledCount: filled, totalCount: msg.payload.fields.length, results: [] },
            }).catch(() => {});
            sendResponse({ success: true, filled });
          }).catch(err => sendResponse({ success: false, error: err.message }));
          return true;
        }

        // Upload resume/cover letter to file input
        if (msgType === "TRIGGER_FILE_UPLOAD") {
          const msg = message as { type: string; payload: { fileUrl: string; fileName: string; inputType: "resume" | "cover_letter" } };
          const selectors = msg.payload.inputType === "resume"
            ? ['#resume', 'input[name="resume"]', 'input[type="file"][name*="resume" i]', 'input[type="file"]']
            : ['#cover_letter', 'input[name="cover_letter"]', 'input[type="file"][name*="cover" i]', 'input[type="file"]'];
          let input: HTMLInputElement | null = null;
          for (const sel of selectors) {
            input = document.querySelector<HTMLInputElement>(sel);
            if (input) break;
          }
          if (!input) {
            sendResponse({ success: false, error: "No file input found" });
            return true;
          }
          uploadFileToInput(input, msg.payload.fileUrl, msg.payload.fileName)
            .then(success => sendResponse({ success }))
            .catch(err => sendResponse({ success: false, error: err.message }));
          return true;
        }

        // Delegate other messages to the static handler
        handleContentMessage(message)
          .then(sendResponse)
          .catch((err) => sendResponse({ error: err.message }));
        return true;
      },
    );

    // Notify the service worker that we're on an ATS page
    if (platform) {
      chrome.runtime.sendMessage({
        type: "ATS_PAGE_DETECTED",
        payload: { platform, url: window.location.href },
      });
    }
  },
});

function getProfileValue(profile: UserProfile, key: string): string | null {
  if (key.startsWith("_vault_")) return null; // Vault values are handled differently
  const val = (profile as Record<string, unknown>)[key];
  if (val && typeof val === "string") return val;
  return null;
}

async function handleContentMessage(
  message: ContentMessage,
): Promise<unknown> {
  switch (message.type) {
    case "DETECT_ATS": {
      const platform = detectATS(window.location.href, document);
      const isApp = isApplicationPage(window.location.href, document);

      let fields: DetectedField[] = [];
      if (platform && isApp) {
        const handler = getATSHandler(platform) ?? genericHandler;
        const profileResponse = await chrome.runtime.sendMessage({
          type: "GET_PROFILE",
        });
        const profile = profileResponse?.profile as UserProfile | null;
        if (profile) {
          fields = handler.detectFields(document, profile);
        }
      }

      const result: ATSDetectionResult = {
        platform,
        url: window.location.href,
        fields,
        isApplicationPage: isApp,
      };
      return result;
    }

    case "FILL_FIELDS": {
      const platform = detectATS(window.location.href, document);
      if (!platform) return { filled: 0, error: "No ATS detected" };

      const handler = getATSHandler(platform) ?? genericHandler;
      const filled = await handler.fillFields(document, message.payload.fields);

      // Log submission for audit
      try {
        const fieldDetails = message.payload.fields.map((f: FieldFillRequest) => ({
          profileKey: f.profileKey,
          confidence: f.confidence,
          filled: true,
          source: "profile",
        }));

        chrome.runtime.sendMessage({
          type: "LOG_SUBMISSION",
          atsType: platform,
          pageUrl: window.location.href,
          fieldsAttempted: message.payload.fields.length,
          fieldsFilled: filled,
          fieldsSkipped: message.payload.fields.length - filled,
          fieldDetails,
        }).catch(() => { /* non-critical */ });
      } catch {
        // Non-critical
      }

      return { filled };
    }

    case "GET_FILL_PREVIEW": {
      const platform = detectATS(window.location.href, document);
      if (!platform) return { fields: [], platform: null };

      const handler = getATSHandler(platform) ?? genericHandler;

      const profileResponse = await chrome.runtime.sendMessage({
        type: "GET_PROFILE",
      });
      const profile = profileResponse?.profile as UserProfile | null;
      if (!profile) return { fields: [], platform, error: "Not authenticated" };

      const fields = handler.detectFields(document, profile);
      return { fields, platform };
    }

    default:
      return { error: `Unknown content message type` };
  }
}

/**
 * Extract job context from the current page for AI answer generation.
 * Gathers: company name, job title, and key job description text.
 */
function extractJobContext(doc: Document, ats: string): string {
  const parts: string[] = [];

  // Extract company name from ATS-specific patterns
  const companySelectors: Record<string, string[]> = {
    greenhouse: [".company-name", "[class*='company']", ".logo-container a", 'meta[property="og:site_name"]'],
    lever: [".posting-headline .posting-categories .sort-by-team", ".main-header-logo a", ".posting-apply .posting-header .posting-categories span"],
    ashby: [".ashby-job-posting-brief-location", "[class*='CompanyName']"],
    workday: [".css-ey4dso", "[data-automation-id='company']"],
    generic: [],
  };

  // Try ATS-specific selectors first
  const selectors = companySelectors[ats] || [];
  let companyName = "";
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el) {
      if (sel.startsWith("meta")) {
        companyName = (el as HTMLMetaElement).content || "";
      } else {
        companyName = el.textContent?.trim() || "";
      }
      if (companyName) break;
    }
  }

  // Fallback: og:site_name meta tag or document title
  if (!companyName) {
    const ogSite = doc.querySelector('meta[property="og:site_name"]');
    if (ogSite) companyName = (ogSite as HTMLMetaElement).content || "";
  }
  if (!companyName) {
    // Try to extract from title like "Job Title - Company Name"
    const title = doc.title;
    const parts2 = title.split(/\s[-–|]\s/);
    if (parts2.length >= 2) companyName = parts2[parts2.length - 1].trim();
  }
  if (companyName) parts.push(`Company: ${companyName}`);

  // Extract job title
  let jobTitle = "";
  const titleSelectors = [
    "h1", ".posting-headline h2", ".job-title", "[class*='job-title']",
    "[class*='jobTitle']", "[data-automation-id='jobTitle']",
    'meta[property="og:title"]',
  ];
  for (const sel of titleSelectors) {
    const el = doc.querySelector(sel);
    if (el) {
      if (sel.startsWith("meta")) {
        jobTitle = (el as HTMLMetaElement).content || "";
      } else {
        jobTitle = el.textContent?.trim() || "";
      }
      if (jobTitle && jobTitle.length > 3 && jobTitle.length < 200) break;
      jobTitle = "";
    }
  }
  if (jobTitle) parts.push(`Job Title: ${jobTitle}`);

  // Extract job description (truncated for token efficiency)
  const descSelectors = [
    "#content", ".content", ".job-description", "[class*='job-description']",
    "[class*='jobDescription']", ".posting-page .content",
    "[data-automation-id='jobDescription']", ".section-wrapper",
    "#job-description", ".description", ".job-details",
  ];
  let descText = "";
  for (const sel of descSelectors) {
    const el = doc.querySelector(sel);
    if (el) {
      descText = el.textContent?.replace(/\s+/g, " ")?.trim() || "";
      if (descText.length > 100) break;
      descText = "";
    }
  }
  if (descText) {
    // Limit to ~1500 chars for token efficiency
    const truncated = descText.length > 1500 ? descText.slice(0, 1500) + "…" : descText;
    parts.push(`Job Description:\n${truncated}`);
  }

  return parts.join("\n");
}
