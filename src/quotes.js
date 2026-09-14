import { fetchJson } from "./lib/http.js";
import { calculerIndicateurs } from "./indicators.js";

const BASE = "https://query1.finance.yahoo.com";
const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

function pct(last, ref) {
  if (last == null || ref == null || ref === 0) return null;
  return round2(((last - ref) / ref) * 100);
}

// spark accepte une liste de symboles separee par des virgules : 72 valeurs tiennent en
// 6 requetes. range=1y pour disposer de la moyenne mobile a 200 jours.
async function sparkBatch(symbols) {
  const url = `${BASE}/v8/finance/spark?symbols=${encodeURIComponent(symbols.join(","))}&range=1y&interval=1d`;
  return fetchJson(url, { retries: 4 });
}

export async function fetchQuotes(universe, { avecIndicateurs = true } = {}) {
  const chunks = [];
  for (let i = 0; i < universe.length; i += 12) chunks.push(universe.slice(i, i + 12));
  const raw = {};
  for (const chunk of chunks) {
    const data = await sparkBatch(chunk.map((u) => u.symbol));
    for (const [sym, v] of Object.entries(data)) {
      if (v && Array.isArray(v.close) && v.close.length) raw[sym] = v.close.filter((c) => c != null);
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  const valeurs = [];
  const series = {};
  for (const u of universe) {
    const closes = raw[u.symbol];
    if (!closes || closes.length < 2) continue;
    series[u.symbol] = closes.map(round2);
    const last = closes[closes.length - 1];
    const base = {
      symbole: u.symbol,
      nom: u.nom,
      marche: u.marche,
      prix: round2(last),
      chg1d: pct(last, closes[closes.length - 2]),
      chg5d: closes.length >= 6 ? pct(last, closes[closes.length - 6]) : null,
      chg20d: closes.length >= 21 ? pct(last, closes[closes.length - 21]) : null,
    };
    if (avecIndicateurs) {
      const ind = calculerIndicateurs(closes);
      if (ind) Object.assign(base, ind);
    }
    valeurs.push(base);
  }
  return valeurs;
}

export async function fetchBenchmark(symbol) {
  const url = `${BASE}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`;
  const j = await fetchJson(url, { retries: 4 });
  const r = j.chart?.result?.[0];
  const closes = r?.indicators?.quote?.[0]?.close?.filter((c) => c != null) || [];
  if (!r || closes.length < 2) throw new Error(`benchmark indisponible (${symbol})`);
  const level = round2(r.meta.regularMarketPrice ?? closes[closes.length - 1]);
  return {
    symbol,
    level,
    chg1d: pct(closes[closes.length - 1], closes[closes.length - 2]),
    closes: closes.map(round2),
  };
}
