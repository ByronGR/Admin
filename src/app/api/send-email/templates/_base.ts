// ─── Template base helpers ────────────────────────────────────────────────────
// Every template file should export:
//   build(data: Record<string, string>): { subject: string; html: string }
//
// Use fill(html, data) to replace {placeholders} with escaped values.
// Use esc() directly for inline string building.

export function esc(str: string): string {
  return String(str ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch),
  );
}

/** Replace every {key} placeholder in an HTML string with the escaped value. */
export function fill(html: string, data: Record<string, string>): string {
  return html.replace(/\{(\w+)\}/g, (_, key) => esc(data[key] ?? ''));
}
