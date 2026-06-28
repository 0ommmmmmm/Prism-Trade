import React from "react";
import { TOOLS } from "../lib/drawings";

const ICONS = {
  cursor: "↖", cross: "✛", trend: "╱", hline: "─", vline: "│",
  ray: "→", rect: "▭", fib: "≣", text: "T", measure: "📏",
};

export default function Toolbar({ tool, setTool, magnet, setMagnet, onUndo, onRedo, onDelete }) {
  return (
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool ${tool === t.id ? "on" : ""}`}
          title={`${t.label}${t.key ? `  (${t.key === " " ? "Space" : t.key.toUpperCase()})` : ""}`}
          onClick={() => setTool(t.id)}
        >
          {ICONS[t.id] || "·"}
        </button>
      ))}
      <div className="tool-sep" />
      <button className={`tool ${magnet ? "on" : ""}`} title="Magnet Mode" onClick={() => setMagnet(!magnet)}>🧲</button>
      <button className="tool" title="Undo (Ctrl+Z)" onClick={onUndo}>↶</button>
      <button className="tool" title="Redo (Ctrl+Y)" onClick={onRedo}>↷</button>
      <button className="tool" title="Delete (Del)" onClick={onDelete}>🗑</button>
    </div>
  );
}
