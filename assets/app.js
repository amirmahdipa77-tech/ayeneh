/* ═══════════════════════════════════════════
   devkit — the flag on top, your IP in the glass.
   ═══════════════════════════════════════════ */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const el = {
    glass: $("#glass"), country: $("#country"), ip: $("#my-ip"), meta: $("#ip-meta"),
    facts: $("#facts"), flag: $("#flag"), flagFallback: $("#flag-fallback"),
    flagCode: $("#flag-code"), provider: $("#provider"),
    copy: $("#copy-ip"), reload: $("#reload"), map: $("#map-link"), toast: $("#toast"),
  };

  let current = null;
  let typed = 0;

  /* ───────── helpers ───────── */

  async function api(url, timeout = 8000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function toast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    el.toast.style.animation = "none";
    void el.toast.offsetWidth;
    el.toast.style.animation = "";
    clearTimeout(el.toast._t);
    el.toast._t = setTimeout(() => { el.toast.hidden = true; }, 1600);
  }

  const regionNames = (() => {
    try { return new Intl.DisplayNames(["fa"], { type: "region" }); } catch { return null; }
  })();

  function countryFa(code, fallback) {
    try {
      const name = regionNames?.of(code);
      if (name && name !== code) return name;
    } catch { /* unknown */ }
    return fallback || "—";
  }

  /* ───────── typing reveal ───────── */

  function typeIP(text) {
    const token = ++typed;
    if (reduced) { el.ip.textContent = text; return; }

    let i = 0;
    const step = () => {
      if (token !== typed) return;
      i += 1;
      el.ip.innerHTML = text.slice(0, i) + (i < text.length ? '<span class="caret"></span>' : "");
      if (i < text.length) setTimeout(step, 26);
    };
    el.ip.innerHTML = '<span class="caret"></span>';
    setTimeout(step, 140);
  }

  /* ───────── data ───────── */

  const normalizeWho = (d) => ({
    ip: d.ip, code: d.country_code, country: d.country,
    city: d.city, region: d.region,
    isp: d.connection?.isp || d.connection?.org,
    asn: d.connection?.asn ? `AS${d.connection.asn}` : "",
    lat: d.latitude, lon: d.longitude,
    tz: d.timezone?.id,
  });

  const normalizeIpapi = (d) => ({
    ip: d.ip, code: d.country_code, country: d.country_name,
    city: d.city, region: d.region, isp: d.org, asn: d.asn || "",
    lat: d.latitude, lon: d.longitude, tz: d.timezone,
  });

  async function fetchIp() {
    try {
      const r = await api("https://ipwho.is/");
      if (r && r.success !== false && r.ip) return { data: normalizeWho(r), provider: "ipwho.is" };
    } catch { /* next */ }
    try {
      const r = await api("https://ipapi.co/json/");
      if (r && !r.error && r.ip) return { data: normalizeIpapi(r), provider: "ipapi.co" };
    } catch { /* next */ }
    const r = await api("https://api64.ipify.org");
    return { data: { ip: r.ip }, provider: "ipify" };
  }

  /* ───────── render ───────── */

  function renderFlag(code) {
    if (!code) {
      el.flag.hidden = true;
      el.flagFallback.hidden = false;
      el.flagCode.textContent = "··";
      return;
    }

    const cc = String(code).toLowerCase();
    el.flag.hidden = false;
    el.flagFallback.hidden = true;
    el.flag.alt = code;
    el.flag.srcset = `https://flagcdn.com/w1280/${cc}.png 2x, https://flagcdn.com/w640/${cc}.png 1x`;
    el.flag.sizes = "100vw";
    el.flag.src = `https://flagcdn.com/w640/${cc}.png`;

    el.flag.onerror = () => {
      el.flag.hidden = true;
      el.flagFallback.hidden = false;
      el.flagCode.textContent = code;
    };
  }

  function render(d, provider) {
    current = d;

    const name = countryFa(d.code, d.country);
    el.country.textContent = name;

    renderFlag(d.code);
    typeIP(d.ip || "—");

    el.meta.textContent = [d.city, d.isp, d.asn].filter(Boolean).join("  ·  ");
    el.facts.textContent = [
      d.lat != null ? `${(+d.lat).toFixed(3)}, ${(+d.lon).toFixed(3)}` : "",
      d.tz || "",
    ].filter(Boolean).join("  ·  ");

    el.map.href = d.lat != null
      ? `https://www.openstreetmap.org/
      : "#";
    el.provider.textContent = provider;

    document.title = `${name} · ${d.ip} — DevKit`;
  }

  async function load(first = false) {
    el.glass.classList.add("loading");
    el.reload.disabled = true;
    try {
      const { data, provider } = await fetchIp();
      render(data, provider);
      if (!first) toast("تازه شد");
    } catch {
      el.country.textContent = "دسترسی نشد";
      el.meta.textContent = "اتصال یا مسدودسازی مرورگر را بررسی کنید.";
      typeIP("—");
    } finally {
      el.glass.classList.remove("loading");
      el.reload.disabled = false;
    }
  }

  /* ───────── interactions ───────── */

  el.copy.addEventListener("click", async () => {
    if (!current?.ip) return;
    try {
      await navigator.clipboard.writeText(current.ip);
      el.copy.textContent = "کپی شد";
      el.copy.classList.add("done");
      setTimeout(() => {
        el.copy.textContent = "کپی";
        el.copy.classList.remove("done");
      }, 1500);
    } catch {
      toast("کپی نشد");
    }
  });

  el.reload.addEventListener("click", () => load(false));

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  load(true);
})();
