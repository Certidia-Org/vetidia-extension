/**
 * Vetidia Extension — Shared UI Components
 * Used by popup, side panel, and overlay.
 * Matches vetidia_extension_mockup.jsx exactly.
 */
import { useState, useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  EM, BLUE, AMBER, RED, TX, TX2, TX3, TX4,
  BRD, BRD_L, SANS, MONO, CONF,
  type ConfidenceLevel, type TierLevel,
  stagger,
} from "./tokens";

// ── Animation Hooks ──

export function useCountUp(target: number, duration = 700, delay = 0) {
  const [val, setVal] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !target) return;
    started.current = true;
    const timer = setTimeout(() => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        setVal(Math.round(ease * target));
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, delay);
    return () => clearTimeout(timer);
  }, [target, duration, delay]);
  return val;
}

export function useMountReveal(delay = 0) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return show;
}

// ── Button ──

type BtnVariant = "default" | "primary" | "ghost" | "danger";
type BtnSize = "sm" | "md" | "lg";

interface BtnProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  size?: BtnSize;
  disabled?: boolean;
  style?: CSSProperties;
}

export function Btn({ children, onClick, variant = "default", size = "md", disabled, style: sx }: BtnProps) {
  const [h, setH] = useState(false);
  const [p, setP] = useState(false);

  const base: CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    border: "none", cursor: disabled ? "default" : "pointer", fontFamily: SANS,
    borderRadius: 7, fontWeight: 500, opacity: disabled ? 0.4 : 1,
    transition: "all 0.15s cubic-bezier(0.4,0,0.2,1)",
    transform: p && !disabled ? "scale(0.97)" : h && !disabled ? "translateY(-1px)" : "none",
    filter: p && !disabled ? "brightness(0.92)" : h && !disabled ? "brightness(1.08)" : "none",
  };
  const sizes: Record<BtnSize, CSSProperties> = {
    sm: { padding: "5px 10px", fontSize: 11 },
    md: { padding: "7px 14px", fontSize: 12 },
    lg: { padding: "10px 20px", fontSize: 13 },
  };
  const variants: Record<BtnVariant, CSSProperties> = {
    default: { background: h ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)", color: TX2, border: `1px solid ${h ? BRD_L : BRD}` },
    primary: { background: h ? `color-mix(in oklch,${EM} 85%,white)` : EM, color: "#000", fontWeight: 600, boxShadow: h ? "0 2px 12px rgba(118,196,162,0.2)" : "none" },
    ghost: { background: h ? "rgba(255,255,255,0.06)" : "transparent", color: TX2, border: "none" },
    danger: { background: h ? "rgba(255,80,80,0.15)" : "rgba(255,80,80,0.08)", color: RED, border: `1px solid ${h ? "rgba(255,80,80,0.25)" : "rgba(255,80,80,0.12)"}` },
  };

  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => { setH(false); setP(false); }}
      onMouseDown={() => setP(true)}
      onMouseUp={() => setP(false)}
      style={{ ...base, ...sizes[size], ...variants[variant], ...(sx || {}) }}
    >
      {children}
    </button>
  );
}

// ── Chip ──

interface ChipProps {
  children: ReactNode;
  color?: string;
  active?: boolean;
  onClick?: () => void;
  size?: "sm" | "md";
}

export function Chip({ children, color = TX3, active, onClick, size = "sm" }: ChipProps) {
  const [h, setH] = useState(false);
  const interactive = !!onClick;
  return (
    <span
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: size === "sm" ? "3px 8px" : "4px 10px",
        fontSize: size === "sm" ? 10 : 11, fontWeight: 500, fontFamily: SANS, borderRadius: 4,
        whiteSpace: "nowrap",
        background: active ? `color-mix(in srgb,${color} 16%,transparent)` : h && interactive ? `color-mix(in srgb,${color} 10%,transparent)` : "rgba(255,255,255,0.04)",
        color: active ? color : h && interactive ? color : TX3,
        border: `1px solid ${active ? `color-mix(in srgb,${color} 25%,transparent)` : "rgba(255,255,255,0.06)"}`,
        cursor: interactive ? "pointer" : "default",
        transition: "all 0.12s",
      }}
    >
      {children}
    </span>
  );
}

// ── Section ──

interface SectionProps {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
}

export function Section({ title, right, children }: SectionProps) {
  const show = useMountReveal(20);
  return (
    <div style={{ marginBottom: 20, opacity: show ? 1 : 0, transform: show ? "translateY(0)" : "translateY(6px)", transition: "opacity 0.35s ease, transform 0.35s ease" }}>
      {(title || right) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          {title && <h3 style={{ fontSize: 10, fontWeight: 600, color: TX3, textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>{title}</h3>}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Card ──

interface CardProps {
  children: ReactNode;
  hover?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
  glow?: boolean;
}

export function Card({ children, hover, onClick, style: sx, glow }: CardProps) {
  const [h, setH] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        background: h && hover ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.015)",
        border: `1px solid ${glow ? `color-mix(in srgb,${EM} 20%,transparent)` : h && hover ? BRD_L : BRD}`,
        borderRadius: 10, padding: 14, cursor: onClick ? "pointer" : "default",
        transition: "all 0.2s cubic-bezier(0.4,0,0.2,1)",
        transform: h && hover ? "translateY(-1px)" : "none",
        boxShadow: h && hover ? "0 4px 16px rgba(0,0,0,0.2)" : "none",
        ...(sx || {}),
      }}
    >
      {children}
    </div>
  );
}

// ── ConfidenceBadge ──

interface ConfidenceBadgeProps {
  confidence: ConfidenceLevel;
  size?: "sm" | "lg";
}

export function ConfidenceBadge({ confidence, size = "sm" }: ConfidenceBadgeProps) {
  const c = CONF[confidence];
  const s = size === "lg" ? { fs: 11, px: 8, py: 3 } : { fs: 9, px: 6, py: 2 };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      padding: `${s.py}px ${s.px}px`, fontSize: s.fs, fontWeight: 600,
      fontFamily: SANS, borderRadius: 4, letterSpacing: "0.02em",
      background: c.barBg, color: c.bg,
      border: `1px solid color-mix(in srgb, ${c.border} 20%, transparent)`,
    }}>
      <span style={{ fontSize: s.fs + 1 }}>{c.icon}</span> {c.label}
    </span>
  );
}

// ── TierBadge ──

interface TierBadgeProps {
  tier: TierLevel;
}

export function TierBadge({ tier }: TierBadgeProps) {
  const colors: Record<number, string> = { 1: EM, 2: BLUE, 3: AMBER };
  const labels: Record<number, string> = { 1: "T1", 2: "T2", 3: "T3" };
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, fontFamily: MONO, color: colors[tier] || TX4,
      background: `color-mix(in srgb, ${colors[tier] || TX4} 12%, transparent)`,
      padding: "2px 5px", borderRadius: 3, letterSpacing: "0.04em",
    }}>
      {labels[tier] || "—"}
    </span>
  );
}

// ── StatBox ──

interface StatBoxProps {
  label: string;
  value: number | string;
  sub?: string;
  color?: string;
}

export function StatBox({ label, value, sub, color = TX }: StatBoxProps) {
  const animated = useCountUp(typeof value === "number" ? value : 0, 700, 100);
  const show = useMountReveal(80);
  return (
    <div style={{
      padding: "12px 14px", borderRadius: 8,
      background: "rgba(255,255,255,0.02)", border: `1px solid ${BRD}`,
      flex: 1, minWidth: 0,
      opacity: show ? 1 : 0, transform: show ? "translateY(0)" : "translateY(6px)",
      transition: "all 0.4s ease",
    }}>
      <div style={{ fontSize: 9, color: TX4, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: MONO, color, lineHeight: 1 }}>
        {typeof value === "number" ? animated : value}
        {sub && <span style={{ fontSize: 10, color: TX4, fontWeight: 400, marginLeft: 3, fontFamily: SANS }}>{sub}</span>}
      </div>
    </div>
  );
}

// ── SettingToggle ──

interface SettingToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

export function SettingToggle({ label, description, checked, onChange }: SettingToggleProps) {
  const [h, setH] = useState(false);
  return (
    <div
      onClick={() => onChange(!checked)}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        padding: "10px 12px", borderRadius: 8, cursor: "pointer",
        background: h ? "rgba(255,255,255,0.03)" : "transparent",
        transition: "background 0.15s",
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: TX }}>{label}</div>
        {description && <div style={{ fontSize: 10, color: TX4, marginTop: 2 }}>{description}</div>}
      </div>
      <div style={{
        width: 36, height: 20, borderRadius: 10, padding: 2,
        background: checked ? EM : "rgba(255,255,255,0.1)",
        transition: "background 0.2s",
        display: "flex", alignItems: "center",
      }}>
        <div style={{
          width: 16, height: 16, borderRadius: "50%",
          background: checked ? "#000" : "rgba(255,255,255,0.4)",
          transform: checked ? "translateX(16px)" : "translateX(0)",
          transition: "transform 0.2s, background 0.2s",
        }} />
      </div>
    </div>
  );
}

// ── ProgressBar ──

interface ProgressBarProps {
  progress: number; // 0-100
  color?: string;
  height?: number;
}

export function ProgressBar({ progress, color = EM, height = 4 }: ProgressBarProps) {
  return (
    <div style={{
      width: "100%", height, borderRadius: height / 2,
      background: "rgba(255,255,255,0.06)",
      overflow: "hidden",
    }}>
      <div style={{
        width: `${Math.min(100, Math.max(0, progress))}%`,
        height: "100%", borderRadius: height / 2,
        background: color,
        transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
      }} />
    </div>
  );
}

// ── TierBreakdownBar ──

interface TierBreakdownBarProps {
  t1: number;
  t2: number;
  t3: number;
  unfilled: number;
  height?: number;
}

export function TierBreakdownBar({ t1, t2, t3, unfilled, height = 6 }: TierBreakdownBarProps) {
  const total = t1 + t2 + t3 + unfilled;
  if (total === 0) return null;

  return (
    <div style={{
      display: "flex", borderRadius: height / 2, overflow: "hidden", height,
      background: "rgba(255,255,255,0.06)", width: "100%",
    }}>
      {t1 > 0 && <div style={{ width: `${(t1 / total) * 100}%`, background: EM, transition: "width 0.5s ease" }} />}
      {t2 > 0 && <div style={{ width: `${(t2 / total) * 100}%`, background: BLUE, transition: "width 0.5s ease" }} />}
      {t3 > 0 && <div style={{ width: `${(t3 / total) * 100}%`, background: AMBER, transition: "width 0.5s ease" }} />}
      {unfilled > 0 && <div style={{ width: `${(unfilled / total) * 100}%`, background: "rgba(255,255,255,0.08)", transition: "width 0.5s ease" }} />}
    </div>
  );
}
