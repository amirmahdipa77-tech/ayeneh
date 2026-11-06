/**
 * SEO + distribution artefacts.
 *
 * A hash-router SPA is invisible to crawlers, so every article that has a
 * body also gets a small static page at /a/<id>/ with real content, Open
 * Graph tags and NewsArticle structured data. Those pages feed sitemap.xml
 * and the site's own RSS feed.
 */

export const BASE = "https://amirmahdipa77-tech.github.io/ayeneh/";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

const absolute = (src) => (!src ? "" : /^https?:/i.test(src) ? src : BASE + String(src).replace(/^\.?\//, ""));

const PAGE_CSS = `:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;background:#fafaf9;color:#121212;font-family:Vazirmatn,-apple-system,"Segoe UI",Tahoma,sans-serif;line-height:1.9}
main{max-width:680px;margin:0 auto;padding:20px 18px 60px}
a{color:#121212;text-decoration:none;border-bottom:1px solid #d8d8d6}
img{width:100%;border-radius:18px;display:block;margin:0 0 18px}
h1{font-size:26px;line-height:1.55;margin:14px 0 10px;letter-spacing:-.3px}
.meta{font-size:13px;color:#6d6d6d;border-bottom:1px solid #e8e8e6;padding-bottom:14px;margin-bottom:18px}
.meta b{color:#121212;font-weight:650}
p{margin:0 0 18px;font-size:16.5px}
.back{display:inline-block;margin-top:26px;font-weight:700;font-size:14px}
@media (prefers-color-scheme:dark){body{background:#0c0c0c;color:#ededed}
.meta{color:#949494;border-color:#232323}a{color:#ededed;border-color:#3a3a3a}}`;

export function articlePage({ item, art, sourceName, siteName = "آینه" }) {
  const url = `${BASE}a/${item.i}/`;
  const img = absolute(art.img || item.img);
  const desc = (item.x || art.text?.[0] || "").slice(0, 180);
  const date = item.d || art.at || new Date().toISOString();

  const ld = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: item.t,
    description: desc,
    image: img ? [img] : undefined,
    datePublished: date,
    dateModified: date,
    inLanguage: "fa",
    isAccessibleForFree: true,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    author: { "@type": "Organization", name: sourceName },
    publisher: { "@type": "Organization", name: siteName },
  };

  const body = (art.text || []).map((p) => `<p>${esc(p)}</p>`).join("\n");

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(item.t)} — ${esc(sourceName)} | ${esc(siteName)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${esc(siteName)}">
<meta property="og:title" content="${esc(item.t)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
${img ? `<meta property="og:image" content="${esc(img)}">` : ""}
<meta property="article:published_time" content="${esc(date)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${BASE}favicon.svg" type="image/svg+xml">
<style>${PAGE_CSS}</style>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
<main>
${img ? `<img src="${esc(img)}" alt="" width="${art.iw || 640}" height="${art.ih || 400}">` : ""}
<h1>${esc(item.t)}</h1>
<p class="meta"><b>${esc(sourceName)}</b> · <time datetime="${esc(date)}">${esc(date.slice(0, 10))}</time></p>
${body}
<a class="back" href="${BASE}">همهٔ تیترها در آینه ←</a>
</main>
</body>
</html>`;
}

export function sitemap(items) {
  const urls = items
    .filter((it) => it.f)
    .map((it) => `  <url><loc>${BASE}a/${it.i}/</loc>${it.d ? `<lastmod>${it.d.slice(0, 10)}</lastmod>` : ""}<changefreq>weekly</changefreq></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${BASE}</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>
${urls}
</urlset>
`;
}

export const robots = `User-agent: *
Allow: /

Sitemap: ${BASE}sitemap.xml
`;

export function rssFeed(items, sources, updatedAt) {
  const nameOf = new Map(sources.map((s) => [s.id, s.name]));
  const rows = items
    .filter((it) => it.f)
    .slice(0, 60)
    .map((it) => `    <item>
      <title>${esc(it.t)}</title>
      <link>${BASE}a/${it.i}/</link>
      <guid isPermaLink="true">${BASE}a/${it.i}/</guid>
      <dc:creator>${esc(nameOf.get(it.s) || "")}</dc:creator>
      ${it.d ? `<pubDate>${new Date(it.d).toUTCString()}</pubDate>` : ""}
      <description>${esc(it.x || "")}</description>
    </item>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>آینه — تیترهای خبر ایران و جهان</title>
    <link>${BASE}</link>
    <description>تیترهای تازه خبرگزاری‌های ایران و جهان، با متن کامل و ترجمه.</description>
    <language>fa</language>
    <lastBuildDate>${new Date(updatedAt).toUTCString()}</lastBuildDate>
${rows}
  </channel>
</rss>
`;
}
