import { sleep } from "./lib/http.js";

const ACTIONS = new Set(["ACHAT", "VENTE", "CONSERVER"]);
const REGIMES = new Set(["NORMAL", "PRUDENT", "CATASTROPHIQUE"]);

const isNum = (v) => typeof v === "number" && isFinite(v);

// Contrat de sortie : imposer le schema supprime toute une categorie d'echecs (virgule
// manquante, champ renomme, texte autour du JSON). Le modele ne peut repondre qu'en conformite.
export const SCHEMA_ANALYSE = {
  type: "object",
  properties: {
    regime: { type: "string", enum: ["NORMAL", "PRUDENT", "CATASTROPHIQUE"] },
    resume_marche: { type: "string" },
    signaux: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          symbole: { type: "string" },
          action: { type: "string", enum: ["ACHAT", "VENTE", "CONSERVER"] },
          confiance: { type: "integer" },
          justification: { type: "string" },
          prix_entree: { type: "number" },
          stop_perte: { type: "number" },
          prise_profit: { type: "number" },
          taille_pct: { type: "number" },
          invalidation: { type: "string" },
        },
        required: ["symbole", "action", "confiance", "justification"],
      },
    },
  },
  required: ["regime", "resume_marche", "signaux"],
};

function normaliserSignal(s, i) {
  const sym = String(s?.symbole || "").toUpperCase();
  const action = String(s?.action || "").toUpperCase();
  const confiance = Math.round(Number(s?.confiance));
  const justification = String(s?.justification || "").trim();
  const numOrNull = (v) => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
  const taille = s?.taille_pct == null ? null : Number(s.taille_pct);
  return {
    symbole: sym,
    action,
    confiance,
    justification: justification.slice(0, 400),
    prix_entree: numOrNull(s?.prix_entree),
    stop_perte: numOrNull(s?.stop_perte),
    prise_profit: numOrNull(s?.prise_profit),
    taille_pct: taille == null ? null : Math.min(taille, 100),
    invalidation: String(s?.invalidation || "").trim().slice(0, 300) || null,
  };
}

export function validerSignal(s, i, knownSymbols) {
  const out = normaliserSignal(s, i);
  if (!knownSymbols.has(out.symbole)) throw new Error(`signal ${i}: symbole inconnu ${out.symbole}`);
  if (!ACTIONS.has(out.action)) throw new Error(`signal ${i}: action invalide ${s?.action}`);
  if (!isNum(out.confiance) || out.confiance < 0 || out.confiance > 100)
    throw new Error(`signal ${i}: confiance invalide ${s?.confiance}`);
  if (!out.justification) throw new Error(`signal ${i}: justification manquante`);
  if (out.taille_pct != null && (out.taille_pct < 0 || out.taille_pct > 100))
    throw new Error(`signal ${i}: taille_pct invalide`);
  return out;
}

// Version stricte : la moindre anomalie fait echouer l'analyse. Utile aux tests et a la
// relecture d'une reponse.
export function validateAnalyse(obj, universeSymbols) {
  const known = new Set(universeSymbols);
  if (!obj || typeof obj !== "object") throw new Error("reponse IA vide ou non objet");
  const regime = String(obj.regime || "").toUpperCase();
  if (!REGIMES.has(regime)) throw new Error(`regime invalide: ${obj.regime}`);
  const resume = typeof obj.resume_marche === "string" ? obj.resume_marche.trim() : "";
  if (!resume) throw new Error("resume_marche manquant");
  if (!Array.isArray(obj.signaux)) throw new Error("signaux manquant (tableau attendu)");
  if (obj.signaux.length > 12) throw new Error("trop de signaux (>12)");
  return {
    regime,
    resume_marche: resume.slice(0, 1200),
    signaux: obj.signaux.map((s, i) => validerSignal(s, i, known)),
  };
}

// Version tolerante utilisee en production : un signal hallucine (symbole inexistant, action
// inventee) est ecarte, le reste de l'analyse est conserve. Un seul champ faux ne doit pas
// couter un cycle de deux heures ni empecher le declenchement des stops.
export function validerAnalyseTolerante(obj, universeSymbols) {
  const known = new Set(universeSymbols);
  const invalides = [];
  if (!obj || typeof obj !== "object") {
    return { analyse: null, invalides: ["reponse vide ou non objet"] };
  }
  let regime = String(obj.regime || "").toUpperCase();
  if (!REGIMES.has(regime)) {
    invalides.push(`regime invalide (${obj.regime}) force a NORMAL`);
    regime = "PRUDENT";
  }
  const resume = String(obj.resume_marche || "").trim().slice(0, 1200) || "(resume absent de la reponse du modele)";
  const brut = Array.isArray(obj.signaux) ? obj.signaux : [];
  if (!Array.isArray(obj.signaux)) invalides.push("signaux absents : tableau vide retenu");
  const signaux = [];
  brut.slice(0, 12).forEach((s, i) => {
    try {
      signaux.push(validerSignal(s, i, known));
    } catch (e) {
      invalides.push(e.message);
    }
  });
  return { analyse: { regime, resume_marche: resume, signaux }, invalides };
}

function extraireJson(texte) {
  const t = texte.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidat = fence ? fence[1].trim() : t;
  const debut = candidat.indexOf("{");
  const fin = candidat.lastIndexOf("}");
  const propre = debut >= 0 && fin > debut ? candidat.slice(debut, fin + 1) : candidat;
  return JSON.parse(propre);
}

function estReparable(err) {
  const m = String(err?.message || "");
  return /JSON|Unexpected|parse|is not valid JSON|MAX_TOKENS|trunc/i.test(m);
}

// Appel a Gemini avec : variante complete -> sans parametres optionnels si l'API les refuse
// (400), nouvelle tentative sur 429/5xx, et relance de relecture si le JSON est mal forme.
export async function callGemini({
  model,
  apiKey,
  systemInstruction,
  payload,
  grounding = false,
  thinkingLevel = "high",
  maxOutputTokens = 8192,
  maxTentatives = 4,
}) {
  if (!apiKey) throw new Error("GEMINI_API_KEY manquante");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const variantes = [];
  const generationConfig = { temperature: 0.4, maxOutputTokens, responseMimeType: "application/json", responseSchema: SCHEMA_ANALYSE };
  const corps = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
    generationConfig,
  };
  if (thinkingLevel && thinkingLevel !== "none") corps.thinkingConfig = { thinkingLevel };
  if (grounding) corps.tools = [{ google_search: {} }];
  variantes.push(corps);
  variantes.push({ ...corps, thinkingConfig: undefined, tools: undefined });
  // Dernier recours : certaines versions de l'API refusent le schema contraint. Le contrat de
  // sortie reste exigé par le prompt, et `validerAnalyseTolerante` fait le tri cote moteur.
  variantes.push({
    ...corps,
    thinkingConfig: undefined,
    tools: undefined,
    generationConfig: { temperature: 0.4, maxOutputTokens, responseMimeType: "application/json" },
  });

  let dernierErreur = null;
  let varianteIdx = 0;
  let relanceRelecture = 0;

  for (let tentative = 0; tentative < maxTentatives; tentative++) {
    const corpsActif = variantes[Math.min(varianteIdx, variantes.length - 1)];
    const reqCorps = structuredClone(corpsActif);
    if (relanceRelecture > 0) {
      reqCorps.contents.push({
        role: "model",
        parts: [{ text: "J'ai repondu avec un JSON invalide." }],
      });
      reqCorps.contents.push({
        role: "user",
        parts: [{ text: "Le JSON precedent etait invalide ou tronque. Renvoie exactement le meme contenu, cette fois en JSON strict et complet." }],
      });
    }

    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(reqCorps),
        signal: AbortSignal.timeout(180000),
      });
    } catch (e) {
      dernierErreur = e;
      await sleep(3000 * (tentative + 1));
      continue;
    }

    const texte = await res.text();

    if (res.status === 400 && varianteIdx < variantes.length - 1) {
      // L'API refuse un parametre (niveau de reflexion, outil, schema) : on replie.
      varianteIdx += 1;
      dernierErreur = new Error(`HTTP 400: ${texte.slice(0, 200)}`);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      dernierErreur = new Error(`HTTP ${res.status}: ${texte.slice(0, 200)}`);
      await sleep(Math.min(30000, 4000 * 2 ** tentative));
      continue;
    }
    if (!res.ok) {
      let msg = texte.slice(0, 300);
      try {
        msg = JSON.parse(texte)?.error?.message || msg;
      } catch {}
      throw new Error(`API Gemini HTTP ${res.status}: ${msg}`);
    }

    const j = JSON.parse(texte);
    const candidat = j?.candidates?.[0];
    const out = (candidat?.content?.parts || []).map((p) => p.text || "").join("");
    if (!out.trim()) {
      dernierErreur = new Error(`reponse Gemini vide (finishReason=${candidat?.finishReason || "?"})`);
      await sleep(2000);
      continue;
    }
    try {
      return extraireJson(out);
    } catch (e) {
      dernierErreur = e;
      if (estReparable(e) && relanceRelecture === 0) {
        relanceRelecture = 1;
        continue;
      }
      throw new Error(`reponse Gemini inexploitable: ${e.message}`);
    }
  }
  throw dernierErreur || new Error("appel Gemini epuise");
}
