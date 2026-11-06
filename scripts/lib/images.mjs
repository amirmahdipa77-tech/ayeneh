/**
 * Image pipeline.
 *
 * Remote news images are slow, un-cached and sometimes hot-link protected.
 * We download each one once, downscale it to a 640px WebP, and serve it from
 * the same origin as the site — which is what makes the feed feel instant.
 *
 * A 20px blurred copy is kept as a data-URI so the card paints something
 * immediately instead of an empty box.
 */

import { mkdir, writeFile, access, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { shortHash, UA } from "./text.mjs";

export const IMG_DIR = "data/img";
const MAX_WIDTH = 640;
const QUALITY = 66;
const MIN_BYTES = 4000;
const MAX_BYTES = 8 * 1024 * 1024;

let sharpLib;
async function sharp() {
  if (sharpLib !== undefined) return sharpLib;
  try {
    sharpLib = (await import("sharp")).default;
  } catch {
    sharpLib = null;
  }
  return sharpLib;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function imageId(url) {
  return shortHash(url);
}

/** Download + optimise one image. Returns null when it can't be used. */
export async function optimizeImage(url, { timeout = 20000 } = {}) {
  const lib = await sharp();
  if (!lib) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let buf;
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": UA, accept: "image/avif,image/webp,image/*,*/*" },
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    if (type && !type.startsWith("image/")) return null;
    buf = Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (buf.length < MIN_BYTES || buf.length > MAX_BYTES) return null;

  try {
    const base = lib(buf, { failOn: "none" });
    const meta = await base.metadata();
    if (!meta.width || meta.width < 120) return null;

    const main = await base
      .clone()
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true, fit: "inside" })
      .webp({ quality: QUALITY, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    const blurBuf = await base
      .clone()
      .rotate()
      .resize({ width: 16 })
      .webp({ quality: 32 })
      .toBuffer();

    // one average colour: a 7-byte placeholder that costs almost nothing
    let col = "";
    try {
      const { dominant } = await base.clone().resize({ width: 40 }).stats();
      col = `#${[dominant.r, dominant.g, dominant.b]
        .map((v) => Math.round(v).toString(16).padStart(2, "0"))
        .join("")}`;
    } catch { /* optional */ }

    return {
      data: main.data,
      width: main.info.width,
      height: main.info.height,
      blur: `data:image/webp;base64,${blurBuf.toString("base64")}`,
      col,
    };
  } catch {
    return null;
  }
}

export async function writeImage(id, data) {
  await mkdir(IMG_DIR, { recursive: true });
  await writeFile(join(IMG_DIR, `${id}.webp`), data);
}

export async function hasImage(id) {
  return exists(join(IMG_DIR, `${id}.webp`));
}

/** Remove every stored image that is no longer referenced. */
export async function pruneImages(keep) {
  let files;
  try {
    files = await readdir(IMG_DIR);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const f of files) {
    if (!f.endsWith(".webp")) continue;
    const id = f.replace(/\.webp$/, "");
    if (keep.has(id)) continue;
    try {
      await unlink(join(IMG_DIR, f));
      removed++;
    } catch { /* ignore */ }
  }
  return removed;
}
