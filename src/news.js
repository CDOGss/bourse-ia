import { fetchText } from "./lib/http.js";

const norm = (s) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

export function parseRss(xml, source) {
  const items = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    const title = (b.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1] || "";
    const link = (b.match(/<link>(?:<!\[CDATA\[)?(https?:\/\/[^\]<]+)(?:\]\]>)?<\/link>/i) || [])[1] || "";
    const pub = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || "";
    const desc = (b.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i) || [])[1] || "";
    const date = new Date(pub.trim());
    if (!title || isNaN(date)) continue;
    items.push({
      titre: title.replace(/<[^>]+>/g, "").trim(),
      description: desc.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim().slice(0, 220),
      lien: link.trim(),
      source,
      date: date.toISOString(),
    });
  }
  return items;
}

const sourceName = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "inconnu";
  }
};

async function safeFetchRss(url, { maxTitles = 15 } = {}) {
  const xml = await fetchText(url, { retries: 1, timeoutMs: 12000 });
  const items = parseRss(xml, sourceName(url));
  return items.slice(0, maxTitles);
}

function googleNewsUrl(query, when = "1d") {
  const q = /when\s*:/i.test(query) ? query : `${query} when:${when}`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr&gl=FR&ceid=FR:fr`;
}

function resolveFeed(url) {
  return url.startsWith("news:") ? googleNewsUrl(url.slice(5)) : url;
}

async function fetchSet(urls, out, errors) {
  const results = await Promise.allSettled(urls.map((u) => safeFetchRss(u)));
  for (const r of results) {
    if (r.status === "fulfilled") out.push(...r.value);
    else errors.push(String(r.reason && r.reason.message ? r.reason.message : r.reason).slice(0, 160));
  }
}

export async function fetchNews({ config, universe, quotes, holdings }) {
  const newsCfg = config.news;
  const all = [];
  const errors = [];

  await fetchSet(newsCfg.queriesGenerales.map((q) => googleNewsUrl(q)), all, errors);
  await fetchSet(newsCfg.fluxSites.map(resolveFeed), all, errors);

  const movers = quotes
    .filter((v) => Math.abs(v.chg1d ?? 0) >= newsCfg.moversSeuilPct)
    .sort((a, b) => Math.abs(b.chg1d) - Math.abs(a.chg1d))
    .slice(0, 12);
  const byName = new Map(universe.map((u) => [u.symbol, u.nom]));
  const holdNames = holdings
    .map((h) => byName.get(h.symbole))
    .filter(Boolean);
  const targetNames = [...new Set([...holdNames, ...movers.map((m) => byName.get(m.symbole))])].slice(0, 15);
  await fetchSet(targetNames.map((n) => googleNewsUrl(`"${n}"`)), all, errors);

  const maxAge = newsCfg.ageMaxHeures * 3600 * 1000;
  const now = Date.now();
  const seen = new Set();
  const prio = (it) => {
    const t = norm(it.titre) + " " + norm(it.description);
    if (holdNames.some((n) => t.includes(norm(n)))) return 0;
    if (movers.some((m) => t.includes(norm(byName.get(m.symbole))))) return 1;
    return 2;
  };
  let items = all
    .filter((it) => now - new Date(it.date).getTime() <= maxAge)
    .filter((it) => {
      const k = norm(it.titre).slice(0, 70);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => prio(a) - prio(b) || new Date(b.date) - new Date(a.date));

  const perCount = {};
  items = items.filter((it) => {
    const t = norm(it.titre) + " " + norm(it.description);
    for (const n of targetNames) {
      if (t.includes(norm(n))) {
        perCount[n] = (perCount[n] || 0) + 1;
        return perCount[n] <= newsCfg.maxNewsParValeur;
      }
    }
    return true;
  });

  items = items.slice(0, newsCfg.maxTitres);
  return { items, errors };
}
