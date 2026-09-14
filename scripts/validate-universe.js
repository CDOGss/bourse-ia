import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fetchJson } from "../src/lib/http.js";

const norm = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function match(name, entry, sym) {
  const n = norm(name);
  if (/%|obligation|senior|subord|medterm|bond|note du|adr\b|\bb\b$/.test(n)) return false;
  const want = norm(entry.nom);
  const key = want.split(" ")[0];
  const ok = n.includes(key) || key.includes(n) || n.includes(want) || want.includes(n);
  if (!ok) return false;
  if (entry.mustMatch && !n.includes(norm(entry.mustMatch))) return false;
  if (entry.mustNotMatch && n.includes(norm(entry.mustNotMatch))) return false;
  if (entry.skipIfMatch && n.includes(norm(entry.skipIfMatch))) return false;
  return true;
}

async function searchSymbols(nom) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(nom)}&quotesCount=8&newsCount=0`;
  try {
    const j = await fetchJson(url, { retries: 2, timeoutMs: 15000 });
    return (j.quotes || [])
      .filter((q) => q.symbol?.endsWith(".PA"))
      .map((q) => ({ symbol: q.symbol, name: q.shortname || q.longname || "" }));
  } catch {
    return [];
  }
}

async function probe(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2d&interval=1d`;
  try {
    const j = await fetchJson(url, { retries: 4, timeoutMs: 15000 });
    const r = j.chart?.result?.[0];
    if (!r) return null;
    return { name: r.meta.longName || r.meta.shortName || "", price: r.meta.regularMarketPrice };
  } catch {
    return null;
  }
}

const candidates = JSON.parse(readFileSync(new URL("../src/universe.candidates.json", import.meta.url)));
const uniPath = new URL("../src/universe.json", import.meta.url);
const previous = existsSync(uniPath) ? JSON.parse(readFileSync(uniPath)) : [];
const done = new Set(previous.map((e) => e.nom));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const resolved = [...previous];
const symbolesPris = new Set(previous.map((e) => e.symbol));
const failed = [];

for (const entry of candidates) {
  if (done.has(entry.nom)) continue;
  let found = null;
  for (const sym of entry.candidates || []) {
    if (symbolesPris.has(sym)) continue;
    const info = await probe(sym);
    if (info && info.price && match(info.name, entry, sym)) {
      found = { symbol: sym, nom: entry.nom, nom_yahoo: info.name, marche: entry.marche };
      break;
    }
    await sleep(1200);
  }
  if (!found) {
    for (const disc of (await searchSymbols(entry.q || entry.nom.replace(/\s*\(.*$/, "").trim())).slice(0, 3)) {
      if (symbolesPris.has(disc.symbol)) continue;
      const info = await probe(disc.symbol);
      const okDisc = match(info.name, entry, disc.symbol) || (entry.q && norm(info.name).includes(norm(entry.q)));
      if (info && info.price && okDisc) {
        found = { symbol: disc.symbol, nom: entry.nom, nom_yahoo: info.name, marche: entry.marche };
        console.log(`    (decouvert via recherche: ${disc.symbol})`);
        break;
      }
      await sleep(800);
    }
  }
  if (found) {
    symbolesPris.add(found.symbol);
    resolved.push(found);
    console.log(`OK  ${entry.nom.padEnd(32)} -> ${found.symbol}  (${found.nom_yahoo})`);
  } else {
    failed.push(entry.nom);
    console.log(`KO  ${entry.nom} (${(entry.candidates || []).join(",")})`);
  }
  await sleep(1200);
}


resolved.sort((a, b) => (a.marche === b.marche ? a.nom.localeCompare(b.nom) : a.marche.localeCompare(b.marche)));
writeFileSync(new URL("../src/universe.json", import.meta.url), JSON.stringify(resolved, null, 2) + "\n");
console.log(`\nresolu=${resolved.length} echoues=${failed.length}`);
if (failed.length) console.log("KO: " + failed.join(" | "));
