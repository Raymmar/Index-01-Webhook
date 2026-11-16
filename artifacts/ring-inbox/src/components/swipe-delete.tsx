import { useRef, useState, type ReactNode } from "react";

/** Left-only pointer swipe; nested task rows own their gestures. */
export function SwipeDelete({ children, onDelete, disabled = false }: { children: ReactNode; onDelete: () => Promise<unknown>; disabled?: boolean }) {
  const start = useRef<{ x: number; y: number; blocked: boolean } | null>(null);
  const busy = useRef(false);
  const suppress = useRef(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  async function remove() {
    if (busy.current || disabled) return;
    busy.current = true; setError("");
    try { await onDelete(); } catch { setError("Could not delete. Try again."); }
    finally { busy.current = false; }
  }
  return <div data-swipe-delete className="relative overflow-hidden" style={{ touchAction: "pan-y" }}
    onPointerDown={e => {
      start.current = null;
      // Mouse drags select text/seek media, never delete. Touch editing and
      // playback surfaces also retain their normal browser interactions.
      if (!e.isPrimary || e.pointerType !== "touch" || (e.target as HTMLElement).closest('input, textarea, select, button, a, audio, video, p, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [data-no-swipe]')) return;
      if ((e.target as HTMLElement).closest("[data-swipe-delete]") !== e.currentTarget || disabled || busy.current || e.button !== 0) return;
      start.current = { x: e.clientX, y: e.clientY, blocked: false };
    }}
    onPointerMove={e => {
      const g = start.current; if (!g) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) g.blocked = true;
      if (!g.blocked && dx < -10 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        e.currentTarget.setPointerCapture(e.pointerId);
        suppress.current = Date.now() + 500;
        setOffset(Math.max(-110, dx));
      } else setOffset(0);
    }}
    onPointerUp={e => {
      const g = start.current; start.current = null; setOffset(0);
      if (!g || g.blocked) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (dx <= -80 && Math.abs(dx) > Math.abs(dy) * 1.5) { suppress.current = Date.now() + 500; void remove(); }
    }}
    onPointerCancel={() => { start.current = null; setOffset(0); }}
    onLostPointerCapture={e => { if (e.target === e.currentTarget) { start.current = null; setOffset(0); } }}
    onClickCapture={e => { if (Date.now() < suppress.current) { e.preventDefault(); e.stopPropagation(); } }}>
    {offset < 0 && <div className="absolute inset-0 flex items-center justify-end bg-secondary px-4 text-sm text-destructive">{offset <= -80 ? "Release to delete" : "Delete"}</div>}
    <div style={{ transform: `translateX(${offset}px)` }} className="relative bg-card">{children}</div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
