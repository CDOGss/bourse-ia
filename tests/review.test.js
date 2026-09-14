import test from "node:test";
import assert from "node:assert/strict";
import { enregistrerSignaux, mettreAJourHorizons, rattacherResultatSortie } from "../src/review.js";

const J = 86400000;
const vide = () => ({ signaux: [], trades: [] });

test("enregistrerSignaux journalise un avis execute et un avis rejete", () => {
  const p = vide();
  const ajoute = enregistrerSignaux(p, {
    asOf: "2026-03-02T10:00:00.000Z",
    signaux: [
      { symbole: "AIR.PA", action: "ACHAT", confiance: 82, justification: "catalyseur" },
      { symbole: "TTE.PA", action: "ACHAT", confiance: 74, justification: "trop juste" },
    ],
    prixMap: { "AIR.PA": { nom: "Airbus", price: 200 }, "TTE.PA": { nom: "TotalEnergies", price: 60 } },
    cacLevel: 8000,
    motifsRejet: { "TTE.PA:ACHAT": "confiance_insuffisante" },
  });
  assert.equal(ajoute.length, 2);
  assert.equal(p.signaux.length, 2);
  const [a, b] = p.signaux;
  assert.equal(a.execute, true);
  assert.equal(a.prixSignal, 200);
  assert.equal(a.cacAuSignal, 8000);
  assert.equal(b.execute, false);
  assert.equal(b.motifRejet, "confiance_insuffisante");
});

test("enregistrerSignaux ne duplique pas un avis deja note la meme heure", () => {
  const p = vide();
  const entree = {
    asOf: "2026-03-02T10:00:00.000Z",
    signaux: [{ symbole: "AIR.PA", action: "ACHAT", confiance: 80, justification: "x" }],
    prixMap: { "AIR.PA": { price: 200 } },
    cacLevel: 8000,
    motifsRejet: {},
  };
  enregistrerSignaux(p, entree);
  enregistrerSignaux(p, entree);
  assert.equal(p.signaux.length, 1);
});

test("les horizons se remplissent a +7 et +30 jours, pas avant", () => {
  const p = vide();
  enregistrerSignaux(p, {
    asOf: "2026-03-01T10:00:00.000Z",
    signaux: [{ symbole: "AIR.PA", action: "ACHAT", confiance: 80, justification: "x" }],
    prixMap: { "AIR.PA": { price: 100 } },
    cacLevel: 8000,
    motifsRejet: {},
  });

  mettreAJourHorizons(p, { asOf: "2026-03-05T10:00:00.000Z", quotes: { "AIR.PA": { price: 105 } }, cacLevel: 8000 });
  assert.equal(p.signaux[0].h1s, null, "+4 jours : trop tot");

  mettreAJourHorizons(p, { asOf: "2026-03-09T10:00:00.000Z", quotes: { "AIR.PA": { price: 105 } }, cacLevel: 8100 });
  assert.equal(p.signaux[0].h1s.chgPct, 5);
  assert.equal(p.signaux[0].h1s.cacChgPct, 1.25);
  assert.equal(p.signaux[0].h1s.alphaPct, 3.75, "alpha = valeur - marche");
  assert.equal(p.signaux[0].h1m, null);

  mettreAJourHorizons(p, { asOf: "2026-04-02T10:00:00.000Z", quotes: { "AIR.PA": { price: 90 } }, cacLevel: 8000 });
  assert.equal(p.signaux[0].h1m.chgPct, -10);
  assert.equal(p.signaux[0].h1m.alphaPct, -10);
});

test("rattacherResultatSortie lie une vente a son signal d'achat le plus recent", () => {
  const p = vide();
  const entree = (date) => ({
    asOf: date,
    signaux: [{ symbole: "AIR.PA", action: "ACHAT", confiance: 80, justification: "x" }],
    prixMap: { "AIR.PA": { price: 100 } },
    cacLevel: 8000,
    motifsRejet: {},
  });
  enregistrerSignaux(p, entree("2026-03-01T10:00:00.000Z"));
  enregistrerSignaux(p, entree("2026-04-01T10:00:00.000Z"));
  assert.equal(p.signaux.length, 2);

  rattacherResultatSortie(p, { symbole: "AIR.PA", asOf: "2026-05-01T10:00:00.000Z", prix: 120, pnlPct: 20, motif: "objectif atteint" });
  assert.equal(p.signaux[1].solde.pnlPct, 20, "solde rattache a la derniere entree ouverte");
  assert.equal(p.signaux[0].solde, null, "une seule vente ne solde qu'une seule entree");
});

test("rattacherResultatSortie ignoree si aucun signal d'achat ouvert", () => {
  const p = vide();
  assert.equal(rattacherResultatSortie(p, { symbole: "X.PA", asOf: "2026-05-01T10:00:00.000Z", prix: 1, pnlPct: 1 }), null);
});

test("le journal est borne en taille", () => {
  const p = { signaux: Array.from({ length: 4200 }, (_, i) => ({ id: String(i) })) };
  enregistrerSignaux(p, {
    asOf: "2026-03-02T10:00:00.000Z",
    signaux: [{ symbole: "AIR.PA", action: "ACHAT", confiance: 80, justification: "x" }],
    prixMap: { "AIR.PA": { price: 100 } },
    cacLevel: 8000,
    motifsRejet: {},
  });
  assert.ok(p.signaux.length <= 4001, "taille = " + p.signaux.length);
});
