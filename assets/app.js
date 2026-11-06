/* ═══════════════════════════════════════════
   devkit — flag header, your IP, and nothing else.
   ═══════════════════════════════════════════ */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const el = {
    country: $("#country"), ip: $("#my-ip"), meta: $("#ip-meta"), spec: $("#spec"),
    flag: $("#flag"), flagFallback: $("#flag-fallback"), flagCode: $("#flag-code"),
    provider: $("#provider"), cc: $("#cc"), eyebrow: $("#eyebrow"),
    copy: $("#copy-ip"), reload: $("#reload"), map: $("#map-link"), toast: $("#toast"),
  };

  let current = null;
  let typed = 0;

  /* ───────── helpers ───────── */

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

  /* ───────── providers: fire all, take the first good answer ───────── */

  const normalizeWho = (d) => ({
    ip: d.ip, code: d.country_code, country: d.country,
    city: d.city, region: d.region,
    isp: d.connection?.isp || d.connection?.org,
    asn: d.connection?.asn ? `AS${d.connection.asn}` : "",
    lat: d.latitude, lon: d.longitude,
    tz: d.timezone?.id, network: d.connection?.domain,
  });

  const normalizeIpapi = (d) => ({
    ip: d.ip, code: d.country_code, country: d.country_name,
    city: d.city, region: d.region, isp: d.org, asn: d.asn || "",
    lat: d.latitude, lon: d.longitude, tz: d.timezone, network: d.network,
  });

  const PROVIDERS = [
    { name: "ipwho.is", full: true, url: "https://ipwho.is/",
      parse: (d) => (d && d.success !== false && d.ip ? normalizeWho(d) : null) },
    { name: "ipapi.co", full: true, url: "https://ipapi.co/json/",
      parse: (d) => (d && !d.error && d.ip ? normalizeIpapi(d) : null) },
    { name: "freeipapi", full: true, url: "https://freeipapi.com/api/json",
      parse: (d) => (d && d.ipAddress ? {
        ip: d.ipAddress, code: d.countryCode, country: d.countryName,
        city: d.cityName, region: d.regionName, isp: "", asn: "",
        lat: d.latitude, lon: d.longitude, tz: d.timeZone,
      } : null) },
    { name: "ipinfo.io", full: true, url: "https://ipinfo.io/json",
      parse: (d) => (d && d.ip ? {
        ip: d.ip, code: d.country, country: d.country,
        city: d.city, region: d.region, isp: d.org, asn: "",
        lat: d.loc ? +d.loc.split(",")[0] : null,
        lon: d.loc ? +d.loc.split(",")[1] : null,
        tz: d.timezone,
      } : null) },
    { name: "cloudflare", full: false, url: "https://www.cloudflare.com/cdn-cgi/trace", text: true,
      parse: (t) => {
        const o = Object.fromEntries(String(t).trim().split("\n").map((l) => l.split("=")));
        return o.ip ? { ip: o.ip, code: o.loc } : null;
      } },
    { name: "myip.com", full: false, url: "https://api.myip.com",
      parse: (d) => (d && d.ip ? { ip: d.ip, code: d.cc, country: d.country } : null) },
    { name: "ipify", full: false, url: "https://api64.ipify.org?format=json",
      parse: (d) => (d && d.ip ? { ip: d.ip, code: "" } : null) },
  ];

  function fetchIp() {
    return new Promise((resolve, reject) => {
      let settled = false;
      let minimal = null;
      let pending = PROVIDERS.length;

      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        resolve(payload);
      };

      const deadline = setTimeout(() => {
        if (settled) return;
        if (minimal) finish(minimal);
        else reject(new Error("no provider answered"));
      }, 6000);

      for (const p of PROVIDERS) {
        (async () => {
          try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 5000);
            const res = await fetch(p.url, { signal: ctrl.signal, cache: "no-store" });
            clearTimeout(timer);
            if (!res.ok) throw new Error(res.status);

            const raw = p.text ? await res.text() : await res.json();
            const data = p.parse(raw);
            if (!data || !data.ip) throw new Error("empty");

            if (p.full && data.code) finish({ data, provider: p.name });
            else if (!minimal) minimal = { data, provider: p.name };
          } catch { /* another provider may win */ }
          pending -= 1;
          if (pending === 0 && !settled) {
            if (minimal) finish(minimal);
            else reject(new Error("no provider answered"));
          }
        })();
      }
    });
  }

  /* ───────── render ───────── */

  function renderFlag(code) {
    clearTimeout(el.flag._t);

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
    el.flag.srcset = `https://flagcdn.com/w640/${cc}.png 640w, https://flagcdn.com/w1280/${cc}.png 1280w, https://flagcdn.com/w2560/${cc}.png 2560w`;
    el.flag.sizes = "100vw";
    el.flag.src = `https://flagcdn.com/w1280/${cc}.png`;

    const fail = () => {
      el.flag.hidden = true;
      el.flagFallback.hidden = false;
      el.flagCode.textContent = code;
    };
    el.flag.onerror = fail;
    el.flag._t = setTimeout(() => {
      if (!el.flag.complete || !el.flag.naturalWidth) fail();
    }, 4000);
  }

  function renderSpec(d) {
    // always four cells so the grid stays a clean 2×2
    const rows = [
      ["استان", d.region],
      ["مختصات", d.lat != null ? `${(+d.lat).toFixed(3)}, ${(+d.lon).toFixed(3)}` : ""],
      ["منطقهٔ زمانی", d.tz],
      ["شبکه", d.network],
    ].map(([k, v]) => [k, v || "—"]);

    const hasAny = rows.some(([, v]) => v !== "—");
    el.spec.innerHTML = rows
      .map(([k, v]) => `<div><dt>${k}</dt><dd title="${String(v).replace(/"/g, "&quot;")}">${v}</dd></div>`)
      .join("");
    el.spec.hidden = !hasAny;
  }

  function render(d, provider) {
    current = d;

    const name = countryFa(d.code, d.country);
    el.country.textContent = name;

    renderFlag(d.code);
    typeIP(d.ip || "—");

    el.cc.textContent = d.code || "";
    el.eyebrow.textContent = `your ip · ${d.ip?.includes(":") ? "ipv6" : "ipv4"}`;
    el.meta.textContent = [d.city, d.isp, d.asn].filter(Boolean).join("  ·  ");
    renderSpec(d);

    el.map.href = d.lat != null
      ? `https://www.openstreetmap.org/?mlat=${d.lat}&mlon=${d.lon}#map=11/${d.lat}/${d.lon}`
      : "#";
    el.provider.textContent = provider;

    document.title = `${name} · ${d.ip} — DevKit`;
  }

  async function load(first = false) {
    document.body.classList.add("loading");
    el.reload.disabled = true;
    try {
      const { data, provider } = await fetchIp();
      render(data, provider);
      if (!first) toast("تازه شد");
    } catch {
      el.country.textContent = "دسترسی نشد";
      el.cc.textContent = "";
      el.meta.innerHTML = 'سرویس‌های آی‌پی جواب ندادند. <button class="retry" id="retry" type="button">تلاش دوباره</button>';
      el.spec.hidden = true;
      typeIP("—");
      document.getElementById("retry")?.addEventListener("click", () => load(false));
    } finally {
      document.body.classList.remove("loading");
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
        el.copy.textContent = "کپی آی‌پی";
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

  /* safety net: if an entry animation never runs, show everything anyway */
  setTimeout(() => {
    document.querySelectorAll(".content > *, .sig, .hero-top").forEach((n) => {
      if (getComputedStyle(n).opacity === "0") {
        n.style.opacity = "1";
        n.style.transform = "none";
      }
    });
    if (getComputedStyle(el.flag).opacity === "0") el.flag.style.opacity = "1";
  }, 1500);

  load(true);
})();
