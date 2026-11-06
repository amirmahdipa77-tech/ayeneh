/**
 * Article extractor.
 *
 * Pulls the readable body, the lead image and the byline out of a news page
 * using plain regex + a couple of heuristics. No DOM, no dependencies — it has
 * to survive a wide range of Persian newsroom templates.
 */

import { clean, decodeEntities, fetchText, unwrapCdata } from "./text.mjs";

const DROP_BLOCKS =
  /<(script|style|noscript|nav|footer|aside|form|iframe|svg|video|audio|button|select|figcaption)\b[\s\S]*?<\/\1>/gi;

const JUNK_LINE =
  /^(کد خبر|انتهای پیام|پایان پیام|بازگشت|اشتراک‌گذاری|کپی لینک|مطالب مرتبط|اخبار مرتبط|بیشتر بخوانید|منبع|تبلیغات|نظر شما|دیدگاه|لینک کوتاه|خبرنگار|تعداد بازدید|برچسب‌ها|برچسب|دسته‌بندی|تمامی حقوق|کلیه حقوق)\s*[:：]?/i;

const META_PATTERNS = {
  ogImage: [
    /<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ],
  ogTitle: [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
  ],
  description: [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  ],
  author: [
    /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i,
    /"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i,
  ],
  published: [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ],
};

/** Body containers used by most Iranian newsroom templates. */
const CONTAINER_HINTS = [
  "item-text", "news-text", "newsText", "article-body", "articleBody",
  "entry-content", "post-content", "single-content", "news-body", "body-news",
  "matn", "content-text", "story-body", "detail-content", "news_content",
  "text-news", "item-content", "bodyContent", "article__body",
];

function meta(html, key) {
  for (const re of META_PATTERNS[key]) {
    const m = html.match(re);
    if (m && m[1]) return clean(m[1]);
  }
  return "";
}

function absolute(url, base) {
  if (!url) return "";
  try {
    return new URL(decodeEntities(url.trim()), base).href;
  } catch {
    return "";
  }
}

/** Every leaf <p> on the page — the primary signal. */
function collectParagraphs(html) {
  const out = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = clean(m[1]);
    if (text.length >= 45) out.push(text);
  }
  return out;
}

/** Fallback: take the text of a known body container and split it into blocks. */
function containerParagraphs(html) {
  for (const hint of CONTAINER_HINTS) {
    const re = new RegExp(
      `<[a-z]+[^>]*(?:class|id)=["'][^"']*${hint}[^"']*["'][^>]*>([\\s\\S]*)`,
      "i"
    );
    const m = html.match(re);
    if (!m) continue;
    let seg = m[1].slice(0, 40000);
    // stop at the first trailing widget (related links, tags, comments…)
    seg = seg.replace(
      /<div[^>]*(?:class|id)=["'][^"']*(related|tags|comments|social|share|advert|banner)[^"']*["'][\s\S]*$/i,
      " "
    );
    const parts = seg
      .replace(/<br\s*\/?>/gi, "\u0000")
      .replace(/<\/(div|section|article|p|li|h2|h3)>/gi, "\u0000")
      .split("\u0000")
      .map((piece) => clean(piece))
      .filter((t) => t.length >= 45);
    if (parts.length) return parts;
  }
  return [];
}

function tidy(paras) {
  const seen = new Set();
  const out = [];
  for (const p of paras) {
    const t = p.replace(/\s+/g, " ").trim();
    if (t.length < 45) continue;
    if (JUNK_LINE.test(t) && t.length < 110) continue;
    if (/^(نوشته|نویسنده|مترجم|عکس|فیلم|ویدیو)\s*[:：]/.test(t) && t.length < 90) continue;
    const key = t.slice(0, 55);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t.length > 1600 ? t.slice(0, 1600) + "…" : t);
  }
  return out;
}

/** Split from the network call so it can be unit-tested offline. */
export function parseHtml(html, url) {
  const ogImage = absolute(meta(html, "ogImage"), url);
  const author = meta(html, "author");
  const published = meta(html, "published");

  const doc = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(DROP_BLOCKS, " ")
    .replace(/<header\b[\s\S]*?<\/header>/gi, " ");

  let paragraphs = tidy(collectParagraphs(doc));

  if (paragraphs.join(" ").length < 420) {
    const fromContainer = tidy(containerParagraphs(doc));
    if (fromContainer.join(" ").length > paragraphs.join(" ").length) {
      paragraphs = fromContainer;
    }
  }

  if (paragraphs.join(" ").length < 260) {
    const ld = doc.match(/"articleBody"\s*:\s*"([\s\S]{200,20000}?)"/);
    if (ld) {
      const body = clean(unwrapCdata(ld[1].replace(/\\n/g, "\n\n").replace(/\\"/g, '"')));
      const split = body.split(/\n{2,}/).map((s) => s.trim()).filter((s) => s.length >= 45);
      if (split.length) paragraphs = tidy(split);
    }
  }

  const text = paragraphs.join("\n\n");
  if (text.length < 220) {
    return { ok: false, error: "no body", img: ogImage, by: author.slice(0, 60) };
  }

  const byline = /\||خبرگزاری|اخبار ایران و جهان|news agency/i.test(author) || author.length > 40
    ? ""
    : author.slice(0, 60);

  return {
    ok: true,
    img: ogImage,
    by: byline,
    published: published || "",
    text: paragraphs,
    chars: text.length,
  };
}

export async function extractArticle(url, { timeout = 15000, headers = {} } = {}) {
  let html;
  try {
    html = await fetchText(url, { timeout, headers });
  } catch (err) {
    return { ok: false, error: err.message, status: err.status || 0 };
  }
  return parseHtml(html, url);
}

export { containerParagraphs, collectParagraphs };
