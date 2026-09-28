import test from "node:test";
import assert from "node:assert/strict";
import { estJourFerieBoursier, horsSeance, marcheFerme, passageTropRecent } from "../src/marche.js";

const jour = (y, m, d) => new Date(y, m - 1, d);

test("jours fixes de fermeture d'Euronext Paris", () => {
  assert.ok(estJourFerieBoursier(jour(2026, 1, 1)), "1er janvier");
  assert.ok(estJourFerieBoursier(jour(2026, 5, 1)), "1er mai");
  assert.ok(estJourFerieBoursier(jour(2026, 12, 25)), "Noel");
  assert.ok(estJourFerieBoursier(jour(2025, 12, 26)), "26 decembre");
});

test("les feries francais hors calendrier Euronext sont des jours de seance", () => {
  assert.equal(estJourFerieBoursier(jour(2026, 5, 8)), false, "8 mai");
  assert.equal(estJourFerieBoursier(jour(2026, 7, 14)), false, "14 juillet");
  assert.equal(estJourFerieBoursier(jour(2027, 8, 15)), false, "15 aout");
  assert.equal(estJourFerieBoursier(jour(2027, 11, 1)), false, "Toussaint");
  assert.equal(estJourFerieBoursier(jour(2026, 11, 11)), false, "Armistice");
  assert.equal(estJourFerieBoursier(jour(2026, 5, 14)), false, "Ascension");
  assert.equal(estJourFerieBoursier(jour(2026, 5, 25)), false, "lundi de Pentecote");
});

test("jours mobiles calcules a partir de Paques 2026 (5 avril)", () => {
  assert.ok(estJourFerieBoursier(jour(2026, 4, 3)), "Vendredi saint");
  assert.ok(estJourFerieBoursier(jour(2026, 4, 6)), "lundi de Paques");
  assert.ok(estJourFerieBoursier(jour(2027, 3, 26)), "Paques 2027 : vendredi saint");
  assert.ok(estJourFerieBoursier(jour(2027, 3, 29)), "Paques 2027 : lundi de Paques");
});

test("un jour ouvrable ordinaire n'est pas ferme", () => {
  assert.equal(estJourFerieBoursier(jour(2026, 6, 15)), false);
  assert.equal(estJourFerieBoursier(jour(2026, 9, 14)), false);
  assert.equal(estJourFerieBoursier(jour(2026, 8, 14)), false, "15 aout n'est pas le 14");
});

test("marcheFerme distingue week-end, jour ferie et seance ouverte", () => {
  assert.equal(marcheFerme(new Date("2026-09-12T09:00:00Z")), "week-end", "samedi");
  assert.equal(marcheFerme(new Date("2026-09-13T09:00:00Z")), "week-end", "dimanche");
  assert.equal(marcheFerme(new Date("2026-12-25T09:00:00Z")), "jour ferie", "Noel");
  assert.equal(marcheFerme(new Date("2026-11-11T09:00:00Z")), null, "11 novembre : seance");
  assert.equal(marcheFerme(new Date("2026-09-14T09:00:00Z")), null, "lundi ordinaire");
});

test("passageTropRecent bloque les tentatives redondantes du cron", () => {
  const now = new Date("2026-09-16T13:30:00Z");
  const ilYA = (min) => ({ date: new Date(now - min * 60000).toISOString(), dryRun: false });
  assert.match(passageTropRecent(now, ilYA(20), 75), /20 min/, "passage 20 min avant : bloque");
  assert.notEqual(passageTropRecent(now, ilYA(74), 75), null, "74 min : encore bloque");
  assert.equal(passageTropRecent(now, ilYA(75), 75), null, "75 min : autorise");
  assert.equal(passageTropRecent(now, ilYA(180), 75), null, "3 h : autorise");
  assert.equal(passageTropRecent(now, null, 75), null, "premier passage : autorise");
  assert.equal(passageTropRecent(now, { ...ilYA(5), dryRun: true }, 75), null, "un dry-run ne compte pas");
  assert.equal(passageTropRecent(now, ilYA(5), 0), null, "garde desactivee si 0");
  assert.equal(passageTropRecent(now, { date: "n'importe quoi" }, 75), null, "date illisible : autorise");
});

test("horsSeance refuse avant 09:00 et apres 17:35 (heure de Paris)", () => {
  // Ete : Paris = UTC+2
  assert.match(horsSeance(new Date("2026-09-28T06:30:00Z")), /avant/, "08h30 Paris");
  assert.equal(horsSeance(new Date("2026-09-28T07:20:00Z")), null, "09h20 Paris");
  assert.equal(horsSeance(new Date("2026-09-28T15:20:00Z")), null, "17h20 Paris");
  assert.match(horsSeance(new Date("2026-09-28T17:12:00Z")), /apres/, "19h12 Paris (secours en retard)");
  // Hiver : Paris = UTC+1
  assert.equal(horsSeance(new Date("2026-12-01T16:20:00Z")), null, "17h20 Paris en hiver");
  assert.match(horsSeance(new Date("2026-12-01T16:50:00Z")), /apres/, "17h50 Paris en hiver");
});
