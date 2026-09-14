import test from "node:test";
import assert from "node:assert/strict";
import { initPortfolio, applyRun, equityOf } from "../src/paper.js";

const cfg = (surtaxe) => ({
  initialCapital: 10000,
  feePct: 0.1,
  ttfPct: surtaxe === undefined ? 0.3 : surtaxe,
  minConfiance: 70,
  maxAchatsParRun: 3,
  maxPositions: 8,
  maxPoidsLigne: 25,
  krachSeuilPct: -3,
});

const quotes = { "AIR.PA": { nom: "Airbus", price: 100 } };

function achat(config, signaux = [{ symbole: "AIR.PA", action: "ACHAT", confiance: 90, justification: "these", taille_pct: 10 }]) {
  const p0 = initPortfolio(config, "2026-03-02T10:00:00.000Z");
  return applyRun(p0, { asOf: "2026-03-02T10:00:00.000Z", regime: "NORMAL", cacLevel: 8000, cacChangePct: 0, quotes, signaux }, config);
}

test("l'achat intgre le courtage ET la taxe sur les transactions francaises", () => {
  const res = achat(cfg());
  const pos = res.portfolio.positions[0];
  // budget 10 % de 10 000 = 1 000 EUR ; unite a 100 x (1 + 0,1 % + 0,3 %) = 100,40
  assert.equal(pos.shares, 9);
  assert.equal(pos.pmc, 100.4, "prix de revient inclut courtage et TTF");
  assert.equal(res.portfolio.cash, 9096.4);
  const trade = res.portfolio.trades.find((t) => t.action === "ACHAT");
  assert.equal(trade.frais, 0.9, "courtage sur 900 EUR bruts");
  assert.equal(trade.ttf, 2.7, "TTF de 0,3 % sur 900 EUR bruts");
  assert.equal(trade.montant, 903.6);
});

test("la vente ne paie pas la TTF, seulement le courtage", () => {
  const config = cfg();
  const res = achat(config);
  const revendu = applyRun(res.portfolio, {
    asOf: "2026-04-02T10:00:00.000Z", regime: "NORMAL", cacLevel: 8000, cacChangePct: 0,
    quotes: { "AIR.PA": { nom: "Airbus", price: 110 } },
    signaux: [{ symbole: "AIR.PA", action: "VENTE", confiance: 80, justification: "fin de these" }],
  }, config);
  const v = revendu.portfolio.trades.find((t) => t.action === "VENTE");
  assert.equal(v.ttf, 0, "pas de TTF a la vente");
  assert.equal(v.frais, 0.99);
  assert.equal(v.montant, 989.01);
  assert.equal(v.pnlPct, 9.56, "plus-value calculee sur le prix de revient frais inclus");
  assert.equal(v.pnlEur, 85.41);
  assert.equal(revendu.portfolio.positions.length, 0);
});

test("a couts nuls on retrouve exactement la quantite theorique", () => {
  const config = { ...cfg(0), feePct: 0 };
  const res = achat(config);
  assert.equal(res.portfolio.positions[0].shares, 10);
  assert.equal(res.portfolio.cash, 9000);
});

test("un aller-retour a +0,2 % detruit de la valeur une fois les frais francais payes", () => {
  const config = cfg();
  const res = achat(config);
  const plat = applyRun(res.portfolio, {
    asOf: "2026-03-09T10:00:00.000Z", regime: "NORMAL", cacLevel: 8000, cacChangePct: 0,
    quotes: { "AIR.PA": { nom: "Airbus", price: 100.2 } },
    signaux: [{ symbole: "AIR.PA", action: "VENTE", confiance: 80, justification: "arbitrage" }],
  }, config);
  const equity = equityOf(plat.portfolio, {});
  // 9 titres : +1,80 EUR de hausse brute pour 4,50 EUR de frais cumules.
  assert.ok(equity < 9998, "l'aller-retour doit detruire de la valeur, equity = " + equity);
});
