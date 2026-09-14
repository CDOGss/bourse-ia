// Harnais de validation du moteur, pas un backtest de l'IA.
//
// Rejoue N seances sur des cours synthetiques en traversant les VRAIES fonctions du depot
// (applyRun, journal des signaux, horizons a +1 semaine / +1 mois, meriques, verdict). Le but
// est de verifier en dix secondes ce qui couterait trois mois a decouvrir en papier : taxes,
// stops, rattachement vente/achat, statistiques et garde-fous du verdict.
//
//   node scripts/simulation.js            # 120 seances, portefeuille de depart 10 000 EUR
//   node scripts/simulation.js --seances=250 --graine=7
//
// Les decisions viennent d'une regle technique bete (acheter les plus surventes) : elles ne
// disent RIEN de la valeur de Gemini. Seule la mécanique est testee ici.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initPortfolio, applyRun, equityOf } from "../src/paper.js";
import { enregistrerSignaux, mettreAJourHorizons, rattacherResultatSortie } from "../src/review.js";
import { calculerMeriques } from "../src/metrics.js";
import { rsi } from "../src/indicators.js";

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const a = argv.find((x) => x.startsWith(`--${n}=`));
  return a ? Number(a.split("=")[1]) : d;
};

const SEANCES = arg("seances", 120);
const GRAINE = arg("graine", 42);

// Generateur pseudo-aleatoire deterministe (mulberry32) : la simulation doit etre reproductible.
function aleatoire(graine) {
  let t = graine >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = aleatoire(GRAINE);
const UNIVERS = Array.from({ length: 24 }, (_, i) => ({ symbole: `T${i}.PA`, nom: `Test ${i}` }));
const cours = {};
for (const u of UNIVERS) {
  const serie = [];
  let p = 40 + rnd() * 60;
  const derive = (rnd() - 0.45) * 0.0012;
  for (let j = 0; j < SEANCES; j++) {
    p = Math.max(2, p * (1 + derive + (rnd() - 0.5) * 0.035));
    serie.push(Math.round(p * 100) / 100);
  }
  cours[u.symbole] = serie;
}
const cacSerie = [];
let cac = 7500;
for (let j = 0; j < SEANCES; j++) {
  cac = Math.max(3000, cac * (1 + (rnd() - 0.48) * 0.016));
  cacSerie.push(Math.round(cac * 100) / 100);
}

const config = {
  initialCapital: 10000, feePct: 0.1, ttfPct: 0.3, minConfiance: 70,
  maxAchatsParRun: 3, maxPositions: 8, maxPoidsLigne: 25, krachSeuilPct: -3,
};

let p = initPortfolio(config, new Date(Date.UTC(2026, 0, 2)).toISOString());
const dateDe = (i) => new Date(Date.UTC(2026, 0, 2) + i * 86400000).toISOString();
let nbSignaux = 0;

for (let i = 5; i < SEANCES; i++) {
  const quotes = Object.fromEntries(UNIVERS.map((u) => [u.symbole, { nom: u.nom, price: cours[u.symbole][i] }]));
  const asOf = dateDe(i);
  const cacLevel = cacSerie[i];

  // Pseudo-analyste : les plus surventes du jour, a condition que la tendance de fond tienne.
  const classes = UNIVERS.map((u) => ({ ...u, r: rsi(cours[u.symbole].slice(0, i + 1), 14) }))
    .filter((u) => u.r != null)
    .sort((a, b) => a.r - b.r);
  const signaux = [];
  for (const u of classes.slice(0, 2)) {
    if (u.r > 34) continue;
    if (p.positions.some((x) => x.symbole === u.symbole)) continue;
    const prix = cours[u.symbole][i];
    signaux.push({
      symbole: u.symbole, action: "ACHAT", confiance: 78, justification: `RSI ${u.r.toFixed(0)} en survente`,
      prix_entree: prix, stop_perte: Math.round(prix * 0.9 * 100) / 100, prise_profit: Math.round(prix * 1.15 * 100) / 100,
      taille_pct: 12,
    });
  }
  nbSignaux += signaux.length;

  const res = applyRun(p, { asOf, regime: "NORMAL", cacLevel, cacChangePct: 0, quotes, signaux }, config);
  p = res.portfolio;
  mettreAJourHorizons(p, { asOf, quotes, cacLevel });
  for (const v of res.applied.filter((x) => x.action === "VENTE")) {
    rattacherResultatSortie(p, { symbole: v.symbole, asOf, prix: v.prix, pnlPct: v.pnlPct, motif: v.motif });
  }
  const motifs = Object.fromEntries(res.rejected.map((r) => [`${r.symbole}:${r.action}`, r.motif]));
  enregistrerSignaux(p, { asOf, signaux, prixMap: quotes, cacLevel, motifsRejet: motifs });
}

const equity = equityOf(p, Object.fromEntries(UNIVERS.map((u) => [u.symbole, { price: cours[u.symbole].at(-1) }])));
const m = calculerMeriques(p, { equity, cacLevel: cacSerie.at(-1), config: { evaluation: {} } });

const sortie = join(process.cwd(), "_simulation.json");
writeFileSync(sortie, JSON.stringify({ portfolio: p, meriques: m }, null, 1));

const motifsVente = {};
for (const t of p.trades.filter((t) => t.action === "VENTE")) motifsVente[t.motif] = (motifsVente[t.motif] || 0) + 1;

console.log(`seances=${SEANCES} graine=${GRAINE}`);
console.log(`signaux emis=${nbSignaux} achats=${m.trades.nbAchats} positions soldees=${m.trades.nbSolde}`);
console.log(`motifs de sortie:`, JSON.stringify(motifsVente));
console.log(`equity=${equity} EUR perf=${m.perfPct} % | CAC=${m.cacPerfPct} % | alpha=${m.alphaPct} %`);
console.log(`drawdown max=${m.maxDrawdownPct} % | sharpe=${m.sharpe} | profit factor=${m.trades.profitFactor}`);
console.log(`frais=${m.couts.fraisCumules} EUR dont TTF=${m.couts.ttfCumule} EUR (${m.couts.coutEnPctDuCapital} % du capital)`);
console.log(`avis d'achat juges=${m.signaux.achats.nbEvalues} alpha moyen 1m=${m.signaux.achats.alphaMoyen1mPct} %`);
console.log(`verdict=${m.verdict.etat} ${JSON.stringify(m.verdict.raisons)}`);
console.log(`detail ecrit dans ${sortie}`);
