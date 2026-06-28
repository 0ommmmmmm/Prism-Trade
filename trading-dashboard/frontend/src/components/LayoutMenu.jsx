import React, { useState } from "react";
import { loadLayouts, saveLayout, deleteLayout, store, KEYS } from "../lib/storage";

export default function LayoutMenu({ snapshot, onLoad, onClose }) {
  const [layouts, setLayouts] = useState(() => loadLayouts());
  const active = store.get(KEYS.activeLayout, null);

  function save() {
    const name = prompt("Layout name:", active || "My layout"); if (!name) return;
    saveLayout(name, snapshot);
    setLayouts(loadLayouts());
  }
  function del(n) {
    if (!confirm(`Delete layout "${n}"?`)) return;
    deleteLayout(n); setLayouts(loadLayouts());
  }

  return (
    <div className="dlg" onClick={(e) => e.stopPropagation()}>
      <div className="dlg-head">
        <strong>Layouts</strong>
        <button onClick={onClose}>×</button>
      </div>
      <div className="dlg-body">
        <button className="btn" onClick={save}>💾 Save current layout</button>
        <div className="layouts-list">
          {Object.entries(layouts).length === 0 && <div className="muted">No saved layouts yet.</div>}
          {Object.entries(layouts).map(([name, l]) => (
            <div key={name} className={`layout-row ${name === active ? "on" : ""}`}>
              <span onClick={() => { onLoad(name, l); onClose(); }} className="ll-name">
                {name} <span className="muted">· {l.count} panels</span>
              </span>
              <button className="btn-x" onClick={() => del(name)}>✕</button>
            </div>
          ))}
        </div>
        <div className="muted small">Autosaves every 5s under "_autosave".</div>
      </div>
    </div>
  );
}
