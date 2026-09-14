import test from "node:test";
import assert from "node:assert/strict";
import { initPortfolio, applyRun, equityOf } from "../src/paper.js";

const CFG = {
  initialCapital: 10000,
  feePct: 0.1,
  minConfiance: 70,
  maxAchatsParRun: 3,
  maxPositions: 8,
  maxPoidsLigne: 25,
  krachSeuilPct: -3,
};

const q = (p) => Object.fromEntries(
  Object.entries(p).map(([s, v]) => [s, { nom: s + " SA", price: v }])
);
const ASOF = "2026-09-14T15:00:00+02:00";

function baseInput(overrides = {}) {
  return {
    asOf: ASOF,
    regime: "NORMAL",
    cacLevel: 7400,
    cacChangePct: -0.5,
    quotes: q({ "AIR.PA": 200, "AI.PA": 180, "RMS.PA": 1400, "OR.PA": 380, "MC.PA": 410, "SU.PA": 280, "TTE.PA": 79, "SAN.PA": 100, "RNO.PA": 30 }),
    signaux: [],
    ...overrides,
  };
}

test("initPortfolio cree un portefeuille a 10000 EUR", () => {
  const p = initPortfolio(CFG, ASOF);
  assert.equal(p.cash, 10000);
  assert.deepEqual(p.positions, []);
  assert.deepEqual(p.trades, []);
  assert.equal(p.meta.initialCapital, 10000);
});

test("achat valide cree une position et deduit le cash avec frais", () => {
  const p = initPortfolio(CFG, ASOF);
  const r = applyRun(p, baseInput({ signaux: [
    { symbole: "AIR.PA", action: "ACHAT", confiance: 82, justification: "tendance haussiere", stop_perte: 190, prise_profit: 220, taille_pct: 20 },
  ] }), CFG);
  assert.equal(r.applied.length, 1);
  assert.equal(r.portfolio.positions.length, 1);
  const pos = r.portfolio.positions[0];
  assert.equal(pos.shares, 9); // 20% de 10000 = 2000 -> floor(2000/200.2)=9
  assert.ok(r.portfolio.cash < 10000 - 9 * 200);
  assert.ok(r.portfolio.cash > 10000 - 9 * 200 - 20);
  assert.equal(pos.stop, 190);
  assert.equal(pos.target, 220);
});

test("confiance < 70 rejetee", () => {
  const p = initPortfolio(CFG, ASOF);
  const r = applyRun(p, baseInput({ signaux: [
    { symbole: "AIR.PA", action: "ACHAT", confiance: 60, justification: "x", taille_pct: 10 },
  ] }), CFG);
  assert.equal(r.applied.length, 0);
  assert.equal(r.rejected[0].motif, "confiance_insuffisante");
});

test("regime CATASTROPHIQUE bloque les achats mais garde les ventes", () => {
  let p = initPortfolio(CFG, ASOF);
  p = applyRun(p, baseInput({ signaux: [
    { symbole: "AIR.PA", action: "ACHAT", confiance: 90, justification: "x", taille_pct: 10 },
  ] }), CFG).portfolio;
  const r = applyRun(p, baseInput({
    regime: "CATASTROPHIQUE",
    signaux: [
      { symbole: "AIR.PA", action: "VENTE", confiance: 95, justification: "krach", taille_pct: 0 },
    ],
  }), CFG);
  assert.equal(r.portfolio.positions.length, 0);
  assert.ok(r.portfolio.cash > 10000 - 200 - 200 * 0.001 * 10000 / 10000);
  const buyTry = applyRun(r.portfolio, baseInput({
    regime: "CATASTROPHIQUE",
    signaux: [{ symbole: "AI.PA", action: "ACHAT", confiance: 99, justification: "x", taille_pct: 10 }],
  }), CFG);
  assert.equal(buyTry.rejected.length, 1);
  assert.equal(buyTry.rejected[0].motif, "journee_catastrophique");
});

test("chute CAC <= -3% force le regime catastrophique meme si l'IA dit NORMAL", () => {
  const p = initPortfolio(CFG, ASOF);
  const r = applyRun(p, baseInput({
    cacChangePct: -4.2,
    regime: "NORMAL",
    signaux: [{ symbole: "AIR.PA", action: "ACHAT", confiance: 95, justification: "x", taille_pct: 10 }],
  }), CFG);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].motif, "journee_catastrophique");
  assert.equal(r.regimeApplique, "CATASTROPHIQUE");
});

test("max 3 achats par passage", () => {
  const p = initPortfolio(CFG, ASOF);
  const r = applyRun(p, baseInput({ signaux: [
    { symbole: "AIR.PA", action: "ACHAT", confiance: 95, justification: "a", taille_pct: 5 },
    { symbole: "AI.PA", action: "ACHAT", confiance: 94, justification: "b", taille_pct: 5 },
    { symbole: "OR.PA", action: "ACHAT", confiance: 93, justification: "c", taille_pct: 5 },
    { symbole: "MC.PA", action: "ACHAT", confiance: 92, justification: "d", taille_pct: 5 },
  ] }), CFG);
  assert.equal(r.applied.length, 3);
  assert.equal(r.rejected[0].motif, "max_achats_passage");
});

test("max 8 positions", () => {
  const cfg = { ...CFG, initialCapital: 100000 };
  let p = initPortfolio(cfg, ASOF);
  for (const [i, s] of ["AIR.PA", "AI.PA", "RMS.PA", "OR.PA", "MC.PA", "SU.PA", "TTE.PA", "SAN.PA"].entries()) {
    p = applyRun(p, baseInput({ signaux: [
      { symbole: s, action: "ACHAT", confiance: 90 - i, justification: "x", taille_pct: 2 },
    ] }), cfg).portfolio;
  }
  assert.equal(p.positions.length, 8);
  const r = applyRun(p, baseInput({ signaux: [
    { symbole: "RNO.PA", action: "ACHAT", confiance: 99, justification: "x", taille_pct: 2 },
  ] }), cfg);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].motif, "max_positions");
});

test("poids max 25% par ligne applique", () => {
  const p = initPortfolio(CFG, ASOF);
  const r = applyRun(p, baseInput({ signaux: [
    { symbole: "RMS.PA", action: "ACHAT", confiance: 90, justification: "x", taille_pct: 60 },
  ] }), CFG);
  const pos = r.portfolio.positions[0];
  assert.ok(pos.shares * 1400 <= 2500, "position <= 25% de la mise");
});

test("cash jamais negatif: achat trop gros rejete ou reduit", () => {
  let p = initPortfolio(CFG, ASOF);
  p = applyRun(p, baseInput({ signaux: [
    { symbole: "RMS.PA", action: "ACHAT", confiance: 90, justification: "x", taille_pct: 25 },
  ] }), CFG).portfolio;
  const r = applyRun(p, baseInput({ signaux: [
    { symbole: "OR.PA", action: "ACHAT", confiance: 90, justification: "x", taille_pct: 25 },
  ] }), CFG);
  assert.ok(r.portfolio.cash >= 0);
  if (r.applied.length) {
    const pos = r.portfolio.positions.find((x) => x.symbole === "OR.PA");
    assert.ok(pos.shares === Math.floor((10000 - 2500 - 1) / 380.38) || pos.shares >= 1);
  }
});

test("stop-perte declenche une vente automatique", () => {
  let p = initPortfolio(CFG, ASOF);
  p = applyRun(p, baseInput({ signaux: [
    { symbole: "AIR.PA", action: "ACHAT", confiance: 90, justification: "x", stop_perte: 195, prise_profit: 220, taille_pct: 20 },
  ] }), CFG).portfolio;
  const r = applyRun(p, baseInput({
    regime: "NORMAL",
    quotes: q({ "AIR.PA": 194 }),
    signaux: [],
  }), CFG);
  assert.equal(r.portfolio.positions.length, 0);
  const vente = r.applied.find((a) => a.action === "VENTE");
  assert.ok(vente);
  assert.match(vente.motif, /stop/i);
});

test("objectif atteint declenche une vente automatique", () => {
  let p = initPortfolio(CFG, ASOF);
  p = applyRun(p, baseInput({ signaux: [
    { symbole: "AIR.PA", action: "ACHAT", confiance: 90, justification: "x", stop_perte: 195, prise_profit: 215, taille_pct: 20 },
  ] }), CFG).portfolio;
  const r = applyRun(p, baseInput({ quotes: q({ "AIR.PA": 216 }), signaux: [] }), CFG);
  assert.equal(r.portfolio.positions.length, 0);
  assert.match(r.applied[0].motif, /objectif/i);
});

test("equity = cash + positions valorisees, history alimentee", () => {
  let p = initPortfolio(CFG, ASOF);
  const r = applyRun(p, baseInput({ signaux: [
    { symbole: "AIR.PA", action: "ACHAT", confiance: 90, justification: "x", stop_perte: 195, prise_profit: 215, taille_pct: 20 },
  ] }), CFG);
  const eq = equityOf(r.portfolio, r.portfolio.__lastQuotes || baseInput().quotes);
  assert.ok(eq > 9800 && eq < 10000);
  assert.equal(r.portfolio.history.length, 1);
  assert.equal(r.portfolio.history[0].cac, 7400);
});

test("vente d'une position inexistante rejetee", () => {
  const p = initPortfolio(CFG, ASOF);
  const r = applyRun(p, baseInput({ signaux: [
    { symbole: "AIR.PA", action: "VENTE", confiance: 90, justification: "x" },
  ] }), CFG);
  assert.equal(r.rejected[0].motif, "position_inexistante");
});

test("achat sur symbole absent des cours rejete", () => {
  const p = initPortfolio(CFG, ASOF);
  const r = applyRun(p, baseInput({ signaux: [
    { symbole: "INCONNU.PA", action: "ACHAT", confiance: 90, justification: "x", taille_pct: 10 },
  ] }), CFG);
  assert.equal(r.rejected[0].motif, "symbole_inconnu");
});
