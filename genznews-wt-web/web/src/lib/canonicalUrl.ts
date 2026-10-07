import { createHash } from "node:crypto";

// Mirrors get_canonical_url / compute_url_hash in app/database.py so that seeded rows
// share the pipeline's url_hash idempotency key.

const DROP_KEYS = new Set(["ref", "source", "fbclid", "gclid", "at_medium", "at_campaign", "mc_cid"]);

/** Python urllib.parse.quote_plus with the default safe set. */
function quotePlus(s: string): string {
  let out = "";
  for (const byte of new TextEncoder().encode(s)) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9_.\-~]/.test(ch)) out += ch;
    else if (ch === " ") out += "+";
    else out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

function unquotePlus(s: string): string {
  const bytes: number[] = [];
  const enc = new TextEncoder();
  const plus = s.replace(/\+/g, " ");
  for (let i = 0; i < plus.length; ) {
    if (plus[i] === "%" && /^[0-9a-fA-F]{2}$/.test(plus.slice(i + 1, i + 3))) {
      bytes.push(parseInt(plus.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      const cp = plus.codePointAt(i)!;
      const chunk = String.fromCodePoint(cp);
      bytes.push(...enc.encode(chunk));
      i += chunk.length;
    }
  }
  return new TextDecoder("utf-8").decode(Uint8Array.from(bytes));
}

export function canonicalUrl(url: string): string {
  let rest = url.trim();
  const hash = rest.indexOf("#");
  if (hash >= 0) rest = rest.slice(0, hash);

  let scheme = "";
  const m = /^([A-Za-z][A-Za-z0-9+.\-]*):/.exec(rest);
  if (m) {
    scheme = m[1].toLowerCase();
    rest = rest.slice(m[0].length);
  }

  let netloc = "";
  if (rest.startsWith("//")) {
    const end = rest.slice(2).search(/[/?]/);
    const stop = end < 0 ? rest.length : end + 2;
    netloc = rest.slice(2, stop).toLowerCase();
    rest = rest.slice(stop);
  }

  let query = "";
  const q = rest.indexOf("?");
  if (q >= 0) {
    query = rest.slice(q + 1);
    rest = rest.slice(0, q);
  }

  // Path parameters (";x") on the last segment are dropped, as urlparse does for http(s).
  const lastSlash = rest.lastIndexOf("/");
  const semi = rest.indexOf(";", lastSlash + 1);
  if (semi >= 0) rest = rest.slice(0, semi);
  const path = rest.replace(/\/+$/, "");

  const pairs: [string, string][] = [];
  for (const part of query.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const rawK = eq >= 0 ? part.slice(0, eq) : part;
    const rawV = eq >= 0 ? part.slice(eq + 1) : "";
    if (!rawV) continue; // keep_blank_values=False (also drops bare keys)
    const k = unquotePlus(rawK);
    const v = unquotePlus(rawV);
    const kl = k.toLowerCase();
    if (kl.startsWith("utm_") || DROP_KEYS.has(kl)) continue;
    pairs.push([k, v]);
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const cleanQuery = pairs.map(([k, v]) => `${quotePlus(k)}=${quotePlus(v)}`).join("&");

  let out = path;
  if (netloc) out = "//" + netloc + (out && !out.startsWith("/") ? "/" + out : out);
  if (scheme) out = scheme + ":" + out;
  if (cleanQuery) out += "?" + cleanQuery;
  return out;
}

export function canonicalUrlHash(url: string): string {
  return createHash("sha256").update(canonicalUrl(url), "utf8").digest("hex");
}
