/**
 * Confidence badges — shown next to filled form fields.
 * Green (Tier 1 / promoted T2), Blue (Tier 2), Amber (Tier 3), Red (no match).
 * Uses Shadow DOM for style isolation.
 */

import type { FieldFillResult, FillTier } from "../filler/types";

const BADGE_COLORS: Record<FillTier, { bg: string; text: string; label: string }> = {
  1: { bg: "#34d399", text: "#022c22", label: "✓ Exact" },
  2: { bg: "#60a5fa", text: "#1e3a5f", label: "⚡ Matched" },
  3: { bg: "#fbbf24", text: "#451a03", label: "✦ AI Draft" },
};

const badgeElements = new Map<string, HTMLElement>();

export function showConfidenceBadge(result: FieldFillResult): void {
  try {
    removeBadge(result.fieldId);

    const el = result.element;
    if (!el.isConnected) return;

    const colors = BADGE_COLORS[result.tier];
    if (!colors) return;

    // Create badge container with Shadow DOM
    const host = document.createElement("vetidia-badge");
    host.setAttribute("data-field-id", result.fieldId);
    host.style.cssText = "position:absolute;z-index:2147483647;pointer-events:none;";

    const shadow = host.attachShadow({ mode: "closed" });
    const badge = document.createElement("span");
    badge.textContent = colors.label;
    badge.style.cssText = `
      display:inline-flex;align-items:center;gap:3px;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      font-size:10px;font-weight:600;letter-spacing:0.02em;
      padding:2px 6px;border-radius:4px;
      background:${colors.bg};color:${colors.text};
      white-space:nowrap;opacity:0;
      animation:fadeIn 0.3s ease forwards;
    `;

    // Add tooltip with similarity info
    if (result.similarity) {
      badge.title = `${Math.round(result.similarity * 100)}% match`;
    }

    const style = document.createElement("style");
    style.textContent = `@keyframes fadeIn{from{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:translateY(0)}}`;
    shadow.appendChild(style);
    shadow.appendChild(badge);

    // Position relative to the field
    const rect = el.getBoundingClientRect();
    host.style.top = `${window.scrollY + rect.top - 2}px`;
    host.style.left = `${window.scrollX + rect.right + 4}px`;

    document.body.appendChild(host);
    badgeElements.set(result.fieldId, host);
  } catch {
    // Never break the page
  }
}

export function removeBadge(fieldId: string): void {
  const existing = badgeElements.get(fieldId);
  if (existing) {
    existing.remove();
    badgeElements.delete(fieldId);
  }
}

export function removeAllBadges(): void {
  for (const [id] of badgeElements) {
    removeBadge(id);
  }
}

export function updateBadgePositions(): void {
  for (const [fieldId, host] of badgeElements) {
    const el = document.querySelector(`[data-vetidia-field-id="${fieldId}"]`) as HTMLElement;
    if (!el?.isConnected) {
      removeBadge(fieldId);
      continue;
    }
    const rect = el.getBoundingClientRect();
    host.style.top = `${window.scrollY + rect.top - 2}px`;
    host.style.left = `${window.scrollX + rect.right + 4}px`;
  }
}
