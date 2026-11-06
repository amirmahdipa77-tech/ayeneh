/** Text helpers shared by the feed reader and the article extractor. */

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  laquo: "«", raquo: "»", hellip: "…", mdash: "—", ndash: "–",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", zwnj: "\u200c",
  copy: "©", reg: "®", trade: "™", deg: "°", middot: "·",
  times: "×", divide: "÷", rlm: "\u200f", lrm: "\u200e",
};

function safeChar(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function unwrapCdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

/** Strip markup and normalise whitespace. */
export function clean(s) {
  if (!s) return "";
  let out = unwrapCdata(String(s));
  out = out.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ");
  out = out.replace(/<br\s*\/?>/gi, " ");
  out = out.replace(/<[^>]+>/g, " ");
  out = decodeEntities(out);
  out = out.replace(/[\u200b\u200e\ufeff]/g, "");
  return out.replace(/[ \t\u00a0]+/g, " ").replace(/\s*\n\s*/g, " ").trim();
}

export function clip(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[،,.:;«\-–—\s]+$/, "") + "…";
}

export function normUrl(u) {
  try {
    const x = new URL(String(u).trim());
    x.hash = "";
    x.searchParams.delete("utm_source");
    x.searchParams.delete("utm_medium");
    return x.href;
  } catch {
    return String(u).trim();
  }
}

export function parseDate(raw) {
  const s = clean(raw);
  if (!s) return null;
  let t = Date.parse(s);
  if (Number.isNaN(t)) t = Date.parse(s.replace(/\//g, "-"));
  if (Number.isNaN(t)) return null;
  const now = Date.now();
  if (t > now + 36 * 3600e3) t = now;
  if (t < now - 400 * 24 * 3600e3) return null;
  return new Date(t).toISOString();
}

/** Fetch a URL and decode it using the charset the server (or the XML prolog) declares. */
export async function fetchText(url, { timeout = 20000, headers = {}, attempt = 1 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/xml,text/xml,*/*",
        "accept-language": "fa-IR,fa;q=0.9,en;q=0.7",
        "accept-encoding": "gzip, deflate, br",
        ...headers,
      },
    });
    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 429;
      if (retryable && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1200 * attempt));
        clearTimeout(timer);
        return await fetchText(url, { timeout, headers, attempt: attempt + 1 });
      }
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const head = buf.subarray(0, 500).toString("latin1");
    let charset =
      (res.headers.get("content-type") || "").match(/charset=["']?([\w-]+)/i)?.[1] ||
      head.match(/encoding=["']([\w-]+)["']/i)?.[1] ||
      head.match(/charset=["']?([\w-]+)/i)?.[1] ||
      "utf-8";
    charset = charset.toLowerCase();
    if (charset === "windows-1256" || charset === "cp1256") {
      return new TextDecoder("windows-1256").decode(buf);
    }
    try {
      return new TextDecoder(charset, { fatal: false }).decode(buf);
    } catch {
      return buf.toString("utf8");
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Small non-cryptographic hash — used for stable article ids. */
export function shortHash(str) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = (h2 + c * 31) >>> 0;
    h2 = Math.imul(h2, 2654435761) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).slice(0, 10).padEnd(8, "0");
}
