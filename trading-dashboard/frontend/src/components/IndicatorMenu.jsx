import React, { useState } from "react";
import { INDICATORS } from "../lib/indicators";
import { nanoid } from "../lib/id";

export default function IndicatorMenu({ list, onChange, onClose }) {
  const [picking, setPicking] = useState(false);

  function add(id) {
    const def = INDICATORS[id];
    onChange([...list, { key: nanoid(), id, params: { ...def.defaults } }]);
    setPicking(false);
  }
  function update(k, patch) {
    onChange(list.map((x) => (x.key === k ? { ...x, params: { ...x.params, ...patch } } : x)));
  }
  function remove(k) { onChange(list.filter((x) => x.key !== k)); }

  return (
    <div className="dlg" onClick={(e) => e.stopPropagation()}>
      <div className="dlg-head">
        <strong>Indicators</strong>
        <button onClick={onClose}>×</button>
      </div>
      <div className="dlg-body">
        {list.map((it) => {
          const def = INDICATORS[it.id]; if (!def) return null;
          return (
            <div key={it.key} className="ind-row">
              <div className="ind-name">
                <span className="dot" style={{ background: it.params.color || "#7b8593" }} />
                {def.label}
              </div>
              <div className="ind-params">
                {Object.entries(it.params).map(([k, v]) => (
                  k === "color" ? (
                    <input key={k} type="color" value={v} onChange={(e) => update(it.key, { color: e.target.value })} />
                  ) : typeof v === "number" ? (
                    <label key={k} className="mini">
                      {k}<input type="number" value={v} step={k === "mult" ? 0.1 : 1}
                        onChange={(e) => update(it.key, { [k]: parseFloat(e.target.value) || 0 })} />
                    </label>
                  ) : null
                ))}
                <button className="btn-x" onClick={() => remove(it.key)}>✕</button>
              </div>
            </div>
          );
        })}
        {picking ? (
          <div className="ind-pick">
            {Object.entries(INDICATORS).map(([id, def]) => (
              <button key={id} onClick={() => add(id)}>{def.label}<span className="muted"> · {def.pane}</span></button>
            ))}
          </div>
        ) : (
          <button className="btn" onClick={() => setPicking(true)}>+ Add indicator</button>
        )}
      </div>
    </div>
  );
}
