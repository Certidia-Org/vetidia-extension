/**
 * Vetidia Extension — Content Script
 *
 * Runs on every ATS domain. Two-phase design:
 *   Phase 1 (instant, no auth): Detect ATS → extract page context → notify side panel
 *   Phase 2 (requires auth):    Load profile → scan fields → run tier cascade → notify side panel
 *
 * The side panel always knows what page you're on. Auth only gates filling.
 */
import { detectATS, getATSDisplayName, extractPageContext, countFormFields } from "@/ats/detector";
import { getATSHandler } from "@/ats";
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
    "https://*.greenhouse.io/*",
    "https://boards.greenhouse.io/*",
    "https://job-boards.greenhouse.io/*",
    "https://*.lever.co/*",
    "https://*.myworkdayjobs.com/*",
    "https://*.myworkdaysite.com/*",
    "https://*.icims.com/*",
    "https://*.ashbyhq.com/*",
    "https://*.smartrecruiters.com/*",
    "https://*.linkedin.com/jobs/*",
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
    try {
      console.log("[Vetidia] Content script loaded on:", window.location.href);

      // ── State ──
      let initialized = false;
      let scanning = false;
      let cachedProfile: UserProfile | null = null;
      let cachedHandler: ReturnType<typeof getATSHandler> = null;
      let cachedFields: DetectedField[] = [];
      let cachedUnmatchedFields: DetectedFieldInfo[] = [];
      const fillResults = new Map<string, FieldFillResult>();
      let captureCleanup: (() => void) | null = null;

      // ═══════════════════════════════════════════════════════
      // PHASE 1: Detect ATS + notify side panel (instant, no auth)
      // ═══════════════════════════════════════════════════════

      const platform = detectATS(window.location.href, document);
      if (!platform) {
        console.log("[Vetidia] Not an ATS page, exiting");
        return;
      }

      const pageContext = extractPageContext(window.location.href, document);
      const fieldCount = countFormFields(document);

      console.log(`[Vetidia] Detected: ${platform} — ${pageContext.company} (${fieldCount} fields)`);

      // Tell the side panel immediately — no auth required
      chrome.runtime.sendMessage({
        type: "JOB_PAGE_DETECTED",
        payload: {
          ats: platform,
          atsDisplayName: getATSDisplayName(platform),
          company: pageContext.company,
          jobTitle: pageContext.jobTitle,
          url: window.location.href,
          fieldCount,
        },
      }).catch(() => {});

      // Also set the badge
      chrome.runtime.sendMessage({
        type: "ATS_PAGE_DETECTED",
        payload: {
          ats: platform,
          atsDisplayName: getATSDisplayName(platform),
          company: pageContext.company,
          jobTitle: pageContext.jobTitle,
          url: window.location.href,
          fieldCount,
        },
      }).catch(() => {});

      // ═══════════════════════════════════════════════════════
      // PHASE 2: Scan fields (requires auth — triggered automatically or on demand)
      // ═══════════════════════════════════════════════════════

      // Auto-scan after a short delay (lets React forms render)
      const scanDelay = platform === "workday" ? 2000 : 800;
      setTimeout(() => {
        if (!initialized) scanFields(platform);
      }, scanDelay);

      // Workday multi-page wizard: rescan on DOM changes
      if (platform === "workday") {
        startPageObserver(() => {
          if (initialized && platform) scanFields(platform);
        }, document.body, 800);
      }

      // Watch for SPA navigation (Lever, LinkedIn)
      watchUrlChanges((newUrl) => {
        const newPlatform = detectATS(newUrl, document);
        if (newPlatform) {
          // Re-run phase 1 for new page
          const ctx = extractPageContext(newUrl, document);
          const count = countFormFields(document);
          chrome.runtime.sendMessage({
            type: "JOB_PAGE_DETECTED",
            payload: {
              ats: newPlatform,
              atsDisplayName: getATSDisplayName(newPlatform),
              company: ctx.company,
              jobTitle: ctx.jobTitle,
              url: newUrl,
              fieldCount: count,
            },
          }).catch(() => {});
          // Re-scan fields
          initialized = false;
          fillResults.clear();
          setTimeout(() => scanFields(newPlatform), 800);
        }
      });

      // LinkedIn: watch for Easy Apply modal appearance
      if (platform === "linkedin") {
        const observer = new MutationObserver(() => {
          if (document.querySelector(".jobs-easy-apply-modal, .jobs-easy-apply-content")) {
            observer.disconnect();
            const count = countFormFields(document);
            chrome.runtime.sendMessage({
              type: "JOB_PAGE_DETECTED",
              payload: {
                ats: "linkedin",
                atsDisplayName: "LinkedIn",
                company: pageContext.company,
                jobTitle: pageContext.jobTitle,
                url: window.location.href,
                fieldCount: count,
              },
            }).catch(() => {});
            scanFields("linkedin");
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }

      // ── Core scan function ──

      async function scanFields(plat: string) {
        if (scanning) return;
        scanning = true;

        try {
          // Notify side panel: scanning started
          chrome.runtime.sendMessage({
            type: "SCAN_STATUS",
            payload: { status: "scanning", step: "Loading profile..." },
          }).catch(() => {});

          // Get profile (requires auth)
          try {
            const resp = await chrome.runtime.sendMessage({ type: "GET_CACHED_PROFILE" });
            cachedProfile = resp?.profile ?? null;
          } catch {
            cachedProfile = null;
          }

          if (!cachedProfile) {
            // Not authenticated — tell side panel
            chrome.runtime.sendMessage({
              type: "SCAN_STATUS",
              payload: { status: "needs_auth" },
            }).catch(() => {});
            scanning = false;
            return;
          }

          chrome.runtime.sendMessage({
            type: "SCAN_STATUS",
            payload: { status: "scanning", step: "Detecting fields..." },
          }).catch(() => {});

          const specificHandler = getATSHandler(plat as Parameters<typeof getATSHandler>[0]);
          const handler = specificHandler ?? genericHandler;
          cachedHandler = handler;

          // Extract job context for AI generation
          const jobContext = extractJobContext(document, plat);

          // Detect fields using ATS handler (Tier 1 mapping)
          let fields = handler.detectFields(document, cachedProfile);

          // Also detect with universal detector for fields ATS handler missed
          const newFields = detectFieldsNew(document);
          const allDetectedSelectors = new Set([
            ...fields.map((f) => f.selector),
            ...newFields.map((f) => f.selector),
          ]);
          const totalFieldCount = allDetectedSelectors.size;

          if (fields.length === 0 && newFields.length === 0) {
            chrome.runtime.sendMessage({
              type: "SCAN_STATUS",
              payload: { status: "no_fields" },
            }).catch(() => {});
            scanning = false;
            initialized = true;
            return;
          }

          // ── Tier cascade ──
          fillResults.clear();

          chrome.runtime.sendMessage({
            type: "SCAN_STATUS",
            payload: { status: "scanning", step: `Matching ${totalFieldCount} fields...` },
          }).catch(() => {});

          // Tier 1: Direct profile match
          for (const f of fields) {
            if (f.profileKey) {
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
                  element: (document.querySelector(f.selector) as HTMLElement) || document.body,
                  originalValue: "",
                });
              }
            }
          }

          // Gather unmatched fields
          const matchedSelectors = new Set(
            Array.from(fillResults.values()).map((r) => r.selector),
          );
          const unmatchedFields: DetectedFieldInfo[] = [];
          for (const nf of newFields) {
            if (!matchedSelectors.has(nf.selector) && nf.label.length >= 3) {
              unmatchedFields.push(nf);
            }
          }
          for (const f of fields) {
            if (f.profileKey === null && f.label && f.selector && !matchedSelectors.has(f.selector)) {
              const alreadyAdded = unmatchedFields.some((u) => u.selector === f.selector);
              if (!alreadyAdded) {
                const el = (document.querySelector(f.selector) as HTMLElement) || document.body;
                unmatchedFields.push({
                  id: f.selector,
                  selector: f.selector,
                  label: f.label,
                  tagName: el.tagName?.toLowerCase() || "input",
                  inputType: (el as HTMLInputElement).type?.toLowerCase(),
                  section: "",
                  required: !f.required,
                  options: f.options,
                  element: el,
                });
              }
            }
          }

          // Tier 2: Semantic match from answer vault (batched)
          if (unmatchedFields.length > 0) {
            chrome.runtime.sendMessage({
              type: "SCAN_STATUS",
              payload: { status: "scanning", step: "Checking answer vault..." },
            }).catch(() => {});

            const tier2Results = await batchedPromises(
              unmatchedFields.slice(0, 30),
              (nf) => tier2Match(nf),
              5,
            );
            for (const result of tier2Results) {
              if (result.status === "fulfilled" && result.value) {
                fillResults.set(result.value.fieldId, result.value);
              }
            }
          }

          // Tier 3: AI generation for remaining text fields (batched)
          const stillUnmatched = unmatchedFields.filter(
            (nf) => !fillResults.has(nf.selector) && nf.label.length >= 8,
          );
          if (stillUnmatched.length > 0) {
            chrome.runtime.sendMessage({
              type: "SCAN_STATUS",
              payload: { status: "scanning", step: "Generating answers..." },
            }).catch(() => {});

            const tier3Results = await batchedPromises(
              stillUnmatched.slice(0, 10),
              (nf) => tier3Generate(nf, jobContext),
              3,
            );
            for (const result of tier3Results) {
              if (result.status === "fulfilled" && result.value) {
                fillResults.set(result.value.fieldId, result.value);
              }
            }
          }

          // Add remaining unmatched as manual entries
          const matchedAfterCascade = new Set(
            Array.from(fillResults.values()).map((r) => r.selector),
          );
          for (const nf of unmatchedFields) {
            if (!matchedAfterCascade.has(nf.selector)) {
              fillResults.set(nf.selector, {
                fieldId: nf.selector,
                label: nf.label,
                selector: nf.selector,
                tier: null as unknown as 1,
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
          initialized = true;

          // Broadcast completed scan to side panel
          broadcastFieldsScanned(plat, fields, totalFieldCount);

          // Also run AI field detection in background for generic handler
          if (!specificHandler && newFields.length > 0) {
            detectFieldsWithAI(newFields.slice(0, 30)).then((aiFields) => {
              if (aiFields && aiFields.length > 0 && cachedProfile) {
                for (const af of aiFields) {
                  if (af.profileKey && !fillResults.has(af.selector || `field-${af.label}`)) {
                    const value = getProfileValue(cachedProfile!, af.profileKey);
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
                        element: (document.querySelector(af.selector) as HTMLElement) || document.body,
                        originalValue: "",
                      });
                    }
                  }
                }
                cachedFields = aiFields;
                broadcastFieldsScanned(plat, aiFields, Math.max(totalFieldCount, aiFields.length));
              }
            }).catch(() => {});
          }

          // Setup answer capture on form submit
          captureCleanup = setupFormSubmitCapture(fillResults, plat);

          // Watch for new fields appearing (except Workday which has its own observer)
          if (plat !== "workday") {
            startPageObserver(() => {
              if (!initialized || !cachedProfile) return;
              const refreshed = handler.detectFields(document, cachedProfile);
              if (refreshed.length !== cachedFields.length) {
                cachedFields = refreshed;
              }
            });
          }

          chrome.runtime.sendMessage({
            type: "SCAN_STATUS",
            payload: { status: "complete" },
          }).catch(() => {});

          // Auto-track this job in the web app
          chrome.runtime.sendMessage({
            type: "TRACK_JOB",
            payload: {
              company: pageContext.company,
              jobTitle: pageContext.jobTitle,
              url: window.location.href,
              atsPlatform: plat,
              appliedVia: "extension",
            },
          }).catch(() => {});
        } catch (err) {
          console.error("[Vetidia] Field scan error:", err);
          chrome.runtime.sendMessage({
            type: "SCAN_STATUS",
            payload: { status: "error", error: String(err) },
          }).catch(() => {});
        } finally {
          scanning = false;
        }
      }

      // ── Broadcast field scan results to side panel ──

      function broadcastFieldsScanned(
        plat: string,
        detectedFields: DetectedField[],
        totalFieldCount: number,
      ) {
        const fieldMetaMap = new Map<string, DetectedField>(
          detectedFields.map((f) => [f.selector, f]),
        );
        const universalMetaMap = new Map<string, DetectedFieldInfo>(
          cachedUnmatchedFields.map((f) => [f.selector, f]),
        );

        const allFields = Array.from(fillResults.values()).map((r) => {
          const meta = fieldMetaMap.get(r.selector);
          const uniMeta = universalMetaMap.get(r.selector);
          const uniFieldType =
            uniMeta?.fieldType === "select" ? "select"
            : uniMeta?.fieldType === "checkbox" ? "checkbox"
            : uniMeta?.fieldType === "radio" ? "radio-group"
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
            checked: meta?.checked,
            radioGroupName: meta?.radioGroupName,
            required: meta?.required ?? uniMeta?.required ?? false,
          };
        });

        // Classify fields into status groups for the side panel
        const ready = allFields.filter((f) => f.tier === 1 && f.value).length;
        const suggested = allFields.filter((f) => (f.tier === 2 || f.tier === 3) && f.value).length;
        const manual = allFields.filter((f) => !f.value || f.tier === null).length;

        chrome.runtime.sendMessage({
          type: "FIELDS_SCANNED",
          payload: {
            ats: plat,
            fields: allFields,
            totalFieldCount: Math.max(totalFieldCount, allFields.length),
            ready,
            suggested,
            manual,
          },
        }).catch(() => {});
      }

      // ── Message listener ──

      chrome.runtime.onMessage.addListener(
        (message: Record<string, unknown>, _sender, sendResponse) => {
          const msgType = message.type as string;

          if (msgType === "RESCAN_FIELDS") {
            if (!platform) {
              // Try detecting again (page may have changed)
              const newPlat = detectATS(window.location.href, document);
              if (newPlat) {
                initialized = false;
                fillResults.clear();
                scanFields(newPlat).then(() => sendResponse({ success: true })).catch(() => sendResponse({ success: false }));
              } else {
                sendResponse({ success: false, error: "No ATS detected" });
              }
            } else {
              initialized = false;
              fillResults.clear();
              scanFields(platform).then(() => sendResponse({ success: true })).catch(() => sendResponse({ success: false }));
            }
            return true;
          }

          if (msgType === "UPDATE_FIELD") {
            const msg = message as { fieldId?: string; newValue?: string; selector?: string; payload?: { fieldId: string; value: string } };
            const fieldId = msg.fieldId || msg.payload?.fieldId || "";
            const newValue = msg.newValue || msg.payload?.value || "";
            const storedResult = fillResults.get(fieldId);
            const targetSelector = msg.selector || storedResult?.selector || "";
            const el = targetSelector ? (document.querySelector(targetSelector) as HTMLInputElement | HTMLTextAreaElement) : null;
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

          if (msgType === "PANEL_FILL_FIELDS") {
            const msg = message as {
              type: string;
              payload: {
                fields: Array<{
                  selector: string;
                  value: string;
                  fieldType?: string;
                  checked?: boolean;
                  radioGroupName?: string;
                }>;
              };
            };
            const plat = detectATS(window.location.href, document) || "generic";
            const handler = getATSHandler(plat as Parameters<typeof getATSHandler>[0]) ?? genericHandler;

            (async () => {
              let filledCount = 0;
              for (const field of msg.payload.fields) {
                try {
                  const el = document.querySelector(field.selector) as HTMLElement;
                  if (!el) continue;

                  if (field.fieldType === "select" || el.tagName === "SELECT") {
                    const select = el as HTMLSelectElement;
                    const option = Array.from(select.options).find(
                      (o) => o.value === field.value || o.textContent?.trim() === field.value,
                    );
                    if (option) {
                      select.value = option.value;
                      select.dispatchEvent(new Event("change", { bubbles: true }));
                      filledCount++;
                    }
                  } else if (field.fieldType === "checkbox") {
                    const input = el as HTMLInputElement;
                    if (input.checked !== field.checked) {
                      input.click();
                      filledCount++;
                    }
                  } else if (field.fieldType === "radio-group" && field.radioGroupName) {
                    const radios = document.querySelectorAll<HTMLInputElement>(
                      `input[type="radio"][name="${field.radioGroupName}"]`,
                    );
                    for (const radio of radios) {
                      if (radio.value === field.value || radio.labels?.[0]?.textContent?.trim() === field.value) {
                        radio.click();
                        filledCount++;
                        break;
                      }
                    }
                  } else {
                    const input = el as HTMLInputElement | HTMLTextAreaElement;
                    const nativeSet = Object.getOwnPropertyDescriptor(
                      el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
                      "value",
                    )?.set;
                    if (nativeSet) nativeSet.call(input, field.value);
                    input.dispatchEvent(new Event("focus", { bubbles: true }));
                    input.dispatchEvent(new Event("input", { bubbles: true }));
                    input.dispatchEvent(new Event("change", { bubbles: true }));
                    input.dispatchEvent(new Event("blur", { bubbles: true }));
                    filledCount++;
                  }
                } catch {
                  // Skip failed fields
                }
              }

              // Log submission
              try {
                chrome.runtime.sendMessage({
                  type: "LOG_SUBMISSION",
                  atsType: plat,
                  pageUrl: window.location.href,
                  fieldsAttempted: msg.payload.fields.length,
                  fieldsFilled: filledCount,
                  fieldsSkipped: msg.payload.fields.length - filledCount,
                  fieldDetails: msg.payload.fields.map((f) => ({
                    profileKey: f.selector,
                    confidence: "high",
                    filled: true,
                    source: "panel",
                  })),
                }).catch(() => {});
              } catch {}

              chrome.runtime.sendMessage({
                type: "FILL_COMPLETE",
                payload: {
                  filledCount,
                  total: msg.payload.fields.length,
                },
              }).catch(() => {});

              sendResponse({ filled: filledCount });
            })();
            return true;
          }

          if (msgType === "TRIGGER_FILE_UPLOAD") {
            const msg = message as {
              payload: { fileUrl: string; fileName: string; inputType: "resume" | "cover_letter" };
            };
            const selectors =
              msg.payload.inputType === "resume"
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
              .then((success) => sendResponse({ success }))
              .catch((err) => sendResponse({ success: false, error: err.message }));
            return true;
          }

          // Legacy message handlers
          if (msgType === "DETECT_ATS") {
            const plat = detectATS(window.location.href, document);
            const result: ATSDetectionResult = {
              platform: plat,
              url: window.location.href,
              fields: cachedFields,
              isApplicationPage: !!plat,
            };
            sendResponse(result);
            return true;
          }

          if (msgType === "GET_FILL_STATE") {
            sendResponse({
              fields: Array.from(fillResults.values()),
              status: scanning ? "scanning" : initialized ? "complete" : "idle",
            });
            return true;
          }

          sendResponse({ error: `Unknown message type: ${msgType}` });
          return true;
        },
      );
    } catch (err) {
      console.error("[Vetidia] Content script initialization failed:", err);
      // Fallback listener so side panel can still trigger a rescan
      try {
        chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
          if (msg.type === "RESCAN_FIELDS" || msg.type === "PANEL_FILL_FIELDS") {
            sendResponse({ error: "Content script failed to initialize. Try reloading the page." });
          }
          return true;
        });
      } catch { /* Extension context invalidated */ }
    }
  },
});

// ── Helpers ──

function getProfileValue(profile: UserProfile, key: string): string | null {
  if (key.startsWith("_vault_")) return null;
  const val = (profile as Record<string, unknown>)[key];
  if (typeof val === "string" && val.trim()) return val;
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (Array.isArray(val) && val.length > 0) return val.join(", ");
  return null;
}

function extractJobContext(doc: Document, platform: string): string {
  const parts: string[] = [];

  // Job title
  const h1 = doc.querySelector("h1");
  if (h1?.textContent) parts.push(`Job Title: ${h1.textContent.trim()}`);

  // Company name
  const title = doc.title || "";
  parts.push(`Page: ${title}`);

  // Job description — try common selectors
  const descSelectors = [
    ".job-description", ".job_description", "#job-description",
    '[class*="jobDescription"]', '[class*="job-description"]',
    ".posting-description", ".job-details", ".description",
    '[data-automation-id="jobDescription"]',
    ".content-intro", ".job-post-description",
  ];
  for (const sel of descSelectors) {
    const el = doc.querySelector(sel);
    if (el?.textContent && el.textContent.trim().length > 50) {
      parts.push(`Description: ${el.textContent.trim().slice(0, 2000)}`);
      break;
    }
  }

  return parts.join("\n\n");
}

async function batchedPromises<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}
