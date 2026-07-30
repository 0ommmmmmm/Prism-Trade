/**
 * Well-known symbol aliases — maps raw broker/exchange codes to
 * human-readable trading names (e.g. GC=F → XAUUSD).
 */

const ALIASES = {
  "GC=F": "XAUUSD",
  "NQ=F": "NAS100",
};

/** Return the display name for a symbol (alias if available, else raw). */
export function displayName(sym) {
  return ALIASES[sym] || sym;
}

/** Reverse lookup — given a display name, return the raw symbol (or same). */
export function rawSymbol(name) {
  for (const [raw, alias] of Object.entries(ALIASES)) {
    if (alias === name) return raw;
  }
  return name;
}

export default ALIASES;
