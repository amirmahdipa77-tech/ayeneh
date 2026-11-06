/* ═══════════════════════════════════════════════
   devkit — everything runs in your browser
   ═══════════════════════════════════════════════ */
(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const fa = new Intl.NumberFormat("fa-IR");

  const state = { ip: null, provider: "", v6: "", lookups: 0 };

  /* ───────── utilities ───────── */

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 1900);
  }

  async function copy(text, label = "کپی شد") {
    try {
      await navigator.clipboard.writeText(text);
      toast(label);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast(label);
    }
  }

  async function api(url, { timeout = 9000, headers = {} } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  const flagEmoji = (cc) => (cc || "").toUpperCase().replace(/./g, (c) =>
    String.fromCodePoint(127397 + c.charCodeAt(0)));

  const isIPv4 = (s) => /^(\d{1,3}\.){3}\d{1,3}$/.test(s) && s.split(".").every((n) => +n < 256);
  const isIPv6 = (s) => s.includes(":") && /^[0-9a-f:]+$/i.test(s);

  /* ───────── theme ───────── */

  const saved = localStorage.getItem("dk:theme");
  if (saved) document.documentElement.dataset.theme = saved;

  $("#btn-theme").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme
      || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("dk:theme", next);
  });

  /* ───────── my ip ───────── */

  const IP_FIELDS = [
    ["کشور", (d) => d.country],
    ["شهر", (d) => d.city],
    ["ISP", (d) => d.isp],
    ["ASN", (d) => d.asn],
    ["منطقهٔ زمانی", (d) => d.tz],
    ["مختصات", (d) => (d.lat != null ? `${(+d.lat).toFixed(3)}, ${(+d.lon).toFixed(3)}` : "")],
    ["شبکه", (d) => d.network],
    ["ارز", (d) => d.currency],
  ];

  function normalizeWho(d) {
    return {
      ip: d.ip,
      type: d.type || (d.ip?.includes(":") ? "IPv6" : "IPv4"),
      country: d.country, code: d.country_code,
      flag: d.flag?.emoji || flagEmoji(d.country_code),
      region: d.region, city: d.city, postal: d.postal,
      lat: d.latitude, lon: d.longitude,
      asn: d.connection?.asn ? `AS${d.connection.asn}` : "",
      org: d.connection?.org, isp: d.connection?.isp, domain: d.connection?.domain,
      tz: d.timezone?.id, utc: d.timezone?.utc,
      network: d.connection?.domain || "",
      currency: "",
    };
  }

  function normalizeIpapi(d) {
    return {
      ip: d.ip,
      type: d.version || (d.ip?.includes(":") ? "IPv6" : "IPv4"),
      country: d.country_name, code: d.country_code,
      flag: flagEmoji(d.country_code),
      region: d.region, city: d.city, postal: d.postal,
      lat: d.latitude, lon: d.longitude,
      asn: d.asn || "", org: d.org, isp: d.org, domain: "",
      tz: d.timezone, utc: d.utc_offset,
      network: d.network || "",
      currency: d.currency ? `${d.currency}${d.currency_name ? ` · ${d.currency_name}` : ""}` : "",
    };
  }

  function renderIp(d) {
    state.ip = d;
    $("#my-ip").textContent = d.ip || "—";

    const where = [d.city, d.region, d.country].filter(Boolean).join("، ");
    $("#ip-sub").innerHTML = [
      d.code ? `<span class="cc mono">${d.code}</span>` : "",
      where ? `<span>${where}</span>` : "",
      d.org ? `<span style="color:var(--faint)">·</span><span class="mono" style="font-size:12.5px">${d.org}</span>` : "",
    ].join("");

    $("#ip-grid").innerHTML = IP_FIELDS.map(([label, get]) => {
      const value = get(d) || "—";
      return `<div><dt>${label}</dt><dd title="${String(value).replace(/"/g, "&quot;")}">${value}</dd></div>`;
    }).join("");

    $("#map-link").href = d.lat != null
      ? `https://www.openstreetmap.org/?mlat=${d.lat}&mlon=${d.lon}#map=11/${d.lat}/${d.lon}`
      : "#";
    $("#ip-provider").textContent = state.provider;
    $("#ip-v6").textContent = state.v6 ? `IPv6: ${state.v6}` : "";
  }

  async function loadIp() {
    $("#reload-ip").classList.add("spin");
    $("#ip-sub").innerHTML = `<span class="skeleton-line"></span>`;
    try {
      let d = null;
      try {
        const r = await api("https://ipwho.is/");
        if (r && r.success !== false && r.ip) { d = normalizeWho(r); state.provider = "ipwho.is"; }
      } catch { /* next */ }

      if (!d) {
        try {
          const r = await api("https://ipapi.co/json/");
          if (r && !r.error && r.ip) { d = normalizeIpapi(r); state.provider = "ipapi.co"; }
        } catch { /* next */ }
      }

      if (!d) {
        try {
          const r = await api("https://api64.ipify.org?format=json");
          d = { ip: r.ip, type: r.ip.includes(":") ? "IPv6" : "IPv4" };
          state.provider = "ipify";
        } catch { /* give up */ }
      }

      if (!d) {
        $("#ip-sub").textContent = "دریافت آی‌پی ممکن نشد — اتصال یا مسدودسازی مرورگر را بررسی کنید.";
        return;
      }
      renderIp(d);
    } finally {
      $("#reload-ip").classList.remove("spin");
    }

    // is there a second (v6) address?
    api("https://api64.ipify.org?format=json", { timeout: 6000 })
      .then((r) => {
        if (r.ip && r.ip !== state.ip?.ip && r.ip.includes(":")) {
          state.v6 = r.ip;
          $("#ip-v6").textContent = `IPv6: ${r.ip}`;
        }
      })
      .catch(() => {});
  }

  $("#reload-ip").addEventListener("click", loadIp);
  $("#copy-ip").addEventListener("click", () => state.ip?.ip && copy(state.ip.ip, "آی‌پی کپی شد"));
  $("#copy-json").addEventListener("click", () => {
    if (!state.ip) return;
    copy(JSON.stringify(state.ip, null, 2), "JSON کپی شد");
  });

  /* ───────── ip / domain lookup ───────── */

  function resultTable(rows) {
    return `<dl class="kv">${rows
      .filter(([, v]) => v !== "" && v != null)
      .map(([k, v]) => `<dt>${k}</dt><dd>${String(v).replace(/</g, "&lt;")}</dd>`)
      .join("")}</dl>`;
  }

  async function geoFor(ip) {
    try {
      const r = await api(`https://ipwho.is/${encodeURIComponent(ip)}`);
      if (r && r.success !== false && r.ip) return { data: normalizeWho(r), provider: "ipwho.is" };
    } catch { /* next */ }
    const r = await api(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
    if (r && !r.error) return { data: normalizeIpapi(r), provider: "ipapi.co" };
    throw new Error("not found");
  }

  async function doh(name, type) {
    const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
    const res = await fetch(url, { headers: { accept: "application/dns-json" }, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  const DNS_STATUS = { 0: "NOERROR", 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN", 5: "REFUSED" };

  $("#lookup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("#lookup-input").value.trim();
    const out = $("#lookup-out");
    if (!q) return;

    out.hidden = false;
    out.innerHTML = `<span class="skeleton-line"></span>`;

    try {
      let ip = q;
      let note = "";

      if (!isIPv4(q) && !isIPv6(q)) {
        const dns = await doh(q, "A");
        const a = (dns.Answer || []).find((r) => r.type === 1) || (dns.Answer || [])[0];
        if (!a) throw new Error("دامنه حل نشد");
        ip = a.data;
        note = `دامنه <b class="mono">${q}</b> ← <span class="mono">${ip}</span>`;
      }

      const { data, provider } = await geoFor(ip);
      const rows = [
        ["IP", data.ip],
        ["نوع", data.type],
        ["کشور", [data.country, data.code].filter(Boolean).join(" · ")],
        ["استان", data.region],
        ["شهر", data.city],
        ["کد پستی", data.postal],
        ["مختصات", data.lat != null ? `${data.lat}, ${data.lon}` : ""],
        ["ISP", data.isp],
        ["سازمان", data.org !== data.isp ? data.org : ""],
        ["ASN", data.asn],
        ["شبکه", data.network],
        ["منطقهٔ زمانی", data.tz ? `${data.tz} (UTC${data.utc || ""})` : ""],
        ["ارز", data.currency],
      ];

      out.innerHTML = `
        ${note ? `<p class="out-line">${note}</p>` : ""}
        ${resultTable(rows)}
        <div class="row" style="margin-top:10px">
          <a class="btn btn-sm" href="https://www.openstreetmap.org/?mlat=${data.lat}&mlon=${data.lon}#map=11/${data.lat}/${data.lon}"
             target="_blank" rel="noopener">نقشه</a>
          <button class="btn btn-sm" id="lookup-copy" type="button">کپی JSON</button>
          <span class="hint">${provider}</span>
        </div>`;

      $("#lookup-copy").addEventListener("click", () => copy(JSON.stringify(data, null, 2), "JSON کپی شد"));
    } catch (err) {
      out.innerHTML = `<p class="out-line bad">پیدا نشد یا سرویس جواب نداد (${err.message}). یک IPv4 معتبر امتحان کنید.</p>`;
    }
  });

  $("#lookup-samples").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ip]");
    if (!b) return;
    $("#lookup-input").value = b.dataset.ip;
    $("#lookup-form").requestSubmit();
  });

  /* ───────── dns ───────── */

  $("#dns-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#dns-input").value.trim();
    const type = $("#dns-type").value;
    const out = $("#dns-out");
    if (!name) return;

    out.hidden = false;
    out.innerHTML = `<span class="skeleton-line"></span>`;

    try {
      const data = await doh(name, type);
      const answers = data.Answer || [];
      const status = DNS_STATUS[data.Status] || `Status ${data.Status}`;

      if (!answers.length) {
        out.innerHTML = `<p class="out-line">رکوردی از نوع <b class="mono">${type}</b> برای
          <b class="mono">${name}</b> پیدا نشد — وضعیت: <span class="mono">${status}</span></p>`;
        return;
      }

      out.innerHTML = `
        <p class="out-line ok">${answers.length} رکورد · وضعیت ${status}</p>
        <dl class="kv">${answers.map((a) => `
          <dt class="mono">${type} · ${a.TTL}s</dt>
          <dd>${String(a.data).replace(/</g, "&lt;")}</dd>`).join("")}</dl>
        <div class="row" style="margin-top:10px">
          <button class="btn btn-sm" id="dns-copy" type="button">کپی JSON</button>
        </div>`;
      $("#dns-copy").addEventListener("click", () => copy(JSON.stringify(data, null, 2), "JSON کپی شد"));
    } catch (err) {
      out.innerHTML = `<p class="out-line bad">خطا در دریافت DNS (${err.message}).</p>`;
    }
  });

  /* ───────── tools ───────── */

  const tabs = $("#tool-tabs");
  tabs.addEventListener("click", (e) => {
    const b = e.target.closest(".seg");
    if (!b) return;
    $$(".seg", tabs).forEach((s) => s.setAttribute("aria-selected", String(s === b)));
    $$(".tool").forEach((t) => { t.hidden = t.id !== `tool-${b.dataset.tool}`; });
  });

  const msg = (el, text, kind = "") => {
    el.textContent = text;
    el.className = `out-line ${kind}`;
  };

  /* json */
  $("#json-in").addEventListener("input", () => {
    const v = $("#json-in").value.trim();
    if (!v) return msg($("#json-msg"), "");
    try {
      const parsed = JSON.parse(v);
      const n = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length;
      msg($("#json-msg"), `JSON معتبر — ${Array.isArray(parsed) ? "آرایه" : "آبجکت"} با ${fa.format(n)} عضو`, "ok");
    } catch (err) {
      msg($("#json-msg"), `نامعتبر: ${err.message}`, "bad");
    }
  });

  document.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    const ta = { json: "#json-in", b64: "#b64-in", url: "#url-in" }[act.split("-")[0]];

    if (act === "json-format" || act === "json-minify") {
      const el = $("#json-in");
      try {
        const obj = JSON.parse(el.value);
        el.value = act === "json-format" ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
        msg($("#json-msg"), act === "json-format" ? "مرتب شد" : "فشرده شد", "ok");
      } catch (err) {
        msg($("#json-msg"), `نامعتبر: ${err.message}`, "bad");
      }
      return;
    }

    if (act === "json-clear" || act === "b64-clear" || act === "url-clear") {
      $(ta).value = "";
      msg($(`#${act.split("-")[0]}-msg`), "");
      return;
    }

    if (act === "b64-enc" || act === "b64-dec") {
      const el = $("#b64-in");
      try {
        el.value = act === "b64-enc" ? b64encode(el.value) : b64decode(el.value);
        msg($("#b64-msg"), act === "b64-enc" ? "کدگذاری شد" : "کدگشایی شد", "ok");
      } catch {
        msg($("#b64-msg"), "رشتهٔ base64 معتبر نیست", "bad");
      }
      return;
    }

    if (act === "url-enc" || act === "url-dec") {
      const el = $("#url-in");
      try {
        el.value = act === "url-enc" ? encodeURIComponent(el.value) : decodeURIComponent(el.value);
        msg($("#url-msg"), "انجام شد", "ok");
      } catch {
        msg($("#url-msg"), "رشتهٔ کدگذاری‌شده معتبر نیست", "bad");
      }
      return;
    }

    if (act === "hash-clear") {
      $("#hash-in").value = "";
      $("#hash-out").innerHTML = "";
      return;
    }

    if (act === "jwt-clear") {
      $("#jwt-in").value = "";
      $("#jwt-out").hidden = true;
      return;
    }

    if (act === "time-now") {
      $("#time-in").value = Math.floor(Date.now() / 1000);
      renderTime();
      return;
    }

    if (act === "uuid-gen") {
      const n = Math.min(50, Math.max(1, +$("#uuid-count").value || 5));
      const ids = Array.from({ length: n }, () => (crypto.randomUUID
        ? crypto.randomUUID()
        : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === "x" ? r : (r & 3) | 8).toString(16);
        })));
      $("#uuid-out").textContent = ids.join("\n");
      return;
    }
  });

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  function b64decode(str) {
    const clean = str.replace(/\s+/g, "");
    const bin = atob(clean);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  /* hash */
  let hashTimer;
  $("#hash-in").addEventListener("input", () => {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(runHash, 220);
  });

  async function runHash() {
    const text = $("#hash-in").value;
    const out = $("#hash-out");
    if (!text) { out.innerHTML = ""; return; }
    if (!globalThis.crypto?.subtle) {
      out.innerHTML = `<dt>وضعیت</dt><dd style="color:var(--bad)">Web Crypto در این مرورگر در دسترس نیست (HTTPS لازم است)</dd>`;
      return;
    }
    const algos = [["SHA-1", "sha-1"], ["SHA-256", "sha-256"], ["SHA-384", "sha-384"], ["SHA-512", "sha-512"]];
    const data = new TextEncoder().encode(text);
    const rows = await Promise.all(algos.map(async ([label, alg]) => {
      const buf = await crypto.subtle.digest(alg.toUpperCase(), data);
      const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
      return `<dt class="mono">${label}</dt><dd>${hex}</dd>`;
    }));
    out.innerHTML = rows.join("");
  }

  /* jwt */
  let jwtTimer;
  $("#jwt-in").addEventListener("input", () => {
    clearTimeout(jwtTimer);
    jwtTimer = setTimeout(runJwt, 220);
  });

  function b64urlJson(part) {
    const pad = part.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function runJwt() {
    const raw = $("#jwt-in").value.trim();
    const out = $("#jwt-out");
    if (!raw) { out.hidden = true; return; }
    out.hidden = false;

    try {
      const [h, p] = raw.split(".");
      const header = b64urlJson(h);
      const payload = b64urlJson(p);

      const now = Math.floor(Date.now() / 1000);
      const exp = payload.exp ? new Date(payload.exp * 1000) : null;
      const state_ = exp
        ? (payload.exp > now ? `معتبر — ${exp.toLocaleString("fa-IR")}` : `منقضی شده — ${exp.toLocaleString("fa-IR")}`)
        : "بدون exp";

      out.innerHTML = `
        <p class="out-line ${exp && payload.exp <= now ? "bad" : "ok"}">${state_}</p>
        <p class="k" style="margin:12px 0 4px">header</p>
        <pre class="code mono">${JSON.stringify(header, null, 2).replace(/</g, "&lt;")}</pre>
        <p class="k" style="margin:12px 0 4px">payload</p>
        <pre class="code mono">${JSON.stringify(payload, null, 2).replace(/</g, "&lt;")}</pre>`;
    } catch {
      out.innerHTML = `<p class="out-line bad">توکن معتبر نیست.</p>`;
    }
  }

  /* time */
  const timeIn = $("#time-in");
  timeIn.addEventListener("input", renderTime);

  function renderTime() {
    const raw = timeIn.value.trim();
    const out = $("#time-out");
    if (!raw) { out.innerHTML = ""; return; }

    let date;
    if (/^\d{10}$/.test(raw)) date = new Date(+raw * 1000);
    else if (/^\d{13}$/.test(raw)) date = new Date(+raw);
    else date = new Date(raw);

    if (Number.isNaN(date.getTime())) {
      out.innerHTML = `<dt>وضعیت</dt><dd style="color:var(--bad)">تاریخ نامعتبر</dd>`;
      return;
    }

    const rows = [
      ["Unix (s)", Math.floor(date.getTime() / 1000)],
      ["Unix (ms)", date.getTime()],
      ["ISO / UTC", date.toISOString()],
      ["محلی", date.toLocaleString("fa-IR")],
      ["شمسی", new Intl.DateTimeFormat("fa-IR", { dateStyle: "full", timeStyle: "short" }).format(date)],
      ["UTC", date.toUTCString()],
    ];
    out.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  }

  /* ───────── device ───────── */

  function parseUA(ua) {
    const browsers = [
      ["Edge", /Edg\/([\d.]+)/], ["Samsung Internet", /SamsungBrowser\/([\d.]+)/],
      ["Opera", /OPR\/([\d.]+)/], ["Firefox", /Firefox\/([\d.]+)/],
      ["Chrome", /Chrome\/([\d.]+)/], ["Safari", /Version\/([\d.]+).*Safari/],
    ];
    const systems = [
      ["Windows", /Windows NT ([\d.]+)/], ["Android", /Android ([\d.]+)/],
      ["iOS", /OS ([\d_]+) like Mac/], ["macOS", /Mac OS X ([\d_]+)/],
      ["Linux", /Linux/],
    ];
    const b = browsers.find(([, re]) => re.test(ua));
    const s = systems.find(([, re]) => re.test(ua));
    return {
      browser: b ? `${b[0]} ${ua.match(b[1])?.[1] || ""}`.trim() : "نامشخص",
      os: s ? `${s[0]} ${(ua.match(s[1])?.[1] || "").replace(/_/g, ".")}`.trim() : "نامشخص",
    };
  }

  function gpuName() {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "";
    } catch { return ""; }
  }

  async function renderDevice() {
    const ua = navigator.userAgent;
    const { browser, os } = parseUA(ua);
    let nav = {};
    try { nav = performance.getEntriesByType?.("navigation")?.[0] || {}; } catch { /* older engines */ }
    const conn = navigator.connection || navigator.mozConnection || {};
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const rows = [
      ["مرورگر", browser],
      ["سیستم", os],
      ["موبایل", (navigator.userAgentData?.mobile ?? /Mobi|Android/i.test(ua)) ? "بله" : "خیر"],
      ["زبان", navigator.languages?.join(", ") || navigator.language],
      ["منطقهٔ زمانی", `${tz} (UTC${-new Date().getTimezoneOffset() / 60 >= 0 ? "+" : ""}${-new Date().getTimezoneOffset() / 60})`],
      ["صفحه", `${screen.width}×${screen.height} @${window.devicePixelRatio}x`],
      ["پنجره", `${innerWidth}×${innerHeight}`],
      ["هسته‌های CPU", navigator.hardwareConcurrency || "—"],
      ["حافظه", navigator.deviceMemory ? `${navigator.deviceMemory} GB` : "—"],
      ["اتصال", conn.effectiveType ? `${conn.effectiveType} · ${conn.downlink ?? "?"} Mbps · RTT ${conn.rtt ?? "?"}ms` : "—"],
      ["پروتکل", nav.nextHopProtocol || "—"],
      ["TTFB", nav.responseStart ? `${Math.round(nav.responseStart)} ms` : "—"],
      ["حجم صفحه", nav.transferSize ? `${(nav.transferSize / 1024).toFixed(1)} KB` : "—"],
      ["عنوان صفحه", document.title.slice(0, 40)],
      ["GPU", gpuName()],
      ["کوکی", navigator.cookieEnabled ? "فعال" : "خاموش"],
      ["User-Agent", ua],
    ];

    const dl = $("#device-out");
    dl.innerHTML = rows
      .filter(([, v]) => v !== "" && v != null)
      .map(([k, v]) => `<dt>${k}</dt><dd>${String(v).replace(/</g, "&lt;")}</dd>`)
      .join("");

    if (navigator.storage?.estimate) {
      try {
        const { usage, quota } = await navigator.storage.estimate();
        dl.insertAdjacentHTML("beforeend",
          `<dt>فضای ذخیره</dt><dd>${(usage / 1048576).toFixed(1)} MB / ${(quota / 1073741824).toFixed(1)} GB</dd>`);
      } catch { /* ignore */ }
    }
  }

  /* ───────── nav + misc ───────── */

  addEventListener("scroll", () => {
    $(".bar").classList.toggle("scrolled", scrollY > 4);
  }, { passive: true });

  $$(".nav-a").forEach((a) => a.addEventListener("click", (e) => {
    const target = $(a.getAttribute("href"));
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }));

  document.addEventListener("click", (e) => {
    if (e.target.closest("#copy-ip, #copy-json")) return;
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  /* ───────── boot ───────── */

  loadIp();
  renderDevice();
  timeIn.value = Math.floor(Date.now() / 1000);
  renderTime();
})();
