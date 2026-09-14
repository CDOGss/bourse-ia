import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RACINE = fileURLToPath(new URL("../", import.meta.url));
const run = readFileSync(RACINE + "src/run.js", "utf8");
const prompt = readFileSync(RACINE + "PROMPT.md", "utf8");
const blocPrompt = prompt.match(/<!--\s*PROMPT:BEGIN\s*-->([\s\S]*?)<!--\s*PROMPT:END\s*-->/)?.[1] || "";

// Les blocs que le moteur envoie au modele. Ajouter un bloc ici oblige a le decrire dans
// PROMPT.md : un champ recu sans explication est un champ que le modele interprete de travers.
const BLOCS = ["contexte", "couts", "largeur_marche", "portefeuille", "valeurs", "actualites", "memoire"];

test("le payload construit par run.js contient bien chaque bloc attendu", () => {
  for (const bloc of BLOCS) {
    assert.match(
      run,
      new RegExp(`^\\s{4}${bloc}\\s*[,:]`, "m"),
      `bloc "${bloc}" absent du payload`,
    );
  }
});

test("la vraie consigne systeme est extraite entiere, pas videe par la documentation", async () => {
  const { systemInstructionFrom } = await import("../src/prompt.js");
  const consigne = systemInstructionFrom(prompt);
  assert.ok(consigne.length > 1500, "consigne trop courte : " + consigne.length + " caracteres");
  assert.match(consigne, /^Tu es analyste quantitatif/m);
  assert.ok(!consigne.includes("PROMPT:BEGIN"), "les marqueurs ne doivent pas fuiter dans la consigne");
});

test("chaque bloc est explique au modele dans le prompt", () => {
  assert.ok(blocPrompt.length > 1500, "bloc PROMPT tronque ?");
  for (const bloc of BLOCS) {
    assert.ok(
      new RegExp(`\`?${bloc}\`?\\s*:`, "i").test(blocPrompt),
      `le prompt ne decrit pas le bloc "${bloc}" recu par le modele`,
    );
  }
});

test("les champs de donnees techniques sont decrits au modele", () => {
  for (const champ of ["rsi14", "sma200", "volatilita_ann_pct", "tendance", "dist_plus_haut_52s_pct", "chg126d"]) {
    assert.ok(blocPrompt.includes(champ), `champ "${champ}" calcule mais jamais explique`);
  }
});

test("le prompt exige le format de sortie lu par le moteur", () => {
  for (const champ of ["regime", "resume_marche", "signaux", "confiance", "justification", "invalidation"]) {
    assert.ok(blocPrompt.includes(champ), `champ de sortie "${champ}" absent du prompt`);
  }
  assert.match(blocPrompt, /Reponds UNIQUEMENT par un objet JSON/);
});

test("le prompt interdit l'invention de donnees et la vente a decouvert", () => {
  assert.match(blocPrompt, /N'invente jamais/);
  assert.match(blocPrompt, /Pas de vente a decouvert/);
});
