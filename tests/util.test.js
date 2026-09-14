import test from "node:test";
import assert from "node:assert/strict";
import { systemInstructionFrom } from "../src/prompt.js";
import { parseRss } from "../src/news.js";
import { validateAnalyse, callGemini } from "../src/llm.js";

test("systemInstructionFrom extrait le bloc PROMPT", () => {
  const md = "# titre\n\nblabla\n\n<!-- PROMPT:BEGIN -->\nCONSIGNE ${x}\n<!-- PROMPT:END -->\nreste\n";
  assert.equal(systemInstructionFrom(md, { tailleMin: 0 }), "CONSIGNE ${x}");
});

test("systemInstructionFrom refuse un bloc vide par une mention des marqueurs dans le texte", () => {
  // Le piege reel : la documentation cite les marqueurs, et le premier bloc trouve ne fait
  // alors que quelques caracteres. La vraie consigne (la plus longue) doit etre retenue.
  const md =
    "Le bloc `<!-- PROMPT:BEGIN -->` et `<!-- PROMPT:END -->` explique la consigne.\n" +
    "<!-- PROMPT:BEGIN -->\n" + "A".repeat(600) + "\n<!-- PROMPT:END -->\n";
  const consigne = systemInstructionFrom(md);
  assert.equal(consigne.length, 600, "le petit bloc documentaire ne doit pas gagner");
  assert.throws(() => systemInstructionFrom("Le bloc `<!-- PROMPT:BEGIN -->` et `<!-- PROMPT:END -->` seul."), /trop court/);
});

test("systemInstructionFrom leve si bloc absent", () => {
  assert.throws(() => systemInstructionFrom("# rien"));
});

const RSS_FIXTURE = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title><![CDATA[Krach : le CAC 40 l&agrave;che -4%]]></title><link>https://x.fr/a</link><pubDate>${new Date(Date.now() - 2 * 3600e3).toUTCString()}</pubDate><description>Casse generale</description></item>
<item><title>Vieux article</title><link>https://x.fr/b</link><pubDate>${new Date(Date.now() - 48 * 3600e3).toUTCString()}</pubDate><description>ancien</description></item>
<item><title><![CDATA[Krach : le CAC 40 l&agrave;che -4%]]></title><link>https://y.fr/a</link><pubDate>${new Date(Date.now() - 3 * 3600e3).toUTCString()}</pubDate></item>
<item><title>Nouveau</title><link>https://z.fr/c</link><pubDate>${new Date(Date.now() - 3600e3).toUTCString()}</pubDate></item>
</channel></rss>`;

test("parseRss extrait, sans rejeter les dates", () => {
  const items = parseRss(RSS_FIXTURE, "x.fr");
  assert.equal(items.length, 4);
  assert.equal(items[0].titre.includes("CDATA"), false);
  assert.equal(items[0].source, "x.fr");
});

test("callGemini echoue proprement sans cle API", async () => {
  await assert.rejects(
    () => callGemini({ model: "x", apiKey: "", systemInstruction: "s", payload: {} }),
    /GEMINI_API_KEY manquante/
  );
});

test("validateAnalyse accepte un payload conforme", () => {
  const ok = validateAnalyse({
    regime: "normal",
    resume_marche: "Seance calme",
    signaux: [{
      symbole: "air.pa", action: "achat", confiance: 82.6, justification: "ha",
      prix_entree: 100, stop_perte: 92, prise_profit: 115, taille_pct: 10,
    }],
  }, ["AIR.PA"]);
  assert.equal(ok.regime, "NORMAL");
  assert.equal(ok.signaux[0].symbole, "AIR.PA");
  assert.equal(ok.signaux[0].action, "ACHAT");
  assert.equal(ok.signaux[0].confiance, 83);
});

test("validateAnalyse rejette symbole inconnu / regime invalide / champs manquants", () => {
  const u = ["AIR.PA"];
  assert.throws(() => validateAnalyse({ regime: "X", resume_marche: "r", signaux: [] }, u));
  assert.throws(() => validateAnalyse({ regime: "NORMAL", resume_marche: "", signaux: [] }, u));
  assert.throws(() => validateAnalyse({ regime: "NORMAL", resume_marche: "r", signaux: [
    { symbole: "HACK.PA", action: "ACHAT", confiance: 80, justification: "x" },
  ] }, u));
  assert.throws(() => validateAnalyse({ regime: "NORMAL", resume_marche: "r", signaux: [
    { symbole: "AIR.PA", action: "SHORT", confiance: 80, justification: "x" },
  ] }, u));
  assert.throws(() => validateAnalyse({ regime: "NORMAL", resume_marche: "r", signaux: "nope" }, u));
});
