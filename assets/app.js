/* ═══════════════════════════════════════════
   devkit — your country, your IP. That's it.
   ═══════════════════════════════════════════ */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const el = {
    card: $("#card"), country: $("#country"), ip: $("#my-ip"), meta: $("#ip-meta"),
    facts: $("#facts"), flag: $("#flag"), provider: $("#provider"),
    bgFlag: $("#bg-flag"), bgPhoto: $("#bg-photo"), bgTint: $("#bg-tint"),
    copy: $("#copy-ip"), reload: $("#reload"), map: $("#map-link"), toast: $("#toast"),
  };

  let current = null;
  let typed = 0;

  /* ───────── helpers ───────── */

  const flagEmoji = (cc) => (cc || "").toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

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
    setTimeout(step, 120);
  }

  /* ───────── data ───────── */

  function normalizeWho(d) {
    return {
      ip: d.ip, code: d.country_code, country: d.country,
      city: d.city, region: d.region,
      isp: d.connection?.isp || d.connection?.org,
      asn: d.connection?.asn ? `AS${d.connection.asn}` : "",
      lat: d.latitude, lon: d.longitude,
      tz: d.timezone?.id, network: d.connection?.domain,
    };
  }

  function normalizeIpapi(d) {
    return {
      ip: d.ip, code: d.country_code, country: d.country_name,
      city: d.city, region: d.region, isp: d.org, asn: d.asn || "",
      lat: d.latitude, lon: d.longitude, tz: d.timezone, network: d.network,
    };
  }

  async function fetchIp() {
    try {
      const r = await api("https://ipwho.is/");
      if (r && r.success !== false && r.ip) return { data: normalizeWho(r), provider: "ipwho.is" };
    } catch { /* next */ }
    try {
      const r = await api("https://ipapi.co/json/");
      if (r && !r.error && r.ip) return { data: normalizeIpapi(r), provider: "ipapi.co" };
    } catch { /* next */ }
    const r = await api("https://api64.ipify.org?format=json");
    return { data: { ip: r.ip }, provider: "ipify" };
  }

  /* ───────── country imagery ───────── */

  const photoCache = (cc) => {
    try { return localStorage.getItem(`dk:photo:${cc}`) || ""; } catch { return ""; }
  };
  const cachePhoto = (cc, url) => {
    try { localStorage.setItem(`dk:photo:${cc}`, url); } catch { /* quota */ }
  };

  async function findPhoto(cc, englishName) {
    const cached = photoCache(cc);
    if (cached) return cached;

    const search = `filetype:bitmap ${englishName} landscape`;
    const url = "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*"
      + "&generator=search&gsrnamespace=6&gsrlimit=5&gsrsearch=" + encodeURIComponent(search)
      + "&prop=imageinfo&iiprop=url%7Cmime&iiurlwidth=1600";

    const res = await api(url, 7000);
    const pages = Object.values(res?.query?.pages || {});
    const hit = pages
      .filter((p) => /image\/(jpeg|png|webp)/i.test(p.imageinfo?.[0]?.mime || ""))
      .sort((a, b) => (b.imageinfo[0].width || 0) - (a.imageinfo[0].width || 0))[0];

    const src = hit?.imageinfo?.[0]?.thumburl || hit?.imageinfo?.[0]?.url || "";
    if (src) cachePhoto(cc, src);
    return src;
  }

  function paintBackdrop(d) {
    const cc = (d.code || "").toLowerCase();
    if (!cc) return;

    // 1) instant: the flag, blurred into a colour field
    const flagUrl = `https://flagcdn.com/w320/${cc}.png`;
    el.bgFlag.onload = () => el.bgFlag.classList.add("on");
    el.bgFlag.onerror = () => {
      el.bgTint.style.background = "#1b1b1b";
      el.bgTint.classList.add("on");
    };
    el.bgFlag.src = flagUrl;

    // 2) then: a real photo of the country, cross-faded in
    findPhoto(cc, d.country || cc)
      .then((src) => {
        if (!src) return;
        const pre = new Image();
        pre.decoding = "async";
        pre.onload = () => {
          el.bgPhoto.src = src;
          requestAnimationFrame(() => el.bgPhoto.classList.add("on"));
        };
        pre.src = src;
      })
      .catch(() => {});
  }

  /* ───────── render ───────── */

  function render(d, provider) {
    current = d;

    const name = countryFa(d.code, d.country);
    el.country.textContent = name;

    if (d.code) {
      el.flag.hidden = false;
      el.flag.src = `https://flagcdn.com/w80/${d.code.toLowerCase()}.png`;
      el.flag.srcset = `https://flagcdn.com/w160/${d.code.toLowerCase()}.png 2x`;
      el.flag.alt = name;
      el.flag.onerror = () => {
        el.flag.replaceWith(Object.assign(document.createElement("span"), {
          className: "flag", textContent: flagEmoji(d.code), style: "display:grid;place-items:center;font-size:20px;background:rgba(255,255,255,.14)",
        }));
      };
    }

    typeIP(d.ip || "—");
    el.meta.textContent = [d.city, d.isp, d.asn].filter(Boolean).join("  ·  ");

    const facts = [
      d.lat != null ? `${(+d.lat).toFixed(3)}, ${(+d.lon).toFixed(3)}` : "",
      d.tz || "",
    ].filter(Boolean).join("  ·  ");
    el.facts.textContent = facts;

    el.map.href = d.lat != null
      ? `https://www.openstreetmap.org/?mlat=${d.lat}&mlon=${d.lon}#map=11/${d.lat}/${d.lon}`
      : "#";
    el.provider.textContent = provider;

    document.title = `${name} · ${d.ip} — DevKit`;
    paintBackdrop(d);
  }

  async function load(first = false) {
    el.card.classList.add("loading");
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
      el.card.classList.remove("loading");
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

  el.reload.addEventListener("click", () => {
    el.bgPhoto.classList.remove("on");
    load(false);
  });

  // pointer-follow light on the glass
  if (!reduced && matchMedia("(hover: hover)").matches) {
    el.card.addEventListener("pointermove", (e) => {
      const r = el.card.getBoundingClientRect();
      el.card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.card.style.setProperty("--my", `${e.clientY - r.top}px`);
    }, { passive: true });
  }

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  load(true);
})();
