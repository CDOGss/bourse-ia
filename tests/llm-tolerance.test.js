import test from "node:test";
import assert from "node:assert/strict";
import { validerAnalyseTolerante, SCHEMA_ANALYSE } from "../src/llm.js";

const U = ["AIR.PA", "TTE.PA"];
const bonSignal = { symbole: "AIR.PA", action: "ACHAT", confiance: 84, justification: "RSI 28, tendance HAUSSE_CONFIRMEE" };

test("validerAnalyseTolerante conserve les signaux valides et nomme les invalides", () => {
  const brut = {
    regime: "normal",
    resume_marche: "Seance partagee.",
    signaux: [
      bonSignal,
      { symbole: "HACK.PA", action: "ACHAT", confiance: 90, justification: "symbole invente" },
      { symbole: "TTE.PA", action: "SHORT", confiance: 70, justification: "action inventee" },
      { symbole: "TTE.PA", action: "VENTE", confiance: 71, justification: "" },
    ],
  };
  const { analyse, invalides } = validerAnalyseTolerante(brut, U);
  assert.equal(analyse.regime, "NORMAL");
  assert.equal(analyse.signaux.length, 1, "seul le signal conforme survit");
  assert.equal(analyse.signaux[0].symbole, "AIR.PA");
  assert.equal(invalides.length, 3);
  assert.ok(invalides.join(" ").includes("HACK.PA"));
  assert.ok(invalides.join(" ").includes("action invalide"));
  assert.ok(invalides.join(" ").includes("justification manquante"));
});

test("un regime hallucine n'interrompt pas le cycle mais durcit la posture", () => {
  const { analyse, invalides } = validerAnalyseTolerante(
    { regime: "SUPER_BULL", resume_marche: "x", signaux: [bonSignal] }, U,
  );
  assert.equal(analyse.regime, "PRUDENT", "faute de regime compris on prend le plus prudent");
  assert.equal(invalides.length, 1);
});

test("une reponse completement hors format donne une analyse nulle, sans exception", () => {
  assert.deepEqual(validerAnalyseTolerante(null, U), { analyse: null, invalides: ["reponse vide ou non objet"] });
  assert.deepEqual(validerAnalyseTolerante("bonjour", U).analyse, null);
});

test("signaux absent ou non tableau est tolere", () => {
  const { analyse, invalides } = validerAnalyseTolerante({ regime: "NORMAL", resume_marche: "r" }, U);
  assert.deepEqual(analyse.signaux, []);
  assert.equal(invalides.length, 1);
});

test("au-dela de 12 signaux on tronque au lieu de tout rejeter", () => {
  const brut = {
    regime: "NORMAL", resume_marche: "r",
    signaux: Array.from({ length: 20 }, (_, i) => ({ ...bonSignal, symbole: "AIR.PA", justification: "s" + i })),
  };
  const { analyse } = validerAnalyseTolerante(brut, U);
  assert.equal(analyse.signaux.length, 12);
});

test("le schema impose a l'API les champs lus par le moteur", () => {
  assert.deepEqual(SCHEMA_ANALYSE.required, ["regime", "resume_marche", "signaux"]);
  const sig = SCHEMA_ANALYSE.properties.signaux.items;
  for (const champ of ["symbole", "action", "confiance", "justification"]) {
    assert.ok(sig.required.includes(champ), champ + " doit etre exige du modele");
  }
  assert.deepEqual(sig.properties.action.enum, ["ACHAT", "VENTE", "CONSERVER"]);
  assert.deepEqual(SCHEMA_ANALYSE.properties.regime.enum, ["NORMAL", "PRUDENT", "CATASTROPHIQUE"]);
});
