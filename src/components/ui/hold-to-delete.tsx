'use client';

import * as React from 'react';
import { Trash2 } from 'lucide-react';

/**
 * Hold-to-delete button — a safety control for destructive actions.
 *
 * The user must press and HOLD the button for `holdDuration` ms before the
 * delete fires; releasing early cancels it. A red "fill" sweeps across the
 * button to show progress. Built natively (CSS transition + timer, pointer
 * events for mouse + touch) so it needs no animation library.
 *
 * `onConfirm` runs only when the hold completes.
 */
const ROSE = { fg: '#E74C7C', deep: '#CC3666', bg: '#FEF0F5', fill: 'rgba(231,76,124,0.30)', border: 'rgba(231,76,124,0.45)' };

export interface HoldToDeleteProps {
  onConfirm: () => void | Promise<void>;
  /** Hold time in ms before the action fires. Default 1500. */
  holdDuration?: number;
  /** Idle label. Default "Hold to delete". */
  label?: string;
  /** Label shown while holding. Default "Keep holding…". */
  holdingLabel?: string;
  /** External pending state (e.g. the delete request is in flight). */
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  /** Hide the trash icon. */
  hideIcon?: boolean;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

export function HoldToDelete({
  onConfirm,
  holdDuration = 1500,
  label = 'Hold to delete',
  holdingLabel = 'Keep holding…',
  busy = false,
  busyLabel = 'Deleting…',
  disabled = false,
  size = 'md',
  fullWidth = false,
  hideIcon = false,
  className,
  style,
  title,
}: HoldToDeleteProps) {
  const [holding, setHolding] = React.useState(false);
  const fillRef = React.useRef<HTMLSpanElement | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = React.useRef(false);

  const inactive = disabled || busy;

  const resetFill = React.useCallback((instant = false) => {
    const el = fillRef.current;
    if (!el) return;
    el.style.transition = instant ? 'none' : 'width 140ms ease-out';
    el.style.width = '0%';
  }, []);

  const stop = React.useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const start = React.useCallback(() => {
    if (inactive || firedRef.current) return;
    setHolding(true);
    const el = fillRef.current;
    if (el) {
      el.style.transition = 'none';
      el.style.width = '0%';
      // Force reflow so the next change animates from 0.
      void el.offsetWidth;
      el.style.transition = `width ${holdDuration}ms linear`;
      el.style.width = '100%';
    }
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      setHolding(false);
      stop();
      Promise.resolve(onConfirm()).finally(() => {
        firedRef.current = false;
        resetFill(true);
      });
    }, holdDuration);
  }, [inactive, holdDuration, onConfirm, stop, resetFill]);

  const cancel = React.useCallback(() => {
    if (firedRef.current) return; // completed — let onConfirm flow handle reset
    stop();
    setHolding(false);
    resetFill();
  }, [stop, resetFill]);

  React.useEffect(() => () => stop(), [stop]);

  const dims = size === 'sm'
    ? { height: 30, padding: '0 12px', fontSize: 12, gap: 6, icon: 13 }
    : { height: 38, padding: '0 16px', fontSize: 13, gap: 7, icon: 15 };

  const text = busy ? busyLabel : holding ? holdingLabel : label;

  return (
    <button
      type="button"
      title={title}
      disabled={inactive}
      onPointerDown={(e) => { e.preventDefault(); start(); }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      className={className}
      style={{
        position: 'relative',
        overflow: 'hidden',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: dims.gap,
        height: dims.height,
        padding: dims.padding,
        width: fullWidth ? '100%' : undefined,
        fontSize: dims.fontSize,
        fontWeight: 600,
        color: holding ? ROSE.deep : ROSE.fg,
        background: ROSE.bg,
        border: `1px solid ${ROSE.border}`,
        borderRadius: 9,
        cursor: inactive ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        userSelect: 'none',
        touchAction: 'none',
        WebkitTapHighlightColor: 'transparent',
        transition: 'color 120ms',
        ...style,
      }}
    >
      <span
        ref={fillRef}
        aria-hidden
        style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '0%', background: ROSE.fill, pointerEvents: 'none' }}
      />
      <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', gap: dims.gap, whiteSpace: 'nowrap' }}>
        {!hideIcon && <Trash2 style={{ width: dims.icon, height: dims.icon }} />}
        {text}
      </span>
    </button>
  );
}
