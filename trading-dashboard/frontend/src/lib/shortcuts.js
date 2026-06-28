import { useEffect } from "react";

export function useShortcuts(handlers) {
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      const id =
        mod && key === "k" ? "palette" :
        mod && key === "s" ? "save" :
        mod && key === "z" ? "undo" :
        mod && key === "y" ? "redo" :
        !mod && key === "delete" ? "delete" :
        !mod && key === "backspace" && !typing ? "delete" :
        !mod && !typing && key === " " ? "cursor" :
        !mod && !typing && key === "t" ? "trend" :
        !mod && !typing && key === "h" ? "hline" :
        !mod && !typing && key === "v" ? "vline" :
        !mod && !typing && key === "r" ? "rect" :
        !mod && !typing && key === "f" ? "fib" :
        !mod && !typing && key === "m" ? "measure" :
        !mod && !typing && key === "c" ? "cross" :
        null;
      if (!id) return;
      const fn = handlers[id]; if (!fn) return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers]);
}
