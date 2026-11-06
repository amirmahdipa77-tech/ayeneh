/* ═══════════════════════════════════════════════════════════
   آینه — app
   Vanilla JS. No framework, no build step.
   ═══════════════════════════════════════════════════════════ */
(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const CHUNK = 12;
  const AUTO_REFRESH = 5 * 60 * 1000;

  const TABS = [
    { id: "all", label: "همه" },
    { id: "iran", label: "ایران" },
    { id: "world", label: "جهان" },
    { id: "sport", label: "ورزش" },
    { id: "economy", label: "اقتصاد" },
    { id: "tech", label: "فناوری" },
  ];

  const LANGS = [
    { id: "en", label: "English", sub: "انگلیسی", dir: "ltr" },
    { id: "ar", label: "العربية", sub: "عربی", dir: "rtl" },
    { id: "tr", label: "Türkçe", sub: "ترکی", dir: "ltr" },
    { id: "de", label: "Deutsch", sub: "آلمانی", dir: "ltr" },
  ];

  const faNum = new Intl.NumberFormat("fa-IR");
  const faDate = new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" });
  const faDay = new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "long" });

  const state = {
    items: [],
    sources: [],
    sourceById: new Map(),
    tab: "all",
    hidden: new Set(),
    q: "",
    shown: 0,
    list: [],
    updatedAt: null,
    reader: null,       // current item
    readerEls: [],
    lang: null,
    translating: false,
  };

  /* ─────────── helpers ─────────── */

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

  const norm = (s) => String(s || "")
    .replace(/[\u064A]/g, "ی").replace(/[\u0643]/g, "ک")
    .replace(/[\u200c\u200f\u200e]/g, " ")
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase();

  const haptic = (ms = 8) => { try { navigator.vibrate?.(ms); } catch { /* noop */ } };

  function relTime(iso) {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "";
    const s = (Date.now() - t) / 1000;
    if (s < 90) return "همین حالا";
    const m = Math.round(s / 60);
    if (m < 60) return `${faNum.format(m)} دقیقه`;
    const h = Math.round(m / 60);
    if (h < 24) return `${faNum.format(h)} ساعت`;
    const d = Math.round(h / 24);
    if (d < 8) return `${faNum.format(d)} روز`;
    return faDay.format(new Date(t));
  }

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function ripple(e) {
    const host = e.currentTarget;
    if (!host || host.dataset.noRipple) return;
    const r = host.getBoundingClientRect();
    const size = Math.max(r.width, r.height);
    const span = document.createElement("span");
    span.className = "rip";
    span.style.width = span.style.height = `${size}px`;
    span.style.left = `${e.clientX - r.left - size / 2}px`;
    span.style.top = `${e.clientY - r.top - size / 2}px`;
    host.appendChild(span);
    setTimeout(() => span.remove(), 560);
  }

  /* ─────────── theme ─────────── */

  const savedTheme = localStorage.getItem("ay:theme");
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;

  $("#btn-theme").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme
      || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("ay:theme", next);
    haptic();
  });

  /* ─────────── tabs ─────────── */

  const tabsEl = $("#tabs");
  const indicator = $("#tab-indicator");

  TABS.forEach((t) => {
    const b = document.createElement("button");
    b.className = "tab";
    b.type = "button";
    b.dataset.id = t.id;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(t.id === state.tab));
    b.textContent = t.label;
    b.addEventListener("click", () => selectTab(t.id, b));
    b.addEventListener("pointerdown", ripple);
    tabsEl.appendChild(b);
  });

  function moveIndicator(btn) {
    if (!btn) return;
    indicator.style.left = `${btn.offsetLeft + 8}px`;
    indicator.style.width = `${btn.offsetWidth - 16}px`;
  }

  function selectTab(id, btn) {
    if (state.tab === id) return;
    state.tab = id;
    $$(".tab", tabsEl).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.id === id)));
    moveIndicator(btn || $(`.tab[data-id="${id}"]`, tabsEl));
    try {
      btn?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    } catch { /* older engines */ }
    haptic();
    window.scrollTo({ top: 0, behavior: "smooth" });
    refreshList();
  }

  /* ─────────── feed ─────────── */

  const feedEl = $("#feed");

  function matches(it) {
    if (state.tab !== "all" && it.c !== state.tab) return false;
    if (state.hidden.has(it.s)) return false;
    if (state.q) {
      const q = norm(state.q);
      if (!norm(it.t).includes(q) && !norm(it.x).includes(q)) return false;
    }
    return true;
  }

  function sourceName(id) {
    return state.sourceById.get(id)?.name || id;
  }

  function metaHTML(it, onImage) {
    const src = sourceName(it.s);
    const badge = it.f ? `<span class="badge">متن کامل</span>` : "";
    return `<div class="meta">
      <span class="src">${esc(src)}</span>
      <span class="sep">·</span>
      <span>${esc(relTime(it.d))}</span>
      ${badge}
    </div>`;
  }

  const imgOf = (it) => (typeof it.img === "string" ? it.img : "");
  const blurOf = (it) => (typeof it.blur === "string" && it.blur.startsWith("data:") ? it.blur : "");

  /** Placeholder for the image box: tiny blur if we have it, else the average colour. */
  function bgStyle(it) {
    const blur = blurOf(it);
    if (blur) return ` style="background-image:url('${blur}')"`;
    const col = typeof it.col === "string" && /^#[0-9a-f]{6}$/i.test(it.col) ? it.col : "";
    return col ? ` style="background-color:${col}"` : "";
  }

  const PAGE_BASE = new URL("./", location.href).href;
  const shareUrl = (it) => `${PAGE_BASE}a/${it.i}/`;

  /** One <img> with fixed dimensions (no layout shift), a blurred underlay and lazy loading. */
  function imgHTML(it, { eager = false, priority = false } = {}) {
    const src = imgOf(it);
    if (!src) return "";
    const w = Number(it.iw) || 640;
    const h = Number(it.ih) || 400;
    return `<img src="${esc(src)}" alt="" width="${w}" height="${h}" decoding="async" ${
      eager ? 'loading="eager"' : 'loading="lazy"'
    }${priority ? ' fetchpriority="high"' : ""} referrerpolicy="no-referrer">`;
  }

  const prefetched = new Set();
  function prefetchArticle(it) {
    if (!it || !it.f || prefetched.has(it.i)) return;
    prefetched.add(it.i);
    fetch(`data/articles/${it.i}.json`, { cache: "force-cache" }).catch(() => {});
  }

  function heroHTML(it) {
    return `<a class="hero" href="#/a/${it.i}" data-id="${it.i}">
      <div class="hero-media"${bgStyle(it)}>
        ${imgHTML(it, { eager: true, priority: true })}
      </div>
      <div class="hero-text">
        ${metaHTML(it, true)}
        <h2>${esc(it.t)}</h2>
      </div>
    </a>`;
  }

  function cardHTML(it) {
    const thumb = imgOf(it)
      ? `<div class="thumb"${bgStyle(it)}>${imgHTML(it)}</div>`
      : "";
    return `<a class="card" href="#/a/${it.i}" data-id="${it.i}">
      <div class="card-text">
        ${metaHTML(it)}
        <h3>${esc(it.t)}</h3>
        ${it.x ? `<p class="lead">${esc(it.x)}</p>` : ""}
      </div>
      ${thumb}
    </a>`;
  }

  function wideHTML(it) {
    return `<a class="card-wide" href="#/a/${it.i}" data-id="${it.i}">
      <div class="wide-media"${bgStyle(it)}>${imgHTML(it)}</div>
      <div class="wide-text">
        ${metaHTML(it)}
        <h3>${esc(it.t)}</h3>
        ${it.x ? `<p class="lead">${esc(it.x)}</p>` : ""}
      </div>
    </a>`;
  }

  function renderChunk() {
    const slice = state.list.slice(state.shown, state.shown + CHUNK);
    if (!slice.length) return;
    const html = slice.map((it, k) => {
      const index = state.shown + k;
      if (index === 0 && imgOf(it)) return heroHTML(it);
      if (imgOf(it) && index % 9 === 0) return wideHTML(it);
      return cardHTML(it);
    }).join("");
    feedEl.insertAdjacentHTML("beforeend", html);
    state.shown += slice.length;
  }

  function refreshList() {
    state.list = state.items.filter(matches);
    state.shown = 0;
    feedEl.innerHTML = "";
    if (!state.list.length) {
      feedEl.innerHTML = `<div class="empty">
        <strong>${state.q ? "چیزی پیدا نشد" : "هنوز خبری نیست"}</strong>
        ${state.q ? "عبارت دیگری را امتحان کنید." : "چند دقیقه بعد دوباره سر بزنید."}
      </div>`;
      return;
    }
    renderChunk();
  }

  // image load / fail handling (capture phase — load doesn't bubble)
  document.addEventListener("load", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG") return;
    img.classList.add("loaded");
  }, true);

  document.addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG") return;
    const host = img.parentElement;
    if (!host) return;

    const card = img.closest("[data-id]");
    const item = card && state.items.find((x) => x.i === card.dataset.id);
    const initial = item ? (sourceName(item.s) || "خ").trim().charAt(0) : "خ";

    img.remove();

    if (host.classList.contains("thumb")) {
      if (!host.querySelector(".fallback")) {
        const f = document.createElement("div");
        f.className = "fallback";
        f.textContent = initial;
        host.appendChild(f);
      }
      return;
    }
    if (host.classList.contains("reader-hero")) {
      host.remove();
      return;
    }
    host.classList.add("no-img");
    host.closest(".hero, .card-wide")?.classList.add("no-img");
  }, true);

  /* infinite scroll */
  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) renderChunk();
  }, { rootMargin: "600px 0px" }).observe($("#sentinel"));

  /* appbar shadow */
  addEventListener("scroll", () => {
    $("#appbar").classList.toggle("scrolled", scrollY > 6);
  }, { passive: true });

  /* pull to refresh */
  let ptrStart = null;
  addEventListener("touchstart", (e) => {
    if (scrollY <= 0 && !$("#reader").classList.contains("open")) ptrStart = e.touches[0].clientY;
  }, { passive: true });
  addEventListener("touchmove", (e) => {
    if (ptrStart == null) return;
    const dy = e.touches[0].clientY - ptrStart;
    if (dy > 70) { $("#ptr").classList.add("on"); }
  }, { passive: true });
  addEventListener("touchend", () => {
    if (ptrStart != null && $("#ptr").classList.contains("on")) {
      $("#ptr").classList.remove("on");
      loadData(true);
      haptic(14);
    }
    ptrStart = null;
  }, { passive: true });

  /* ─────────── search ─────────── */

  const searchWrap = $("#search-wrap");
  const qEl = $("#q");

  $("#btn-search").addEventListener("click", () => {
    const showing = !searchWrap.hidden;
    searchWrap.hidden = showing;
    if (!showing) {
      setTimeout(() => qEl.focus(), 60);
    } else if (state.q) {
      state.q = "";
      qEl.value = "";
      refreshList();
    }
    haptic();
  });

  let qTimer;
  qEl.addEventListener("input", () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      state.q = qEl.value.trim();
      refreshList();
    }, 170);
  });

  $("#q-clear").addEventListener("click", () => {
    qEl.value = "";
    state.q = "";
    refreshList();
    qEl.focus();
  });

  /* ─────────── sheets ─────────── */

  const scrim = $("#scrim");
  let openSheet = null;

  function showSheet(id) {
    const sheet = $(id);
    openSheet = sheet;
    scrim.hidden = false;
    sheet.hidden = false;
    requestAnimationFrame(() => {
      scrim.classList.add("on");
      sheet.classList.add("on");
    });
    haptic();
  }

  function hideSheets() {
    if (!openSheet) return;
    scrim.classList.remove("on");
    openSheet.classList.remove("on");
    const sheet = openSheet;
    openSheet = null;
    setTimeout(() => {
      sheet.hidden = true;
      scrim.hidden = true;
    }, 380);
  }

  scrim.addEventListener("click", hideSheets);

  /* source filter */
  $("#btn-filter").addEventListener("pointerdown", ripple);
  $("#btn-filter").addEventListener("click", () => {
    renderSources();
    showSheet("#sheet-filter");
  });

  $("#sources-all").addEventListener("click", () => {
    state.hidden.clear();
    renderSources();
    refreshList();
    haptic();
  });

  function renderSources() {
    const counts = new Map();
    for (const it of state.items) counts.set(it.s, (counts.get(it.s) || 0) + 1);
    const rows = state.sources
      .filter((s) => counts.get(s.id))
      .map((s) => {
        const on = !state.hidden.has(s.id);
        return `<div class="src-row ${on ? "on" : ""}" data-id="${esc(s.id)}">
          <span class="tick"><svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg></span>
          <span class="name">${esc(s.name)}</span>
          <span class="count">${faNum.format(counts.get(s.id))}</span>
        </div>`;
      }).join("");
    $("#sources-list").innerHTML = rows || `<p style="padding:20px;color:var(--faint)">منبعی نیست</p>`;
  }

  $("#sources-list").addEventListener("click", (e) => {
    const row = e.target.closest(".src-row");
    if (!row) return;
    const id = row.dataset.id;
    if (state.hidden.has(id)) state.hidden.delete(id);
    else state.hidden.add(id);
    row.classList.toggle("on");
    refreshList();
    haptic();
  });

  /* ─────────── reader ─────────── */

  const readerEl = $("#reader");
  const readerScroll = $("#reader-scroll");
  const readerBody = $("#reader-body");
  const readerBar = $("#reader-bar");
  const progressEl = $("#reader-progress");

  function articleHTML(it) {
    const img = imgOf(it)
      ? `<div class="reader-hero"${bgStyle(it)}>${imgHTML(it, { eager: true, priority: true })}</div>`
      : "";
    return `${img}
      <div class="reader-inner">
        <h1 class="reader-title" id="r-title">${esc(it.t)}</h1>
        <div class="reader-meta">
          <span class="src">${esc(sourceName(it.s))}</span>
          <span class="sep">·</span>
          <span>${esc(it.d ? faDate.format(new Date(it.d)) : "")}</span>
        </div>
        <div class="reader-text" id="r-text" dir="rtl">
          ${it.x ? `<p>${esc(it.x)}</p>` : ""}
          <div class="sk-inline" id="r-loading">
            <p style="opacity:.4">در حال خواندن متن کامل…</p>
          </div>
        </div>
      </div>`;
  }

  async function openReader(it, push = true) {
    state.reader = it;
    state.lang = null;
    state.translating = false;
    readerBody.innerHTML = articleHTML(it);
    readerScroll.scrollTop = 0;
    readerBar.classList.remove("solid");
    progressEl.style.width = "0%";
    $("#reader-actions").classList.remove("hide");
    $("#btn-original").hidden = true;
    $("#btn-source").href = it.u || shareUrl(it);
    $("#btn-translate").disabled = false;
    $("#btn-translate span").textContent = "ترجمه";

    readerEl.hidden = false;
    requestAnimationFrame(() => readerEl.classList.add("open"));

    if (push) {
      history.pushState({ article: it.i }, "", `#/a/${it.i}`);
    }

    document.body.style.overflow = "hidden";
    document.title = `${it.t.slice(0, 60)} — آینه`;

    // load the full body
    if (it.f) {
      try {
        const res = await fetch(`data/articles/${it.i}.json`, { cache: "force-cache" });
        if (!res.ok) throw new Error("missing");
        const art = await res.json();
        if (state.reader !== it) return;
        renderArticle(it, art);
      } catch {
        if (state.reader === it) renderNoBody(it);
      }
    } else {
      renderNoBody(it);
    }
  }

  function renderArticle(it, art) {
    const textEl = $("#r-text");
    if (!textEl) return;
    if (art.u) $("#btn-source").href = art.u;
    const paras = (art.text || []).filter(Boolean);
    textEl.innerHTML = paras.map((p) => `<p>${esc(p)}</p>`).join("");
    if (art.img && !$(".reader-hero img")) {
      // late image: prepend a hero
      readerBody.insertAdjacentHTML("afterbegin",
        `<div class="reader-hero"><img src="${esc(art.img)}" alt="" referrerpolicy="no-referrer"></div>`);
      $(".reader-inner")?.classList.add("has-hero");
    }
    state.readerEls = [$("#r-title"), ...$$("#r-text p")];
    state.readerOrig = state.readerEls.map((el) => el.textContent);
  }

  function renderNoBody(it) {
    const textEl = $("#r-text");
    if (!textEl) return;
    textEl.innerHTML = `${it.x ? `<p>${esc(it.x)}</p>` : ""}
      <div class="reader-note">
        متن کامل این خبر از سرورِ منبع در دسترس نبود (برخی سایت‌ها دسترسی خودکار را می‌بندند).
        <br>
        <button type="button" id="r-goto">خواندن در ${esc(sourceName(it.s))} ↗</button>
      </div>`;
    $("#r-goto")?.addEventListener("click", () => window.open(it.u, "_blank", "noopener"));
    state.readerEls = [$("#r-title"), ...$$("#r-text > p")];
    state.readerOrig = state.readerEls.map((el) => el.textContent);
    $("#btn-translate").disabled = !state.readerOrig[0];
  }

  function closeReader(push = false) {
    if (!state.reader) return;
    if (push) history.back();
    else if (location.hash.startsWith("#/a/")) history.replaceState(null, "", location.pathname);
    readerEl.classList.remove("open");
    document.body.style.overflow = "";
    document.title = "آینه — تیترهای خبر ایران و جهان";
    state.reader = null;
    setTimeout(() => { if (!state.reader) readerEl.hidden = true; }, 440);
  }

  $("#reader-back").addEventListener("click", () => closeReader(true));

  $("#reader-share").addEventListener("click", async () => {
    const it = state.reader;
    if (!it) return;
    const url = shareUrl(it);
    if (navigator.share) {
      try { await navigator.share({ title: it.t, url }); } catch { /* cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        toast("لینک کپی شد");
      } catch { toast("کپی نشد"); }
    }
  });

  readerScroll.addEventListener("scroll", () => {
    const max = readerScroll.scrollHeight - readerScroll.clientHeight;
    const p = max > 0 ? readerScroll.scrollTop / max : 0;
    progressEl.style.width = `${Math.min(p * 100, 100)}%`;
    readerBar.classList.toggle("solid", readerScroll.scrollTop > 60);
  }, { passive: true });

  /* swipe down to close */
  let dragStart = null;
  let dragY = 0;
  readerScroll.addEventListener("touchstart", (e) => {
    if (readerScroll.scrollTop <= 0) { dragStart = e.touches[0].clientY; dragY = 0; }
  }, { passive: true });
  readerScroll.addEventListener("touchmove", (e) => {
    if (dragStart == null) return;
    dragY = e.touches[0].clientY - dragStart;
    if (dragY > 0) {
      readerEl.classList.add("dragging");
      readerEl.style.transform = `translateY(${dragY}px)`;
    }
  }, { passive: true });
  readerScroll.addEventListener("touchend", () => {
    if (dragStart == null) return;
    readerEl.classList.remove("dragging");
    readerEl.style.transform = "";
    if (dragY > 130) closeReader(true);
    dragStart = null;
  }, { passive: true });

  /* warm the article JSON as soon as a finger lands on a card */
  feedEl.addEventListener("pointerdown", (e) => {
    const card = e.target.closest("[data-id]");
    if (!card) return;
    prefetchArticle(state.items.find((x) => x.i === card.dataset.id));
  }, { passive: true, capture: true });

  feedEl.addEventListener("pointerenter", (e) => {
    const card = e.target.closest?.("[data-id]");
    if (card) prefetchArticle(state.items.find((x) => x.i === card.dataset.id));
  }, { passive: true, capture: true });

  /* delegate card clicks */
  document.addEventListener("click", (e) => {
    const card = e.target.closest("[data-id]");
    if (!card || !card.matches(".hero, .card, .card-wide")) return;
    e.preventDefault();
    const it = state.items.find((x) => x.i === card.dataset.id);
    if (it) {
      haptic(6);
      openReader(it);
    }
  });

  /* ─────────── translation ─────────── */

  const LANG_LABEL = { en: "انگلیسی", ar: "عربی", tr: "ترکی", de: "آلمانی" };

  $("#btn-translate").addEventListener("click", () => {
    if (!state.reader) return;
    renderLangs();
    showSheet("#sheet-lang");
  });

  $("#btn-original").addEventListener("click", () => {
    if (!state.readerEls.length) return;
    state.readerEls.forEach((el, i) => {
      el.textContent = state.readerOrig[i];
      el.dir = "rtl";
    });
    $("#r-text")?.setAttribute("dir", "rtl");
    $("#btn-original").hidden = true;
    $("#btn-translate span").textContent = "ترجمه";
    state.lang = null;
    haptic();
  });

  function renderLangs() {
    $("#lang-list").innerHTML = LANGS.map((l) => `
      <button class="lang-btn ${state.lang === l.id ? "on" : ""}" type="button" data-lang="${l.id}">
        ${l.label}<small>${l.sub}</small>
      </button>`).join("");
  }

  $("#lang-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-lang]");
    if (!btn) return;
    hideSheets();
    setTimeout(() => translateTo(btn.dataset.lang), 260);
  });

  async function translateTo(lang) {
    if (!state.readerEls.length || state.translating) return;
    const meta = LANGS.find((l) => l.id === lang);
    state.lang = lang;
    state.translating = true;

    const btn = $("#btn-translate");
    btn.disabled = true;
    const textEl = $("#r-text");
    textEl?.classList.add("translating");
    textEl?.setAttribute("dir", meta.dir);

    const total = state.readerEls.length;
    let done = 0;
    let failures = 0;

    const jobs = state.readerEls.map((el) => async () => {
      const original = el.textContent;
      const cached = cacheGet(lang, original);
      let out = cached;
      if (!out) {
        try {
          out = await translateText(original, lang);
          if (out) cacheSet(lang, original, out);
        } catch {
          failures++;
        }
      }
      if (out) {
        el.textContent = out;
        el.dir = meta.dir;
      }
      done++;
      btn.querySelector("span").textContent = `${faNum.format(Math.round((done / total) * 100))}٪`;
    });

    // small concurrency window so the UI stays responsive
    const queue = [...jobs];
    const workers = Array.from({ length: 3 }, async () => {
      while (queue.length) await queue.shift()();
    });
    await Promise.all(workers);

    textEl?.classList.remove("translating");
    state.translating = false;
    btn.disabled = false;

    if (failures && failures === total) {
      btn.querySelector("span").textContent = "ترجمه";
      toast("ترجمه در دسترس نیست؛ اتصال را بررسی کنید");
      return;
    }
    btn.querySelector("span").textContent = `ترجمه‌شده · ${LANG_LABEL[lang]}`;
    $("#btn-original").hidden = false;
    toast(`ترجمه به ${LANG_LABEL[lang]}`);
  }

  /* — provider chain — */

  const PROXIES = [
    (text, tl) => `https://translate.googleapis.com/translate_a/single?client=gtx&sl=fa&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`,
    (text, tl) => `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=fa&tl=${tl}&q=${encodeURIComponent(text)}`,
    (text, tl) => `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=fa|${tl}`,
  ];

  function flatten(data) {
    if (typeof data === "string") return data.trim();
    if (Array.isArray(data)) {
      if (Array.isArray(data[0])) {
        return data[0].map((seg) => (Array.isArray(seg) ? seg[0] || "" : String(seg || ""))).join("").trim();
      }
      return data.map((x) => String(x ?? "")).join(" ").trim();
    }
    return "";
  }

  async function translateText(text, lang) {
    const chunks = splitChunks(text, 850);
    const out = [];
    for (const chunk of chunks) {
      let translated = "";
      for (const build of PROXIES) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 9000);
          const res = await fetch(build(chunk, lang), { signal: ctrl.signal });
          clearTimeout(timer);
          if (!res.ok) continue;
          const data = await res.json();
          translated = data?.responseData?.translatedText || flatten(data);
          if (translated && translated.length > 1) break;
        } catch { /* try next provider */ }
      }
      if (!translated) throw new Error("translate failed");
      out.push(translated);
    }
    return out.join(" ");
  }

  function splitChunks(text, size) {
    if (text.length <= size) return [text];
    const parts = [];
    let rest = text;
    while (rest.length > size) {
      let cut = rest.lastIndexOf(". ", size);
      if (cut < size * 0.5) cut = rest.lastIndexOf("، ", size);
      if (cut < size * 0.5) cut = rest.lastIndexOf(" ", size);
      if (cut < size * 0.4) cut = size;
      parts.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) parts.push(rest);
    return parts;
  }

  const cacheKey = (lang, text) => `ay:tr:${lang}:${text.length}:${hashStr(text)}`;

  function cacheGet(lang, text) {
    try { return localStorage.getItem(cacheKey(lang, text)) || ""; } catch { return ""; }
  }

  function cacheSet(lang, text, value) {
    try {
      if (value.length > 4000) return;
      localStorage.setItem(cacheKey(lang, text), value);
    } catch { /* quota */ }
  }

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /* ─────────── router ─────────── */

  addEventListener("popstate", () => {
    const m = location.hash.match(/^#\/a\/(.+)$/);
    if (m) {
      const it = state.items.find((x) => x.i === m[1]);
      if (it && state.reader?.i !== it.i) openReader(it, false);
    } else if (state.reader) {
      closeReader(false);
    }
  });

  /* ─────────── data ─────────── */

  function skeleton() {
    feedEl.innerHTML = Array.from({ length: 6 }).map(() => `
      <div class="sk">
        <div class="lines">
          <div class="bar" style="width:28%;height:9px"></div>
          <div class="bar" style="width:94%"></div>
          <div class="bar" style="width:72%"></div>
        </div>
        <div class="thumb-sk"></div>
      </div>`).join("");
  }

  async function loadData(quiet) {
    if (!quiet) skeleton();
    $("#ptr").classList.add("on");
    try {
      const res = await fetch(`data/news.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();

      state.items = (data.items || []).filter((it) => it && it.t && it.u);
      state.sources = data.sources || [];
      state.sourceById = new Map(state.sources.map((s) => [s.id, s]));
      state.updatedAt = data.updatedAt || null;

      refreshList();
      renderFoot();

      // quietly warm the first few articles once the feed is on screen
      setTimeout(() => state.list.slice(0, 3).forEach(prefetchArticle), 1200);

      // deep link
      const m = location.hash.match(/^#\/a\/(.+)$/);
      if (m && !state.reader) {
        const it = state.items.find((x) => x.i === m[1]);
        if (it) openReader(it, false);
      }
    } catch (err) {
      feedEl.innerHTML = `<div class="empty"><strong>بارگذاری نشد</strong>
        اتصال اینترنت را بررسی کنید و صفحه را دوباره باز کنید.</div>`;
      console.warn(err);
    } finally {
      $("#ptr").classList.remove("on");
    }
  }

  function renderFoot() {
    const live = new Set(state.items.map((i) => i.s)).size;
    const when = state.updatedAt
      ? faDate.format(new Date(state.updatedAt))
      : "—";
    $("#foot").innerHTML = `
      <div>${faNum.format(state.items.length)} تیتر از ${faNum.format(live)} منبع · آخرین به‌روزرسانی ${when}</div>
      <div style="margin-top:6px">داده‌ها از فید رسمی هر خبرگزاری خوانده می‌شود · میزبانی روی GitHub Pages</div>`;
  }

  /* auto refresh when the tab wakes up */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !state.updatedAt) return;
    if (Date.now() - Date.parse(state.updatedAt) > AUTO_REFRESH) loadData(true);
  });

  /* ─────────── boot ─────────── */

  const firstTab = $('.tab[data-id="all"]', tabsEl);
  requestAnimationFrame(() => moveIndicator(firstTab));
  addEventListener("resize", () => moveIndicator($('.tab[aria-selected="true"]', tabsEl)));

  loadData(false);

  /* offline shell — only over https, and never in a local file preview */
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
