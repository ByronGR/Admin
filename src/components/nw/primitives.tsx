'use client';

// ============================================================
// Nearwork Admin redesign — shared primitives
// Faithful TS/React port of the design handoff `primitives.jsx`
// (NW palette + Icon, Avatar, CompanyTile, Chip, Button, MatchScore).
// Uses inline styles + the NW palette for pixel-accurate fidelity.
// ============================================================

import { useState, type CSSProperties, type ReactNode } from 'react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';

export const NW = {
  white: '#FFFFFF',
  black: '#111111',
  offWhite: '#F8F7F3',
  backdrop: '#ECEAE3',
  gray50: '#F5F4F0',
  gray100: '#EBEBEB',
  gray200: '#D9D9D9',
  gray300: '#BDBDBD',
  gray400: '#9E9E9E',
  gray500: '#757575',
  gray600: '#555555',
  gray700: '#383838',
  gray800: '#232323',
  gray900: '#161616',
  teal50: '#E8F8F5',
  teal100: '#C8EDE6',
  teal500: '#16A085',
  teal600: '#12866E',
  teal700: '#0E6B58',
  rose50: '#FEF0F5',
  rose500: '#E74C7C',
  rose600: '#CC3666',
  violet50: '#F7F2FC',
  violet500: '#AF7AC5',
  green50: '#F0FDF4',
  green500: '#22C55E',
  green600: '#16A34A',
  yellow50: '#FEFCE8',
  yellow500: '#EAB308',
  blue50: '#EFF6FF',
  blue500: '#3B82F6',
} as const;

// Numbers/IDs/money render in Poppins per Byron's preference. (The handoff spec
// used JetBrains Mono for these; kept the constant name so call sites are stable.)
export const MONO = "'Poppins', ui-sans-serif, system-ui, -apple-system, sans-serif";

// ── Icon (Lucide by kebab name, like the prototype) ───────────────────────────
export function Icon({
  name,
  size = 16,
  color,
  strokeWidth = 1.75,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', color, ...style }}>
      <DynamicIcon name={name} size={size} color={color} strokeWidth={strokeWidth} />
    </span>
  );
}

// ── Avatar (round, colored initials) ──────────────────────────────────────────
export function Avatar({
  initials,
  size = 32,
  bg = NW.teal500,
  fg = NW.white,
}: {
  initials: string;
  size?: number;
  bg?: string;
  fg?: string;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        color: fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.42,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

// ── Company tile (square logo placeholder) ────────────────────────────────────
export function CompanyTile({
  logo,
  color,
  size = 48,
  radius = 10,
}: {
  logo: string;
  color: string;
  size?: number;
  radius?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: color,
        color: NW.white,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: size * 0.46,
        letterSpacing: '-0.02em',
        flexShrink: 0,
        boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.04)',
      }}
    >
      {logo}
    </div>
  );
}

// ── Button (pill) ─────────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'dark' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  icon,
  iconRight,
  onClick,
  disabled,
  style,
  fullWidth,
  type = 'button',
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
  icon?: IconName;
  iconRight?: IconName;
  onClick?: () => void;
  disabled?: boolean;
  style?: CSSProperties;
  fullWidth?: boolean;
  type?: 'button' | 'submit';
}) {
  const sizes: Record<ButtonSize, { padding: string; fontSize: number; height: number; gap: number }> = {
    sm: { padding: '6px 12px', fontSize: 13, height: 32, gap: 6 },
    md: { padding: '10px 18px', fontSize: 14, height: 40, gap: 8 },
    lg: { padding: '14px 24px', fontSize: 15, height: 48, gap: 10 },
  };
  const variants: Record<ButtonVariant, { background: string; color: string; border: string; hoverBg: string }> = {
    primary: { background: NW.teal500, color: NW.white, border: '1px solid transparent', hoverBg: NW.teal600 },
    secondary: { background: NW.white, color: NW.black, border: `1px solid ${NW.gray200}`, hoverBg: NW.gray50 },
    ghost: { background: 'transparent', color: NW.black, border: '1px solid transparent', hoverBg: NW.gray50 },
    dark: { background: NW.black, color: NW.white, border: '1px solid transparent', hoverBg: NW.gray800 },
    success: { background: NW.green50, color: NW.green600, border: `1px solid ${NW.green500}40`, hoverBg: NW.green50 },
  };
  const s = sizes[size];
  const v = variants[variant];
  const [hover, setHover] = useState(false);
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: s.gap,
        padding: s.padding,
        height: s.height,
        fontSize: s.fontSize,
        fontWeight: 600,
        background: hover && !disabled ? v.hoverBg : v.background,
        color: v.color,
        border: v.border,
        borderRadius: 999,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        letterSpacing: '-0.01em',
        transition: 'background 150ms, transform 100ms',
        transform: hover && !disabled ? 'translateY(-1px)' : 'none',
        width: fullWidth ? '100%' : 'auto',
        ...style,
      }}
    >
      {icon && <Icon name={icon} size={s.fontSize + 2} />}
      {children}
      {iconRight && <Icon name={iconRight} size={s.fontSize + 2} />}
    </button>
  );
}

// ── Chip / Tag ────────────────────────────────────────────────────────────────
type ChipVariant = 'default' | 'accent' | 'rose' | 'violet' | 'blue' | 'success' | 'warning' | 'outline';

export function Chip({
  children,
  variant = 'default',
  icon,
  size = 'md',
}: {
  children: ReactNode;
  variant?: ChipVariant;
  icon?: IconName;
  size?: 'sm' | 'md' | 'lg';
}) {
  const variants: Record<ChipVariant, { bg: string; fg: string; border: string }> = {
    default: { bg: NW.gray50, fg: NW.gray700, border: NW.gray100 },
    accent: { bg: NW.teal50, fg: NW.teal700, border: '#16A08530' },
    rose: { bg: NW.rose50, fg: NW.rose600, border: '#E74C7C30' },
    violet: { bg: NW.violet50, fg: '#784899', border: '#AF7AC530' },
    blue: { bg: NW.blue50, fg: '#1D4ED8', border: '#3B82F630' },
    success: { bg: NW.green50, fg: NW.green600, border: '#22C55E40' },
    warning: { bg: NW.yellow50, fg: '#A16207', border: '#EAB30840' },
    outline: { bg: 'transparent', fg: NW.gray700, border: NW.gray200 },
  };
  const v = variants[variant];
  const sizes = { sm: { fz: 11, py: 3, px: 8 }, md: { fz: 12, py: 4, px: 10 }, lg: { fz: 13, py: 5, px: 12 } };
  const s = sizes[size];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: v.bg,
        color: v.fg,
        border: `1px solid ${v.border}`,
        fontSize: s.fz,
        fontWeight: 500,
        padding: `${s.py}px ${s.px}px`,
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {icon && <Icon name={icon} size={s.fz} />}
      {children}
    </span>
  );
}

// ── Match score donut ─────────────────────────────────────────────────────────
export function MatchScore({
  value,
  size = 44,
  strokeWidth = 3.5,
  showLabel = true,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  showLabel?: boolean;
}) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  const color = value >= 70 ? NW.teal500 : value >= 55 ? NW.yellow500 : NW.gray400;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={NW.gray100} strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>
      {showLabel && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: size * 0.3,
            fontWeight: 700,
            color: NW.black,
            letterSpacing: '-0.02em',
          }}
        >
          {value}
        </div>
      )}
    </div>
  );
}
