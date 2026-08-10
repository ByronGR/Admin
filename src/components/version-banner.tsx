"use client";

// Keeps open tabs from running stale code after we deploy. Web apps don't push new
// code into an already-open tab, so we detect a new deploy and:
//   1) auto-reload when the user returns to the tab (the safe moment — they're not
//      mid-typing), so most people silently land on the current version, and
//   2) show a "refresh" bar as a visible fallback for anyone staring at the page.
import { useEffect, useRef, useState } from "react";

// Don't yank the page out from under someone who's typing (a note, a reason…).
function isTyping(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable === true;
}

export function VersionBanner() {
  const [show, setShow] = useState(false);
  const stale = useRef(false);

  useEffect(() => {
    let baseline: string | null = null;
    let stopped = false;

    const check = async (): Promise<boolean> => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return false;
        const { v } = (await res.json()) as { v?: string };
        if (!v) return false;
        if (baseline === null) { baseline = v; return false; } // record load-time version
        if (v !== baseline) { stale.current = true; setShow(true); return true; }
        return false;
      } catch {
        return false; // offline / transient — try again next tick
      }
    };

    check();
    const id = setInterval(() => { if (!stopped) check(); }, 60_000);

    // When they come back to the tab, refresh the check and — if a new version is
    // live and they aren't typing — silently reload onto it.
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      await check();
      if (stale.current && !isTyping()) window.location.reload();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!show) return null;

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 20,
        transform: "translateX(-50%)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: 14,
        maxWidth: "calc(100vw - 32px)",
        padding: "10px 12px 10px 18px",
        background: "#0F172A",
        color: "#fff",
        borderRadius: 999,
        boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
        fontSize: 13.5,
        fontWeight: 500,
      }}
    >
      <span>A new version of Nearwork is available.</span>
      <button
        onClick={() => window.location.reload()}
        style={{
          flexShrink: 0,
          height: 32,
          padding: "0 16px",
          background: "#16A34A",
          color: "#fff",
          border: "none",
          borderRadius: 999,
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Refresh
      </button>
    </div>
  );
}
