/**
 * Vetidia Extension — Design Tokens
 * Shared across popup, side panel, and floating overlay.
 * Matches vetidia_extension_mockup.jsx exactly.
 */

// ── Colors ──
export const EM = "oklch(0.7678 0.1655 162.1890)"; // Emerald primary
export const EM_DIM = "oklch(0.55 0.12 162)";
export const AMBER = "oklch(0.78 0.16 80)";
export const BLUE = "oklch(0.7 0.15 250)";
export const PURPLE = "oklch(0.72 0.16 300)";
export const RED = "oklch(0.65 0.2 25)";

// ── Surfaces ──
export const BASE = "#0e0e0e";
export const SIDE = "#0f0f0f";
export const PANEL = "#111111";
export const CARD = "#141414";
export const BRD = "rgba(255,255,255,0.07)";
export const BRD_L = "rgba(255,255,255,0.12)";

// ── Text ──
export const TX = "rgba(255,255,255,0.88)";
export const TX2 = "rgba(255,255,255,0.55)";
export const TX3 = "rgba(255,255,255,0.35)";
export const TX4 = "rgba(255,255,255,0.22)";

// ── Fonts ──
export const MONO = "ui-monospace,'Cascadia Code','Source Code Pro',Menlo,monospace";
export const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif";

// ── Confidence System ──
export type ConfidenceLevel = "high" | "medium" | "low" | "none";
export type TierLevel = 1 | 2 | 3;

export const CONF: Record<ConfidenceLevel, {
  bg: string;
  border: string;
  label: string;
  icon: string;
  barBg: string;
}> = {
  high: { bg: EM, border: EM, label: "Auto-filled", icon: "✓", barBg: `color-mix(in srgb, ${EM} 14%, transparent)` },
  medium: { bg: BLUE, border: BLUE, label: "Matched", icon: "≈", barBg: `color-mix(in srgb, ${BLUE} 14%, transparent)` },
  low: { bg: AMBER, border: AMBER, label: "AI Draft", icon: "✦", barBg: `color-mix(in srgb, ${AMBER} 14%, transparent)` },
  none: { bg: RED, border: RED, label: "Manual", icon: "•", barBg: `color-mix(in srgb, ${RED} 14%, transparent)` },
};

export const TIER_COLORS: Record<TierLevel, string> = {
  1: EM,
  2: BLUE,
  3: AMBER,
};

export const TIER_LABELS: Record<TierLevel, string> = {
  1: "Exact Match",
  2: "Semantic Match",
  3: "AI Generated",
};

// ── Animation Helpers ──
export const stagger = (i: number, base = 50) => Math.min(i * base, 600);

export const enterStyle = (show: boolean, i = 0, base = 50): React.CSSProperties => ({
  opacity: show ? 1 : 0,
  transform: show ? "translateY(0)" : "translateY(8px)",
  transition: `opacity 0.4s ease ${stagger(i, base)}ms, transform 0.4s ease ${stagger(i, base)}ms`,
});
