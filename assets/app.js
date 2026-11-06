/* آینه — خوانندهٔ سبک فیدهای خبری */
(() => {
  "use strict";

  const PAGE = 24;
  const AUTO_REFRESH_MS = 5 * 60 * 1000;

  const $ = (sel) => document.querySelector(sel);
  const listEl = $("#list");
  const chipsEl = $("#chips");
  const statusEl = $("#status");
  const emptyEl = $("#empty");
  const moreEl = $("#more");
  const footEl = $("#foot-line");
  const qEl = $("#q");
  const refreshEl = $("#refresh");
  const themeEl = $("#theme");

  const faNum = new Intl.NumberFormat("fa-IR");
  const faFullDate = new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "full",
    timeStyle: "short",
  });

  const state = {
    items: [],
    sources: new Map(),
    source: "all",
    q: "",
    shown: 0,
    updatedAt: null,
  };

  /* ---------- helpers ---------- */

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));

  const norm = (s) =>
    String(s || "")
      .replace(/[\u064A\u06CC]/g, "ی")
      .replace(/[\u0643\u06A9]/g, "ک")
      .replace(/[\u200c\u200f\u200e]/g, " ")
      .replace(/[\u064B-\u0652\u0640]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  function relTime(iso) {
    if (!iso) return "";
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return "";
    const s = (Date.now() - t) / 1000;
    if (s < 90) return "همین حالا";
    const m = Math.round(s / 60);
    if (m < 60) return `${faNum.format(m)} دقیقه پیش`;
    const h = Math.round(m / 60);
    if (h < 24) return `${faNum.format(h)} ساعت پیش`;
    const d = Math.round(h / 24);
    if (d < 8) return `${faNum.format(d)} روز پیش`;
    return new Intl.DateTimeFormat("fa-IR", {
      day: "numeric",
      month: "long",
    }).format(new Date(t));
  }

  function fullDate(iso) {
    const t = new Date(iso).getTime();
    return Number.isNaN(t) ? "" : faFullDate.format(new Date(t));
  }

  /* ---------- theme ---------- */

  const savedTheme = localStorage.getItem("ayeneh-theme");
  if (savedTheme === "light" || savedTheme === "dark") {
    document.documentElement.dataset.theme = savedTheme;
  }

  themeEl.addEventListener("click", () => {
    const cur =
      document.documentElement.dataset.theme ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("ayeneh-theme", next);
  });

  /* ---------- filtering & rendering ---------- */

  function visible() {
    const q = norm(state.q);
    return state.items.filter((it) => {
      if (state.source !== "all" && it.s !== state.source) return false;
      if (!q) return true;
      return norm(it.t).includes(q) || norm(it.x).includes(q);
    });
  }

  function itemHTML(it) {
    const src = state.sources.get(it.s);
    const name = src ? src.name : it.s;
    const time = relTime(it.d);
    const when = it.d ? fullDate(it.d) : "";
    return `<li class="item">
      <a href="${esc(it.u)}" target="_blank" rel="noopener noreferrer"${when ? ` title="${esc(when)}"` : ""}>
        <div class="meta">
          <span class="src">${esc(name)}</span>
          ${time ? `<span class="dot">·</span><time datetime="${esc(it.d || "")}">${esc(time)}</time>` : ""}
        </div>
        <h2 class="title">${esc(it.t)}</h2>
        ${it.x ? `<p class="lead">${esc(it.x)}</p>` : ""}
      </a>
    </li>`;
  }

  function render(reset) {
    const rows = visible();
    if (reset) state.shown = 0;
    const next = rows.slice(state.shown, state.shown + PAGE);
    if (reset) listEl.innerHTML = "";
    listEl.insertAdjacentHTML("beforeend", next.map(itemHTML).join(""));
    state.shown += next.length;

    emptyEl.hidden = rows.length > 0;
    moreEl.hidden = state.shown >= rows.length;
    if (rows.length === 0) {
      emptyEl.textContent = state.q
        ? "چیزی با این جست‌وجو پیدا نشد."
        : "هنوز خبری خوانده نشده است. چند دقیقه بعد دوباره سر بزنید.";
    }
  }

  function renderChips() {
    const counts = new Map();
    for (const it of state.items) counts.set(it.s, (counts.get(it.s) || 0) + 1);

    const live = [...state.sources.values()]
      .filter((s) => counts.get(s.id))
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

    const chip = (id, label, n) =>
      `<button class="chip" role="tab" data-id="${esc(id)}" aria-selected="${
        state.source === id
      }">${esc(label)}${n != null ? ` <span style="opacity:.5">${faNum.format(n)}</span>` : ""}</button>`;

    chipsEl.innerHTML =
      chip("all", "همه", state.items.length) +
      live.map((s) => chip(s.id, s.name, counts.get(s.id))).join("");
  }

  function renderStatus() {
    if (!state.updatedAt) {
      statusEl.textContent = "";
      return;
    }
    const d = new Date(state.updatedAt);
    const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    const ago = mins < 1 ? "همین حالا" : mins < 60
      ? `${faNum.format(mins)} دقیقه پیش`
      : `${faNum.format(Math.round(mins / 60))} ساعت پیش`;
    const liveSources = new Set(state.items.map((it) => it.s)).size;
    statusEl.textContent = `آخرین به‌روزرسانی: ${ago} · ${faNum.format(
      state.items.length
    )} تیتر از ${faNum.format(liveSources)} منبع`;
  }

  /* ---------- data ---------- */

  function skeleton() {
    listEl.innerHTML = Array.from({ length: 5 })
      .map(() => `<li class="sk"><i></i><i></i><i></i></li>`)
      .join("");
  }

  async function load(quiet) {
    if (!quiet) skeleton();
    refreshEl.classList.add("spin");
    try {
      const res = await fetch(`data/news.json?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      state.sources = new Map(
        (data.sources || []).map((s, i) => [s.id, { ...s, order: i }])
      );
      state.items = (data.items || []).filter((it) => it && it.t && it.u);
      state.updatedAt = data.updatedAt || null;

      renderChips();
      renderStatus();
      render(true);
    } catch (err) {
      listEl.innerHTML = "";
      emptyEl.hidden = false;
      emptyEl.textContent =
        "داده‌ها بارگذاری نشد. اتصال را بررسی کنید و دوباره تلاش کنید.";
      statusEl.textContent = "";
      moreEl.hidden = true;
      console.warn(err);
    } finally {
      refreshEl.classList.remove("spin");
    }
  }

  /* ---------- events ---------- */

  chipsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    state.source = btn.dataset.id;
    [...chipsEl.children].forEach((c) =>
      c.setAttribute("aria-selected", String(c === btn))
    );
    render(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  let qTimer;
  qEl.addEventListener("input", () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      state.q = qEl.value;
      render(true);
    }, 160);
  });

  moreEl.addEventListener("click", () => render(false));
  refreshEl.addEventListener("click", () => load(false));

  // refresh quietly when the tab becomes visible again
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !state.updatedAt) return;
    if (Date.now() - new Date(state.updatedAt).getTime() > AUTO_REFRESH_MS) {
      load(true);
    }
  });

  setInterval(() => {
    if (document.visibilityState === "visible") load(true);
    else renderStatus();
  }, AUTO_REFRESH_MS);

  footEl.textContent =
    "آینه · میزبانی روی GitHub Pages · داده‌ها از فید رسمی هر خبرگزاری";

  load(false);
})();
