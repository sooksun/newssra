import crypto from "node:crypto";

const base = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";
const lat = Number(process.argv[2] ?? "20.29196892");
const lon = Number(process.argv[3] ?? "99.70778883");

function xyz(z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { z, x, y };
}

async function fetchInfo(url) {
  const res = await fetch(url);
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  const type = res.headers.get("content-type") ?? "";
  return {
    status: res.status,
    type,
    length: buf.length,
    hash: crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16),
    text: type.includes("json") ? buf.toString("utf8").slice(0, 500) : undefined,
  };
}

for (const z of [16, 17, 18, 19, 20, 21]) {
  const { x, y } = xyz(z);
  const tile = await fetchInfo(`${base}/tile/${z}/${y}/${x}`);
  let tilemap;
  try {
    tilemap = await fetchInfo(`${base}/tilemap/${z}/${y}/${x}/1/1?f=json`);
  } catch (error) {
    tilemap = { error: error instanceof Error ? error.message : String(error) };
  }
  console.log(JSON.stringify({ z, x, y, tile, tilemap }, null, 2));
}

const referenceUrl = `${base}/tile/21/463902/814719`;
console.log("reference", JSON.stringify(await fetchInfo(referenceUrl), null, 2));
