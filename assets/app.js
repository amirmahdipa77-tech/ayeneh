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

  /* ───────── providers ─────────
     All of them are fired at once; the first *complete* answer wins, and a
     minimal one (IP only) is used if nothing better shows up quickly. */

  const PROVIDERS = [
    {
      name: "ipwho.is", full: true, url: "https://ipwho.is/",
      parse: (d) => (d && d.success !== false && d.ip ? normalizeWho(d) : null),
    },
    {
      name: "ipapi.co", full: true, url: "https://ipapi.co/json/",
      parse: (d) => (d && !d.error && d.ip ? normalizeIpapi(d) : null),
    },
    {
      name: "freeipapi.com", full: true, url: "https://freeipapi.com/api/json",
      parse: (d) => (d && d.ipAddress ? {
        ip: d.ipAddress, code: d.countryCode, country: d.countryName,
        city: d.cityName, region: d.regionName, isp: "", asn: "",
        lat: d.latitude, lon: d.longitude, tz: d.timeZone,
      } : null),
    },
    {
      name: "ipinfo.io", full: true, url: "https://ipinfo.io/json",
      parse: (d) => (d && d.ip ? {
        ip: d.ip, code: d.country, country: d.country,
        city: d.city, region: d.region, isp: d.org, asn: "",
        lat: d.loc ? +d.loc.split(",")[0] : null,
        lon: d.loc ? +d.loc.split(",")[1] : null,
        tz: d.timezone,
      } : null),
    },
    {
      name: "cloudflare", full: false, url: "https://www.cloudflare.com/cdn-cgi/trace", text: true,
      parse: (t) => {
        const o = Object.fromEntries(String(t).trim().split("\n").map((l) => l.split("=")));
        return o.ip ? { ip: o.ip, code: o.loc, country: "", city: "", isp: "" } : null;
      },
    },
    {
      name: "myip.com", full: false, url: "https://api.myip.com",
      parse: (d) => (d && d.ip ? { ip: d.ip, code: d.cc, country: d.country, city: "", isp: "" } : null),
    },
    {
      name: "ipify", full: false, url: "https://api64.ipify.org?format=json",
      parse: (d) => (d && d.ip ? { ip: d.ip, code: "", country: "", city: "", isp: "" } : null),
    },
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

      // if only minimal answers have arrived, take the best of them
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
          } catch { /* ignore, another provider may win */ }
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
    el.flag.srcset = `https://flagcdn.com/w1280/${cc}.png 2x, https://flagcdn.com/w640/${cc}.png 1x`;
    el.flag.sizes = "100vw";
    el.flag.src = `https://flagcdn.com/w640/${cc}.png`;

    const fail = () => {
      el.flag.hidden = true;
      el.flagFallback.hidden = false;
      el.flagCode.textContent = code;
    };
    el.flag.onerror = fail;
    clearTimeout(el.flag._t);
    el.flag._t = setTimeout(() => {
      if (!el.flag.complete || !el.flag.naturalWidth) fail();
    }, 4000);
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
      ? `https://www.openstreetmap.org/?mlat=${d.lat}&mlon=${d.lon}#map=11/${d.lat}/${d.lon}`
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
      el.meta.innerHTML = 'سرویس‌های آی‌پی جواب ندادند. <button class="retry" id="retry" type="button">تلاش دوباره</button>';
      typeIP("—");
      document.getElementById("retry")?.addEventListener("click", () => load(false));
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

  /* safety net: if any entry animation fails to run, show the content anyway */
  setTimeout(() => {
    if (getComputedStyle(el.glass).opacity === "0") {
      el.glass.style.opacity = "1";
      el.glass.style.transform = "none";
    }
    document.querySelectorAll(".glass > *").forEach((n) => {
      if (getComputedStyle(n).opacity === "0") {
        n.style.opacity = "1";
        n.style.transform = "none";
      }
    });
    if (getComputedStyle(el.flag).opacity === "0") el.flag.style.opacity = "1";
  }, 1500);

  load(true);
})();
