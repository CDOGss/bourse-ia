import test from "node:test";
import assert from "node:assert/strict";
import { sma, rsi, volatilitie, etatTendance, calculerIndicateurs, largeurDuMarche } from "../src/indicators.js";

const suite = (n) => Array.from({ length: n }, (_, i) => 100 + i);

test("sma moyenne les n dernieres valeurs", () => {
  assert.equal(sma([1, 2, 3, 4], 2), 3.5);
  assert.equal(sma([1, 2], 5), null, "historique insuffisant");
});

test("rsi vaut 100 en hausse pure et 0 en baisse pure", () => {
  assert.equal(rsi(suite(30), 14), 100);
  assert.equal(rsi(suite(30).reverse(), 14), 0);
  assert.equal(rsi([1, 2, 3], 14), null);
});

test("rsi revient vers 50 sur une serie alternee", () => {
  const zigzag = Array.from({ length: 40 }, (_, i) => 100 + (i % 2 ? 1 : -1));
  const v = rsi(zigzag, 14);
  assert.ok(v > 40 && v < 60, "attendu ~50, recu " + v);
});

test("volatilitie est nulle sur une serie plate et positive sinon", () => {
  assert.equal(volatilitie(new Array(30).fill(100), 20), 0);
  const v = volatilitie(suite(30), 20);
  assert.ok(v > 0 && v < 200, "volatilite aberrante: " + v);
});

test("etatTendance distingue hausse et baisse confirmees", () => {
  const hausse = [...Array.from({ length: 220 }, (_, i) => 100 + i * 0.5)];
  const baisse = [...Array.from({ length: 220 }, (_, i) => 300 - i * 0.5)];
  assert.equal(etatTendance(hausse).etat, "HAUSSE_CONFIRMEE");
  assert.equal(etatTendance(baisse).etat, "BAISSE_CONFIRMEE");
  assert.equal(etatTendance([1, 2, 3]), null, "historique insuffisant");
});

test("calculerIndicateurs produit un resume complet et coherent", () => {
  const closes = Array.from({ length: 254 }, (_, i) => 50 + Math.sin(i / 9) * 6 + i * 0.05);
  const ind = calculerIndicateurs(closes);
  assert.ok(ind, "resume attendu");
  assert.equal(ind.nb_seances, 254);
  assert.ok(ind.sma200 != null && ind.sma50 != null && ind.sma20 != null);
  assert.ok(ind.plus_haut_52s > ind.plus_bas_52s);
  assert.ok(ind.dist_plus_haut_52s_pct <= 0, "le cours ne peut pas depasser son plus haut");
  assert.ok(ind.dist_plus_bas_52s_pct >= 0);
  assert.ok(["SURVENTE", "NEUTRE", "SURACHAT"].includes(ind.signal_technique));
});

test("calculerIndicateurs refuse un historique trop court", () => {
  assert.equal(calculerIndicateurs([100, 101, 102]), null);
  assert.equal(calculerIndicateurs([]), null);
});

test("largeurDuMarche classe la sante du marche", () => {
  const toutes = (auDessus) =>
    Array.from({ length: 40 }, () => ({ prix: auDessus ? 120 : 80, sma200: 100 }));
  assert.equal(largeurDuMarche(toutes(true)).etat, "HAUSSE_GENERALISEE");
  assert.equal(largeurDuMarche(toutes(false)).etat, "BAISSE_GENERALISEE");
  assert.equal(largeurDuMarche([{ prix: 1, sma200: 1 }]), null, "effectif insuffisant");
  const mixte = [...toutes(true).slice(0, 20), ...toutes(false).slice(0, 20)];
  assert.equal(largeurDuMarche(mixte).auDessusSma200Pct, 50);
});
