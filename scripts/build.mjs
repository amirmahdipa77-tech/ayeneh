#!/usr/bin/env node
/**
 * آینه — build
 *
 *   1. reads the official RSS feeds (Iranian outlets + Persian-language world coverage)
 *   2. normalises items, picks a lead image, tags a category for the tab bar
 *   3. fetches the full article body for the newest items that don't have one yet
 *   4. writes data/news.json (the list) and data/articles/<id>.json (the bodies)
 *
 * Zero dependencies. Everything degrades gracefully: a broken source or a
 * blocked article page never takes the build down.
 */

import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

import {
  clean, clip, decodeEntities, fetchText, normUrl, parseDate, shortHash, unwrapCdata,
} from "./lib/text.mjs";
import { extractArticle } from "./lib/article.mjs";

const NEWS = "data/news.json";
const ART_DIR = "data/articles";
const PER_SOURCE = 40;
const MAX_ITEMS = 900;
const MAX_KEEP_HOURS = 12;
const EXTRACT_LIMIT = Number(process.env.EXTRACT_LIMIT || 220);
const EXTRACT_CONCURRENCY = 10;
const EXTRACT_TIMEOUT = 15000;

/* ------------------------------------------------------------------ */
/* sources                                                             */
/* ------------------------------------------------------------------ */

const SOURCES = [
  /* ---- Iran ---- */
  { id: "irna", name: "ایرنا", home: "https://www.irna.ir", scope: "ir", cat: "iran",
    feeds: ["https://www.irna.ir/rss"] },
  { id: "isna", name: "ایسنا", home: "https://www.isna.ir", scope: "ir", cat: "iran",
    feeds: ["https://www.isna.ir/rss", "https://www.isna.ir/rss-homepage"] },
  { id: "mehr", name: "مهر", home: "https://www.mehrnews.com", scope: "ir", cat: "iran",
    feeds: ["https://www.mehrnews.com/rss", "https://www.mehrnews.com/rss/pl/8"] },
  { id: "yjc", name: "باشگاه خبرنگاران", home: "https://www.yjc.ir", scope: "ir", cat: "iran",
    headers: { referer: "https://www.yjc.ir/",
      "user-agent": "Feedly/1.0 (+http://www.feedly.com/fetcher.html; like FeedFetcher-Google)" },
    feeds: ["https://www.yjc.ir/fa/rss/allnews", "https://www.yjc.ir/fa/rss"] },
  { id: "khabaronline", name: "خبرآنلاین", home: "https://www.khabaronline.ir", scope: "ir", cat: "iran",
    feeds: ["https://www.khabaronline.ir/rss"] },
  { id: "hamshahri", name: "همشهری", home: "https://www.hamshahrionline.ir", scope: "ir", cat: "iran",
    feeds: ["https://www.hamshahrionline.ir/rss"] },
  { id: "tabnak", name: "تابناک", home: "https://www.tabnak.ir", scope: "ir", cat: "iran",
    feeds: ["https://www.tabnak.ir/fa/rss/allnews"] },
  { id: "asriran", name: "عصر ایران", home: "https://www.asriran.com", scope: "ir", cat: "iran",
    feeds: ["https://www.asriran.com/fa/rss/allnews"] },
  { id: "entekhab", name: "انتخاب", home: "https://www.entekhab.ir", scope: "ir", cat: "iran",
    feeds: ["https://www.entekhab.ir/fa/rss/allnews"] },
  { id: "tasnim", name: "تسنیم", home: "https://www.tasnimnews.com", scope: "ir", cat: "iran",
    feeds: [
      "https://www.tasnimnews.com/fa/rss/feed/0/0/8/0/AllStories",
      "https://www.tasnimnews.ir/fa/rss/feed/0/0/8/0/AllStories",
      "https://www.tasnimnews.ir/fa/rss",
    ] },
  { id: "ilna", name: "ایلنا", home: "https://www.ilna.ir", scope: "ir", cat: "iran",
    feeds: ["https://www.ilna.ir/rss", "https://www.ilna.ir/rss-fory"] },
  { id: "donya", name: "دنیای اقتصاد", home: "https://donya-e-eqtesad.com", scope: "ir", cat: "economy",
    feeds: ["https://donya-e-eqtesad.com/fa/rss", "https://donya-e-eqtesad.com/rss"] },
  { id: "varzesh3", name: "ورزش سه", home: "https://www.varzesh3.com", scope: "ir", cat: "sport",
    feeds: ["https://www.varzesh3.com/rss/all"] },
  { id: "khabarvarzeshi", name: "خبر ورزشی", home: "https://www.khabarvarzeshi.com", scope: "ir", cat: "sport",
    feeds: ["https://www.khabarvarzeshi.com/rss"] },
  { id: "zoomit", name: "زومیت", home: "https://www.zoomit.ir", scope: "ir", cat: "tech",
    feeds: ["https://www.zoomit.ir/feed/"] },
  { id: "digiato", name: "دیجیاتو", home: "https://digiato.com", scope: "ir", cat: "tech",
    feeds: ["https://digiato.com/feed"] },

  /* ---- Persian-language coverage from outside Iran ---- */
  { id: "bbcfa", name: "بی‌بی‌سی فارسی", home: "https://www.bbc.com/persian", scope: "world", cat: "world",
    feeds: ["https://feeds.bbci.co.uk/persian/rss.xml"] },
  { id: "iranintl", name: "ایران اینترنشنال", home: "https://www.iranintl.com", scope: "world", cat: "world",
    feeds: ["https://www.iranintl.com/fa/feed", "https://www.iranintl.com/feed"] },
  { id: "iranwire", name: "ایران‌وایر", home: "https://iranwire.com", scope: "world", cat: "world",
    feeds: ["https://iranwire.com/fa/feed/"] },
  { id: "kayhanlondon", name: "کیهان لندن", home: "https://kayhan.london", scope: "world", cat: "world",
    feeds: ["https://kayhan.london/fa/feed/"] },
];

/* ------------------------------------------------------------------ */
/* categorising                                                        */
/* ------------------------------------------------------------------ */

const KEYWORDS = {
  sport: ["فوتبال", "فوتسال", "لیگ برتر", "پرسپولیس", "استقلال", "سپاهان", "تراکتور",
    "ورزش", "ورزشی", "دربی", "المپیک", "پاراآسیایی", "کشتی", "والیبال", "بسکتبال",
    "تیم ملی", "مربی", "باشگاه", "قهرمانی", "نیمکت", "گلزن", "داور", "استادیوم",
    "tennis", "fifa", "world cup", "مسی", "رونالدو"],
  tech: ["هوش مصنوعی", "فناوری", "گوگل", "اپل", "اندروید", "آیفون", "موبایل", "لپ‌تاپ",
    "تراشه", "ناسا", "فضاپیما", "ربات", "اینترنت", "سایبری", "هک", "استارتاپ", "پیکسل",
    "سامسونگ", "شیائومی", "تلگرام", "واتساپ", "متاورس", "کوانتوم", "chatgpt", "openai"],
  economy: ["تورم", "دلار", "یورو", "بورس", "سهام", "قیمت", "بازار", "اقتصاد", "یارانه",
    "بانک", "طلا", "سکه", "ارز", "صادرات", "واردات", "بودجه", "مالیات", "نفت", "گاز",
    "مسکن", "اجاره", "بیت‌کوین", "رمزارز", "درآمد", "معیشت", "حقوق", "بازنشست"],
};

function classify(source, title) {
  if (source.cat !== "iran") return source.cat;
  const t = title || "";
  let best = { cat: "iran", hits: 0 };
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    const hits = words.filter((w) => t.includes(w)).length;
    if (hits > best.hits) best = { cat, hits };
  }
  return best.cat;
}

/* ------------------------------------------------------------------ */
/* feed parsing                                                        */
/* ------------------------------------------------------------------ */

function pick(block, tags) {
  for (const tag of tags) {
    const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
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
  const alt = block.match(/<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i);
  if (alt) return decodeEntities(alt[1]);
  const any = block.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i);
  if (any) return decodeEntities(any[1]);
  const guid = block.match(/<guid\b[^>]*isPermaLink=["']true["'][^>]*>([^<]+)<\/guid>/i);
  if (guid) return decodeEntities(guid[1].trim());
  const id = pick(block, ["id", "guid"]);
  return /^https?:\/\//i.test(id) ? id : "";
}

function pickImage(block) {
  const attrs = [
    /<enclosure\b[^>]*\burl=["']([^"']+)["'][^>]*>/i,
    /<media:content\b[^>]*\burl=["']([^"']+)["'][^>]*>/i,
    /<media:thumbnail\b[^>]*\burl=["']([^"']+)["'][^>]*>/i,
    /<itunes:image\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i,
  ];
  for (const re of attrs) {
    const m = block.match(re);
    if (m && /\.(jpe?g|png|webp|gif|avif)/i.test(m[1])) return decodeEntities(m[1]);
  }
  const raw = pick(block, ["content:encoded", "description", "summary", "content"]);
  if (raw) {
    const img = unwrapCdata(raw).match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
    if (img) return decodeEntities(img[1]);
  }
  return "";
}

function parseFeed(xml, source) {
  const blocks = [
    ...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ].map((m) => m[0]);

  const items = [];
  const seen = new Set();

  for (const block of blocks) {
    const title = clean(pick(block, ["title"]));
    const url = pickLink(block);
    if (!title || title.length < 6 || !/^https?:\/\//i.test(url)) continue;
    const u = normUrl(url);
    if (seen.has(u)) continue;
    seen.add(u);

    const raw = pick(block, ["description", "summary", "content:encoded", "content"]);
    const excerpt = clip(clean(raw), 190);
    const date = parseDate(pick(block, ["pubDate", "published", "updated", "dc:date", "date"]));
    const img = pickImage(block);

    items.push({
      i: shortHash(u),
      t: title.slice(0, 300),
      u,
      s: source.id,
      d: date,
      x: excerpt.length > 40 ? excerpt : "",
      img: img ? normUrl(img) : "",
      c: classify(source, title),
    });
  }

  return items
    .sort((a, b) => (b.d ? Date.parse(b.d) : 0) - (a.d ? Date.parse(a.d) : 0))
    .slice(0, PER_SOURCE);
}

async function loadSource(source) {
  const errors = [];
  for (const feed of source.feeds) {
    try {
      const xml = await fetchText(feed, { headers: source.headers || {}, timeout: 25000 });
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
/* full text                                                           */
/* ------------------------------------------------------------------ */

async function pool(tasks, limit) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      results[index] = await tasks[index]();
    }
  });
  await Promise.all(runners);
  return results;
}

function sourceHeaders(id) {
  const src = SOURCES.find((s) => s.id === id);
  return src?.headers || {};
}

async function existingArticles() {
  try {
    const files = await readdir(ART_DIR);
    return new Set(files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")));
  } catch {
    return new Set();
  }
}

async function readArticle(id) {
  try {
    return JSON.parse(await readFile(join(ART_DIR, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function readPrevious() {
  try {
    return JSON.parse(await readFile(NEWS, "utf8"));
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

  results.forEach((res, index) => {
    const source = SOURCES[index];
    const value = res.status === "fulfilled"
      ? res.value
      : { items: [], errors: [String(res.reason)] };
    let items = value.items;

    if (!items.length) {
      failures++;
      const cutoff = Date.now() - MAX_KEEP_HOURS * 3600e3;
      items = (previous.items || [])
        .filter((it) => it.s === source.id && it.d && Date.parse(it.d) > cutoff)
        .map((it) => ({
          i: it.i || shortHash(it.u),
          t: it.t, u: it.u, s: it.s, d: it.d,
          x: it.x || "",
          img: it.img || "",
          c: it.c || classify(source, it.t),
          f: it.f || 0,
        }));
      console.log(`✗ ${source.name}: ${value.errors.join(" | ") || "empty"} (kept ${items.length})`);
    } else {
      console.log(`✓ ${source.name}: ${items.length} via ${value.feed}`);
    }

    collected.push(...items);
    status.push({
      id: source.id, name: source.name, home: source.home,
      scope: source.scope, cat: source.cat,
      count: items.length, ok: value.items.length > 0,
    });
  });

  if (failures === SOURCES.length) {
    console.error("همهٔ منابع ناموفق بودند؛ خروجی قبلی دست‌نخورده می‌ماند.");
    return;
  }

  // merge + de-duplicate
  const byUrl = new Set();
  const byTitle = new Set();
  const items = collected
    .filter((it) => {
      if (byUrl.has(it.u)) return false;
      byUrl.add(it.u);
      const tk = (it.t || "").replace(/\s+/g, " ").trim();
      if (byTitle.has(tk)) return false;
      byTitle.add(tk);
      return true;
    })
    .sort((a, b) => (b.d ? Date.parse(b.d) : 0) - (a.d ? Date.parse(a.d) : 0))
    .slice(0, MAX_ITEMS);

  // ---- full text ----
  const cached = await existingArticles();
  const wanted = items
    .filter((it) => !cached.has(it.i))
    .slice(0, EXTRACT_LIMIT);

  console.log(`\nمتن کامل: ${wanted.length} خبر تازه برای استخراج (${cached.size} در کش)`);

  await mkdir(ART_DIR, { recursive: true });

  const perSource = {};
  const extracted = await pool(
    wanted.map((it) => async () => {
      const res = await extractArticle(it.u, { timeout: EXTRACT_TIMEOUT, headers: sourceHeaders(it.s) });
      const bucket = (perSource[it.s] ||= { ok: 0, fail: 0 });
      if (!res.ok) {
        bucket.fail++;
        return null;
      }
      bucket.ok++;
      const record = {
        u: it.u,
        t: it.t,
        img: res.img || it.img || "",
        by: res.by || "",
        text: res.text,
        at: new Date().toISOString(),
      };
      await writeFile(join(ART_DIR, `${it.i}.json`), JSON.stringify(record), "utf8");
      return it.i;
    }),
    EXTRACT_CONCURRENCY
  );

  for (const [id, b] of Object.entries(perSource)) {
    const name = SOURCES.find((s) => s.id === id)?.name || id;
    console.log(`  ${name}: ${b.ok} ok / ${b.fail} fail`);
  }

  // ---- housekeeping: drop bodies for items that fell off the list ----
  const keep = new Set(items.map((it) => it.i));
  let removed = 0;
  for (const id of cached) {
    if (!keep.has(id)) {
      try {
        await unlink(join(ART_DIR, `${id}.json`));
        removed++;
      } catch { /* ignore */ }
    }
  }
  if (removed) console.log(`  ${removed} فایل قدیمی پاک شد`);

  // ---- images: prefer the article's og:image when we have one ----
  const finalIds = new Set([...cached, ...extracted.filter(Boolean)]);
  const final = await Promise.all(
    items.map(async (it) => {
      let img = it.img;
      if (finalIds.has(it.i)) {
        const art = await readArticle(it.i);
        if (art?.img) img = art.img;
      }
      return { ...it, img, f: finalIds.has(it.i) ? 1 : 0 };
    })
  );

  const payload = {
    updatedAt: new Date().toISOString(),
    sources: status,
    items: final,
  };

  await mkdir("data", { recursive: true });
  await writeFile(NEWS, JSON.stringify(payload), "utf8");

  const full = final.filter((i) => i.f).length;
  console.log(
    `\nنوشته شد: ${final.length} تیتر از ${status.filter((s) => s.ok).length}/${SOURCES.length} منبع — ${full} با متن کامل`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
