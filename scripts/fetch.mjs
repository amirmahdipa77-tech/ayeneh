#!/usr/bin/env node
/**
 * آینه — news fetch
 *
 * Reads the official RSS feeds of Iranian news outlets, normalises the items
 * and writes a single compact JSON file the static site loads.
 *
 * Design notes
 *  - Zero dependencies: only Node built-ins (global fetch, TextDecoder).
 *  - Every source has a list of candidate feed URLs; the first one that
 *    returns parseable XML wins. A failing source never breaks the run.
 *  - If a source fails this round, its recent items from the previous run are
 *    kept (up to MAX_KEEP_HOURS), so the page never loses a column.
 *  - If nothing at all could be fetched, the existing file is left untouched.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const OUT = "data/news.json";
const PER_SOURCE = 40;
const MAX_ITEMS = 700;
const MAX_KEEP_HOURS = 12;
const TIMEOUT_MS = 20000;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Official feeds (verified against each outlet's own RSS page or a live reader). */
const SOURCES = [
  { id: "irna", name: "ایرنا", home: "https://www.irna.ir",
    feeds: ["https://www.irna.ir/rss"] },

  { id: "isna", name: "ایسنا", home: "https://www.isna.ir",
    feeds: ["https://www.isna.ir/rss", "https://www.isna.ir/rss-homepage"] },

  { id: "mehr", name: "مهر", home: "https://www.mehrnews.com",
    feeds: ["https://www.mehrnews.com/rss", "https://www.mehrnews.com/rss/pl/8"] },

  { id: "yjc", name: "باشگاه خبرنگاران", home: "https://www.yjc.ir",
    headers: { referer: "https://www.yjc.ir/", "user-agent": "Feedly/1.0 (+http://www.feedly.com/fetcher.html; like FeedFetcher-Google)" },
    feeds: ["https://www.yjc.ir/fa/rss/allnews", "https://www.yjc.ir/fa/rss"] },

  { id: "khabaronline", name: "خبرآنلاین", home: "https://www.khabaronline.ir",
    feeds: ["https://www.khabaronline.ir/rss"] },

  { id: "hamshahri", name: "همشهری", home: "https://www.hamshahrionline.ir",
    feeds: ["https://www.hamshahrionline.ir/rss"] },

  { id: "tabnak", name: "تابناک", home: "https://www.tabnak.ir",
    feeds: ["https://www.tabnak.ir/fa/rss/allnews"] },

  { id: "asriran", name: "عصر ایران", home: "https://www.asriran.com",
    feeds: ["https://www.asriran.com/fa/rss/allnews"] },

  { id: "entekhab", name: "انتخاب", home: "https://www.entekhab.ir",
    feeds: ["https://www.entekhab.ir/fa/rss/allnews"] },

  { id: "tasnim", name: "تسنیم", home: "https://www.tasnimnews.com",
    feeds: [
      "https://www.tasnimnews.com/fa/rss/feed/0/0/8/0/AllStories",
      "https://www.tasnimnews.ir/fa/rss/feed/0/0/8/0/AllStories",
      "https://www.tasnimnews.ir/fa/rss",
      "https://www.tasnimnews.com/fa/rss/feed/0/8/0/%D9%85%D9%87%D9%85%E2%80%8C%D8%AA%D8%B1%DB%8C%D9%86-%D8%A7%D8%AE%D8%A8%D8%A7%D8%B1-%D8%AA%D8%B3%D9%86%DB%8C%D9%85",
    ] },

  { id: "ilna", name: "ایلنا", home: "https://www.ilna.ir",
    feeds: ["https://www.ilna.ir/rss", "https://www.ilna.ir/rss-fory"] },

  { id: "donya", name: "دنیای اقتصاد", home: "https://donya-e-eqtesad.com",
    feeds: ["https://donya-e-eqtesad.com/fa/rss", "https://donya-e-eqtesad.com/rss"] },

  { id: "alef", name: "الف", home: "https://alef.ir",
    feeds: ["https://alef.ir/rss", "https://www.alef.ir/rss"] },

  { id: "varzesh3", name: "ورزش سه", home: "https://www.varzesh3.com",
    feeds: ["https://www.varzesh3.com/rss/all"] },

  { id: "khabarvarzeshi", name: "خبر ورزشی", home: "https://www.khabarvarzeshi.com",
    feeds: ["https://www.khabarvarzeshi.com/rss"] },

  { id: "zoomit", name: "زومیت", home: "https://www.zoomit.ir",
    feeds: ["https://www.zoomit.ir/feed/"] },

  { id: "digiato", name: "دیجیاتو", home: "https://digiato.com",
    feeds: ["https://digiato.com/feed"] },
];

/* ------------------------------------------------------------------ */
/* text helpers                                                        */
/* ------------------------------------------------------------------ */

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  laquo: "«", raquo: "»", hellip: "…", mdash: "—", ndash: "–",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", zwnj: "\u200c",
};

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function safeChar(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function unwrapCdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function clean(s) {
  if (!s) return "";
  let out = unwrapCdata(String(s));
  out = out.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  out = out.replace(/<br\s*\/?>/gi, " ");
  out = out.replace(/<[^>]+>/g, " ");
  out = decodeEntities(out);
  out = out.replace(/[\u200b\u200e\u200f\ufeff]/g, "");
  return out.replace(/\s+/g, " ").trim();
}

function clip(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[،,.:;«\-–—\s]+$/, "") + "…";
}

function pick(block, tags) {
  for (const tag of tags) {
    const m = block.match(
      new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i")
    );
    if (m && m[1].trim()) return m[1].trim();
  }
  return "";
}

function pickLink(block) {
  const plain = pick(block, ["link"]);
  if (plain) {
    const t = clean(plain);
    if (/^https?:\/\//i.test(t)) return t;
  }
  // Atom style: <link rel="alternate" href="..."/>
  const alt = block.match(
    /<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i
  );
  if (alt) return decodeEntities(alt[1]);
  const any = block.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i);
  if (any) return decodeEntities(any[1]);
  // GUID that is a permalink
  const guid = block.match(
    /<guid\b[^>]*isPermaLink=["']true["'][^>]*>([^<]+)<\/guid>/i
  );
  if (guid) return decodeEntities(guid[1].trim());
  const id = pick(block, ["id", "guid"]);
  return /^https?:\/\//i.test(id) ? id : "";
}

function normUrl(u) {
  try {
    const x = new URL(String(u).trim());
    x.hash = "";
    return x.href;
  } catch {
    return String(u).trim();
  }
}

function parseDate(raw) {
  const s = clean(raw);
  if (!s) return null;
  let t = Date.parse(s);
  if (Number.isNaN(t)) {
    // some feeds drop the timezone or use "YYYY/MM/DD HH:mm"
    const fixed = s.replace(/\//g, "-").replace(/\s+/g, " ");
    t = Date.parse(fixed);
  }
  if (Number.isNaN(t)) return null;
  const now = Date.now();
  if (t > now + 36 * 3600e3) t = now; // guard against clock skew
  if (t < now - 400 * 24 * 3600e3) return null;
  return new Date(t).toISOString();
}

/* ------------------------------------------------------------------ */
/* fetching                                                            */
/* ------------------------------------------------------------------ */

async function fetchText(url, extra = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent": UA,
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        "accept-language": "fa-IR,fa;q=0.9,en;q=0.7",
        ...extra,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const head = buf.subarray(0, 400).toString("latin1");
    let charset =
      (res.headers.get("content-type") || "").match(/charset=["']?([\w-]+)/i)?.[1] ||
      head.match(/encoding=["']([\w-]+)["']/i)?.[1] ||
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

function parseFeed(xml, source) {
  const items = [];
  const blocks = [
    ...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ].map((m) => m[0]);

  for (const block of blocks) {
    const title = clean(pick(block, ["title"]));
    const url = pickLink(block);
    if (!title || title.length < 6 || !/^https?:\/\//i.test(url)) continue;

    const raw =
      pick(block, ["description", "summary", "content:encoded", "content"]) || "";
    const excerpt = clip(clean(raw), 200);

    const date = parseDate(
      pick(block, ["pubDate", "published", "updated", "dc:date", "date"])
    );

    items.push({
      t: title.slice(0, 300),
      u: normUrl(url),
      s: source.id,
      d: date,
      x: excerpt.length > 30 ? excerpt : "",
    });
  }

  // newest first, de-duplicated by URL
  const seen = new Set();
  return items
    .filter((it) => (seen.has(it.u) ? false : seen.add(it.u)))
    .sort((a, b) => (b.d ? Date.parse(b.d) : 0) - (a.d ? Date.parse(a.d) : 0))
    .slice(0, PER_SOURCE);
}

async function loadSource(source) {
  const errors = [];
  for (const feed of source.feeds) {
    try {
      const xml = await fetchText(feed, source.headers || {});
      if (!/<(item|entry)\b/i.test(xml)) throw new Error("no items in feed");
      const items = parseFeed(xml, source);
      if (!items.length) throw new Error("feed parsed but empty");
      return { items, feed, errors };
    } catch (err) {
      errors.push(`${feed} → ${err.message}`);
    }
  }
  return { items: [], feed: null, errors };
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function readPrevious() {
  try {
    return JSON.parse(await readFile(OUT, "utf8"));
  } catch {
    return { items: [] };
  }
}

async function main() {
  const previous = await readPrevious();
  const results = await Promise.allSettled(SOURCES.map((s) => loadSource(s)));

  const collected = [];
  const status = [];
  let failures = 0;

  results.forEach((res, i) => {
    const source = SOURCES[i];
    const value = res.status === "fulfilled" ? res.value : { items: [], errors: [String(res.reason)] };
    let items = value.items;

    if (!items.length) {
      failures++;
      const cutoff = Date.now() - MAX_KEEP_HOURS * 3600e3;
      items = (previous.items || []).filter(
        (it) => it.s === source.id && it.d && Date.parse(it.d) > cutoff
      );
      console.log(`✗ ${source.name}: ${value.errors.join(" | ") || "empty"} (kept ${items.length} old)`);
    } else {
      console.log(`✓ ${source.name}: ${items.length} items via ${value.feed}`);
    }

    collected.push(...items);
    status.push({
      id: source.id,
      name: source.name,
      home: source.home,
      count: items.length,
      ok: value.items.length > 0,
    });
  });

  if (failures === SOURCES.length) {
    console.error("همهٔ منابع ناموفق بودند؛ فایل قبلی دست‌نخورده می‌ماند.");
    process.exit(0);
  }

  // global merge: de-duplicate by URL, then by normalised title
  const byUrl = new Set();
  const byTitle = new Set();
  const key = (s) => s.replace(/\s+/g, " ").trim();
  const merged = collected
    .filter((it) => {
      if (byUrl.has(it.u)) return false;
      byUrl.add(it.u);
      const tk = key(it.t);
      if (byTitle.has(tk)) return false;
      byTitle.add(tk);
      return true;
    })
    .sort((a, b) => (b.d ? Date.parse(b.d) : 0) - (a.d ? Date.parse(a.d) : 0))
    .slice(0, MAX_ITEMS)
    .map((it) => ({ t: it.t, u: it.u, s: it.s, d: it.d, x: it.x }));

  const payload = {
    updatedAt: new Date().toISOString(),
    sources: status,
    items: merged,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload), "utf8");
  console.log(
    `\nنوشته شد: ${merged.length} تیتر از ${status.filter((s) => s.ok).length}/${SOURCES.length} منبع`
  );
}

export { parseFeed, clean, clip, decodeEntities };

if (!process.env.AYENEH_TEST) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
