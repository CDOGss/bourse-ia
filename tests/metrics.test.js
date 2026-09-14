import test from "node:test";
import assert from "node:assert/strict";
import { calculerMeriques } from "../src/metrics.js";

const CONFIG = { evaluation: { ageMinJours: 90, tradesSoldesMin: 20, alphaMinPct: 0, profitFactorMin: 1.3, maxDrawdownMinPct: -20 } };

function portefeuille({ jours = 120, equityFin = 12000, cacFin = 8800, ventes = [], signaux = [] } = {}) {
  const history = Array.from({ length: jours + 1 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString(),
    equity: 10000 + ((equityFin - 10000) * i) / jours,
    cac: 8000 + ((cacFin - 8000) * i) / jours,
  }));
  return {
    meta: { initialCapital: 10000 },
    cash: 0,
    positions: [],
    trades: ventes,
    history,
    signaux,
  };
}

const vente = (pnlPct, montant = 1000) => ({
  action: "VENTE", symbole: "X.PA", montant, pnlPct, prix: 100, pmc: 100 / (1 + pnlPct / 100),
});

const achatsEvalues = (alphas) =>
  alphas.map((a, i) => ({
    symbole: "X.PA", action: "ACHAT", confiance: 80,
    h1m: { alphaPct: a }, h1s: { alphaPct: a },
  }));

test("verdict prudent tant que le recul est insuffisant", () => {
  const m = calculerMeriques(portefeuille({ jours: 30, ventes: [vente(10)] }), { equity: 10500, cacLevel: 8200, config: CONFIG });
  assert.equal(m.verdict.etat, "PAS_ENCORE_CONCLUANT");
  assert.ok(m.verdict.raisons.join(" ").includes("90 jours"));
});

test("verdict VALIDE quand tous les criteres sont remplis", () => {
  const ventes = Array.from({ length: 22 }, () => vente(12));
  const m = calculerMeriques(portefeuille({ ventes, signaux: achatsEvalues([5, 6, 4, 8, 3, 7, 2, 9, 1, 6]) }),
    { equity: 12000, cacLevel: 8500, config: CONFIG });
  assert.equal(m.perfPct, 20);
  assert.equal(m.cacPerfPct, 6.25);
  assert.equal(m.alphaPct, 13.75);
  assert.equal(m.trades.nbSolde, 22);
  assert.equal(m.trades.tauxReussitePct, 100);
  assert.equal(m.verdict.etat, "VALIDE");
});

test("verdict REJETE si le portefeuille ne bat pas le marche", () => {
  const ventes = Array.from({ length: 21 }, (_, i) => vente(i % 2 ? -8 : 10));
  const m = calculerMeriques(portefeuille({ equityFin: 9800, ventes, signaux: achatsEvalues([-3, -1, -4, -2, -5, -1, -3, -2, -4, -1]) }),
    { equity: 9800, cacLevel: 9000, config: CONFIG });
  assert.ok(m.alphaPct < 0);
  assert.equal(m.verdict.etat, "REJETE");
  assert.ok(m.verdict.raisons.join(" ").includes("CAC 40"));
});

test("verdict FRAGILE si le profit factor est sous le seuil", () => {
  // 11 gains de +10 % (90,91 EUR chacun) contre 10 pertes de -8 % (86,96 EUR) : profit factor ~1,15.
  const ventes = [...Array.from({ length: 11 }, () => vente(10)), ...Array.from({ length: 10 }, () => vente(-8))];
  const m = calculerMeriques(portefeuille({ ventes, signaux: achatsEvalues([5, 6, 4, 8, 3, 7, 2, 9, 1, 6]) }),
    { equity: 11000, cacLevel: 8400, config: CONFIG });
  assert.ok(m.trades.profitFactor > 1 && m.trades.profitFactor < 1.3, "profit factor attendu entre 1 et 1,3, recu " + m.trades.profitFactor);
  assert.equal(m.verdict.etat, "FRAGILE");
});

test("couts cumules : courtage et TTF separes", () => {
  const ventes = [{ action: "VENTE", montant: 1000, pnlPct: 5, frais: 1.2, ttf: 0 }];
  const p = portefeuille({ ventes });
  p.trades.unshift({ action: "ACHAT", montant: 1000, frais: 1, ttf: 3 });
  const m = calculerMeriques(p, { equity: 10000, cacLevel: 8000, config: CONFIG });
  assert.equal(m.couts.fraisCumules, 2.2);
  assert.equal(m.couts.ttfCumule, 3);
  assert.equal(m.couts.totalEur, 5.2);
  assert.equal(m.couts.montantAchete, 1000);
});

test("calibration mesure l'ecart entre confiance annoncee et resultat reel", () => {
  const signaux = [
    ...Array.from({ length: 6 }, () => ({ symbole: "A.PA", action: "ACHAT", confiance: 85, h1m: { alphaPct: 5 } })),
    ...Array.from({ length: 5 }, () => ({ symbole: "B.PA", action: "ACHAT", confiance: 55, h1m: { alphaPct: -4 } })),
  ];
  const m = calculerMeriques(portefeuille({ ventes: [vente(1)], signaux }), { equity: 10000, cacLevel: 8000, config: CONFIG });
  assert.ok(Array.isArray(m.signaux.calibration), "calibration attendue avec 11 avis evalues");
  const haute = m.signaux.calibration.find((c) => c.tranche === "80-100");
  const basse = m.signaux.calibration.find((c) => c.tranche === "50-69");
  assert.equal(haute.nb, 6);
  assert.equal(haute.tauxReussitePct, 100);
  assert.equal(basse.nb, 5);
  assert.equal(basse.tauxReussitePct, 0);
});

test("pas de calibration avec trop peu d'avis juges pour etre honnete", () => {
  const signaux = Array.from({ length: 6 }, () => ({ symbole: "A.PA", action: "ACHAT", confiance: 85, h1m: { alphaPct: 5 } }));
  const m = calculerMeriques(portefeuille({ ventes: [vente(1)], signaux }), { equity: 10000, cacLevel: 8000, config: CONFIG });
  assert.equal(m.signaux.calibration, null);
});

test("un drawdown profond est signale", () => {
  const history = [
    { date: "2026-01-01T00:00:00.000Z", equity: 10000, cac: 8000 },
    { date: "2026-01-02T00:00:00.000Z", equity: 13000, cac: 8000 },
    { date: "2026-01-03T00:00:00.000Z", equity: 9000, cac: 8000 },
  ];
  const p = portefeuille({ ventes: [vente(1)] });
  p.history = history;
  const m = calculerMeriques(p, { equity: 9000, cacLevel: 8000, config: CONFIG });
  assert.equal(m.maxDrawdownPct, -30.8);
});
