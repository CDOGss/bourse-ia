import test from "node:test";
import assert from "node:assert/strict";
import { callGemini } from "../src/llm.js";

const reponseOk = (objet) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(objet) }] } }] }),
});

const analyseValide = { regime: "NORMAL", resume_marche: "r", signaux: [] };

function boucherie(appels) {
  global.fetch = async (url, options) => {
    appels.push(JSON.parse(options.body));
    return appeler();
  };
  let etape = 0;
  const reponses = [];
  const appeler = () => reponses.shift()();
  return {
    programmer(...rs) {
      reponses.push(...rs);
    },
    appels,
  };
}

test("en cas de 400, l'appel est rejoue sans niveau de reflexion ni outil", async () => {
  const h = boucherie([]);
  h.programmer(
    async () => ({ ok: false, status: 400, text: async () => '{"error":{"message":"thinkingConfig not supported"}}' }),
    async () => reponseOk(analyseValide),
  );
  const r = await callGemini({
    model: "gemini-test", apiKey: "k", systemInstruction: "s", payload: {}, thinkingLevel: "high",
  });
  assert.deepEqual(r, analyseValide);
  assert.equal(h.appels.length, 2);
  assert.ok(h.appels[0].thinkingConfig, "la premiere tentative demandait bien un niveau de reflexion");
  assert.equal(h.appels[1].thinkingConfig, undefined, "repli sans thinkingConfig");
  assert.equal(h.appels[1].tools, undefined);
});

test("en dernier recours, le schema contraint est retire mais le JSON reste demande", async () => {
  const h = boucherie([]);
  h.programmer(
    async () => ({ ok: false, status: 400, text: async () => "schema refuse" }),
    async () => ({ ok: false, status: 400, text: async () => "refuse encore" }),
    async () => reponseOk(analyseValide),
  );
  const r = await callGemini({ model: "m", apiKey: "k", systemInstruction: "s", payload: {} });
  assert.deepEqual(r, analyseValide);
  assert.equal(h.appels.length, 3);
  assert.ok(h.appels[0].generationConfig.responseSchema, "le schema etait present au premier essai");
  assert.equal(h.appels[2].generationConfig.responseSchema, undefined, "schema retire au troisieme essai");
  assert.equal(h.appels[2].generationConfig.responseMimeType, "application/json");
});

test("un JSON mal forme declenche une relance de relecture, pas un echec", async () => {
  const h = boucherie([]);
  h.programmer(
    async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: "voici mes reflexions" }] } }] }),
    }),
    async () => reponseOk(analyseValide),
  );
  const r = await callGemini({ model: "m", apiKey: "k", systemInstruction: "s", payload: {} });
  assert.deepEqual(r, analyseValide);
  assert.equal(h.appels.length, 2);
  const roles = h.appels[1].contents.map((c) => c.role);
  assert.deepEqual(roles, ["user", "model", "user"], "la relance doit montrer la reponse fautive");
  assert.match(h.appels[1].contents.at(-1).parts[0].text, /JSON precedent etait invalide/);
});

test("une reponse entouree de texte ou de balises est tout de meme extraite", async () => {
  const h = boucherie([]);
  h.programmer(async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Analyse rapide :\n```json\n" + JSON.stringify(analyseValide) + "\n```\nVoila." }] } }],
    }),
  }));
  assert.deepEqual(await callGemini({ model: "m", apiKey: "k", systemInstruction: "s", payload: {} }), analyseValide);
});

test("une cle API absente est signalee avant tout appel reseau", async () => {
  let appels = 0;
  global.fetch = () => { appels++; throw new Error("ne doit pas appeler"); };
  await assert.rejects(
    () => callGemini({ model: "m", apiKey: "", systemInstruction: "s", payload: {} }),
    /GEMINI_API_KEY manquante/,
  );
  assert.equal(appels, 0);
});
