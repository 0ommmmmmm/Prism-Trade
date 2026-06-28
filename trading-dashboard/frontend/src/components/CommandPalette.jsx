import React, { useEffect, useMemo, useRef, useState } from "react";

export default function CommandPalette({ open, onClose, items, onPick }) {
  const [q, setQ] = useState("");
  const inputRef = useRef(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => { if (open) { setQ(""); setIdx(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((it) =>
      !s || it.label.toLowerCase().includes(s) || it.hint?.toLowerCase().includes(s)
    ).slice(0, 50);
  }, [items, q]);

  if (!open) return null;
  return (
    <div className="palette-bg" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          placeholder="Search symbols, commands…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter") { const it = filtered[idx]; if (it) { onPick(it); onClose(); } }
            else if (e.key === "Escape") onClose();
          }}
        />
        <div className="palette-list">
          {filtered.map((it, i) => (
            <div key={it.id} className={`palette-item ${i === idx ? "on" : ""}`}
              onMouseEnter={() => setIdx(i)} onClick={() => { onPick(it); onClose(); }}>
              <span>{it.label}</span>
              <span className="muted">{it.hint}</span>
            </div>
          ))}
          {!filtered.length && <div className="palette-empty">No results</div>}
        </div>
      </div>
    </div>
  );
}
