/**
 * Floating overlay — the main Vetidia presence on ATS pages.
 * Minimizable to 44px "V" icon. Expands to show ATS badge, field count,
 * tier breakdown bar, and fill button. Uses Shadow DOM for isolation.
 */

import { EM, BLUE, AMBER, BASE, PANEL, BRD, TX, TX2, TX3, TX4 } from "@/ui/tokens";
import type { FieldFillResult, FillTier } from "../filler/types";

export type OverlayState = "ready" | "filling" | "done" | "minimized";

interface OverlayConfig {
  platform: string;
  companyName?: string;
  fieldCount: number;
  fillResults: Map<string, FieldFillResult>;
  onFill: () => Promise<void>;
  onReviewAll: () => void;
}

let overlayHost: HTMLElement | null = null;
let overlayState: OverlayState = "ready";
let currentConfig: OverlayConfig | null = null;

export function showOverlay(config: OverlayConfig): void {
  currentConfig = config;
  overlayState = "ready";
  renderOverlay();
}

export function updateOverlay(config: Partial<OverlayConfig>): void {
  if (currentConfig) Object.assign(currentConfig, config);
  renderOverlay();
}

export function setOverlayState(state: OverlayState): void {
  overlayState = state;
  renderOverlay();
}

export function destroyOverlay(): void {
  overlayHost?.remove();
  overlayHost = null;
  currentConfig = null;
}

function renderOverlay(): void {
  if (!currentConfig) return;
  const config = currentConfig;

  // Create host if not exists
  if (!overlayHost) {
    overlayHost = document.createElement("vetidia-overlay");
    overlayHost.style.cssText = `
      position:fixed;bottom:24px;right:24px;z-index:2147483646;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    `;
    document.body.appendChild(overlayHost);
  }

  // Clear and rebuild
  const shadow = overlayHost.shadowRoot ?? overlayHost.attachShadow({ mode: "open" });
  shadow.innerHTML = "";

  const style = document.createElement("style");
  style.textContent = `
    *{box-sizing:border-box;margin:0;padding:0}
    @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
    @keyframes glow{0%,100%{box-shadow:0 0 12px ${EM}40}50%{box-shadow:0 0 24px ${EM}60}}
    .container{animation:fadeIn 0.3s ease}
    .minimized{
      width:44px;height:44px;border-radius:12px;
      background:linear-gradient(135deg, ${EM}, oklch(0.6 0.14 162));
      display:flex;align-items:center;justify-content:center;
      cursor:pointer;
      box-shadow:0 4px 24px rgba(0,0,0,0.3), 0 0 20px color-mix(in srgb, ${EM} 30%, transparent);
      transition:transform 0.2s;
    }
    .minimized:hover{transform:scale(1.08)}
    .minimized .v{font-size:18px;font-weight:700;color:#000;font-style:normal}
    .expanded{
      width:260px;border-radius:14px;overflow:hidden;
      background:${PANEL};border:1px solid ${BRD};
      box-shadow:0 8px 40px rgba(0,0,0,0.5);
    }
    .expanded-header{
      padding:10px 14px;display:flex;align-items:center;justify-content:space-between;
      border-bottom:1px solid ${BRD};
    }
    .expanded-body{padding:12px 14px}
    .header{display:none}
    .logo{display:flex;align-items:center;gap:8px}
    .logo .v-icon{
      width:22px;height:22px;border-radius:6px;
      background:linear-gradient(135deg, ${EM}, oklch(0.6 0.14 162));
      display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:700;color:#000;
    }
    .logo .name{font-size:12px;font-weight:600;color:${TX}}
    .minimize-btn{
      width:22px;height:22px;border-radius:4px;border:none;
      background:transparent;color:${TX4};cursor:pointer;font-size:14px;
      display:flex;align-items:center;justify-content:center;
    }
    .minimize-btn:hover{color:${TX2}}
    .ats-badge{
      display:inline-flex;align-items:center;gap:6px;
      margin-bottom:10px;
    }
    .ats-badge .ats-name{
      font-size:9px;font-weight:700;letter-spacing:0.04em;
      color:${EM};background:color-mix(in srgb, ${EM} 12%, transparent);
      padding:2px 6px;border-radius:3px;
    }
    .ats-badge .company{font-size:10px;color:${TX3}}
    .field-count{
      font-size:24px;font-weight:700;color:${TX};
      font-family:ui-monospace,SFMono-Regular,monospace;
      line-height:1;
    }
    .field-label{font-size:11px;color:${TX3};margin-bottom:10px}
    .tier-bar{display:flex;gap:3px;margin-bottom:12px}
    .tier-bar .t1{height:4px;border-radius:2px;background:${EM};opacity:0.8}
    .tier-bar .t2{height:4px;border-radius:2px;background:${BLUE};opacity:0.8}
    .tier-bar .t3{height:4px;border-radius:2px;background:${AMBER};opacity:0.8}
    .tier-bar .unfilled{height:4px;border-radius:2px;background:rgba(255,255,255,0.08)}
    .tier-legend{display:none}
    .fill-btn{
      width:100%;padding:10px;border-radius:8px;border:none;
      font-size:13px;font-weight:600;cursor:pointer;
      display:flex;align-items:center;justify-content:center;gap:6px;
      transition:all 0.2s;
    }
    .fill-btn.primary{background:${EM};color:#022c22}
    .fill-btn.primary:hover{filter:brightness(1.1)}
    .shimmer-track{
      height:4px;border-radius:2px;background:rgba(255,255,255,0.06);overflow:hidden;margin-bottom:6px;
    }
    .shimmer-fill{
      height:100%;border-radius:2px;width:100%;
      background:linear-gradient(90deg, ${EM}, ${BLUE}, ${EM});
      background-size:200% 100%;animation:shimmer 1.5s ease infinite;
    }
    .shimmer-label{font-size:10px;color:${TX3};text-align:center;margin-bottom:12px}
    .done-btns{display:flex;gap:6px}
    .done-btns .review{flex:1}
    .done-btns .rescan{flex:0}
    .review-btn{
      padding:8px 16px;border-radius:8px;border:none;
      background:${EM};color:#022c22;font-size:13px;font-weight:600;
      cursor:pointer;
    }
    .review-btn:hover{filter:brightness(1.1)}
    .rescan-btn{
      padding:8px 12px;border-radius:8px;border:1px solid ${BRD};
      background:transparent;color:${TX2};font-size:13px;
      cursor:pointer;
    }
    .rescan-btn:hover{background:${BASE}}
    .progress{font-size:12px;color:${TX2};text-align:center;margin-bottom:8px}
  `;
  shadow.appendChild(style);

  const container = document.createElement("div");
  container.className = "container";

  if (overlayState === "minimized") {
    container.innerHTML = `<div class="minimized"><span class="v">V</span></div>`;
    container.querySelector(".minimized")!.addEventListener("click", () => {
      overlayState = "ready";
      renderOverlay();
    });
  } else {
    const tierCounts = getTierCounts(config.fillResults);
    const filledCount = tierCounts.t1 + tierCounts.t2 + tierCounts.t3;
    const total = config.fieldCount || 1;
    const companyName = config.companyName || document.title.split("|")[0]?.split("-")[0]?.trim() || "";

    let html = `<div class="expanded">`;

    // Header (matching mockup exactly)
    html += `
      <div class="expanded-header">
        <div class="logo">
          <div class="v-icon">V</div>
          <span class="name">Vetidia</span>
        </div>
        <button class="minimize-btn">−</button>
      </div>
    `;

    // Body
    html += `<div class="expanded-body">`;

    // ATS badge + company
    html += `
      <div class="ats-badge">
        <span class="ats-name">${config.platform.toUpperCase()}</span>
        ${companyName ? `<span class="company">${companyName}</span>` : ""}
      </div>
    `;

    // Field stats
    if (overlayState === "done") {
      html += `
        <div style="display:flex;align-items:baseline;gap:4px;margin-bottom:10px">
          <span class="field-count" style="color:${EM}">${filledCount}</span>
          <span class="field-label" style="margin-bottom:0">of ${total} filled</span>
        </div>
      `;
    } else {
      html += `
        <div style="display:flex;align-items:baseline;gap:4px;margin-bottom:10px">
          <span class="field-count">${config.fieldCount}</span>
          <span class="field-label" style="margin-bottom:0">fields detected</span>
        </div>
      `;
    }

    // Tier breakdown bar (not shown during filling)
    if (overlayState !== "filling") {
      const pctFlex = (n: number) => Math.max(n, 0);
      html += `
        <div class="tier-bar">
          ${tierCounts.t1 > 0 ? `<div class="t1" style="flex:${pctFlex(tierCounts.t1)}" title="Tier 1: ${tierCounts.t1} fields"></div>` : ""}
          ${tierCounts.t2 > 0 ? `<div class="t2" style="flex:${pctFlex(tierCounts.t2)}" title="Tier 2: ${tierCounts.t2} fields"></div>` : ""}
          ${tierCounts.t3 > 0 ? `<div class="t3" style="flex:${pctFlex(tierCounts.t3)}" title="Tier 3: ${tierCounts.t3} fields"></div>` : ""}
          <div class="unfilled" style="flex:${pctFlex(total - filledCount)}" title="${total - filledCount} unfilled"></div>
        </div>
      `;
    }

    // Filling animation (shimmer bar)
    if (overlayState === "filling") {
      html += `
        <div class="shimmer-track"><div class="shimmer-fill"></div></div>
        <div class="shimmer-label">Analyzing fields and matching answers...</div>
      `;
    }

    // Action buttons
    if (overlayState === "ready") {
      html += `<button class="fill-btn primary">⚡ Fill ${filledCount > 0 ? filledCount : config.fieldCount} Fields</button>`;
    } else if (overlayState === "done") {
      html += `
        <div class="done-btns">
          <button class="review-btn review">Review All</button>
          <button class="rescan-btn rescan">↻</button>
        </div>
      `;
    }

    html += `</div></div>`; // close expanded-body and expanded

    container.innerHTML = html;

    // Event listeners
    container.querySelector(".minimize-btn")?.addEventListener("click", () => {
      overlayState = "minimized";
      renderOverlay();
    });

    container.querySelector(".fill-btn.primary")?.addEventListener("click", async () => {
      // Immediately show filling state for visual feedback
      overlayState = "filling";
      renderOverlay();
      await config.onFill();
    });

    container.querySelector(".review-btn")?.addEventListener("click", () => {
      config.onReviewAll();
    });

    container.querySelector(".rescan-btn")?.addEventListener("click", () => {
      overlayState = "ready";
      renderOverlay();
    });
  }

  shadow.appendChild(container);
}

function getTierCounts(results: Map<string, FieldFillResult>): { t1: number; t2: number; t3: number } {
  let t1 = 0, t2 = 0, t3 = 0;
  for (const [, r] of results) {
    if (r.tier === 1) t1++;
    else if (r.tier === 2) t2++;
    else if (r.tier === 3) t3++;
  }
  return { t1, t2, t3 };
}
