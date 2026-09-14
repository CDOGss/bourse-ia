// Construit src/universe.candidates.json a partir de src/indices.json (composition des indices,
// reprise de Wikipedia) et des indices deja connus du depot.
//
//   npm run build:candidats      # ecrit src/universe.candidates.json
//   npm run validate:universe    # resout les tickers Yahoo .PA et ecrit src/universe.json
//
// Le CAC 40 est donne avec son mnemonique Euronext, qui est exactement le ticker Yahoo suffixe
// de .PA. Les autres valeurs du SBF 120 sont resolues par recherche Yahoo a la validation.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

const norm = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const indices = JSON.parse(readFileSync(SRC + "indices.json", "utf8"));
const deja = existsSync(SRC + "universe.candidates.json")
  ? JSON.parse(readFileSync(SRC + "universe.candidates.json", "utf8"))
  : [];

const parNorm = new Map(deja.map((e) => [norm(e.nom), e]));
const trouvee = (nom) => {
  const n = norm(nom);
  if (parNorm.has(n)) return parNorm.get(n);
  for (const [k, e] of parNorm) if (k && (k.startsWith(n) || n.startsWith(k))) return e;
  return null;
};

const resultat = new Map();
const ajouter = (nom, marche, mnemo) => {
  const cle = norm(nom);
  if (!cle) return;
  const existante = trouvee(nom);
  const candidats = [];
  if (mnemo) candidats.push(`${mnemo}.PA`);
  for (const c of existante?.candidates || []) if (!candidats.includes(c)) candidats.push(c);
  const precedent = resultat.get(cle);
  if (precedent) {
    precedent.candidates = [...new Set([...precedent.candidates, ...candidats])];
    if (marche === "CAC40") precedent.marche = "CAC40";
    return;
  }
  resultat.set(cle, {
    nom: existante?.nom && norm(existante.nom) === cle ? existante.nom : nom,
    marche,
    candidates: [...new Set(candidats)],
    ...(existante?.q ? { q: existante.q } : {}),
    ...(existante?.mustMatch ? { mustMatch: existante.mustMatch } : {}),
    ...(existante?.mustNotMatch ? { mustNotMatch: existante.mustNotMatch } : {}),
  });
};

for (const e of indices.cac40 || []) ajouter(e.nom, "CAC40", e.mnemo);
for (const nom of indices.sbf120 || []) ajouter(nom, "SBF120", null);
for (const e of deja) ajouter(e.nom, e.marche, null);

const brut = [...resultat.values()];

// Deux lignes peuvent designer la meme valeur (« Veolia » et « Veolia Environnement »). Un
// doublon fausserait la largeur de marche et ferait correspondre une position a deux entrees :
// on fusionne sur le premier ticker connu.
const parSymbole = new Map();
const liste = [];
for (const e of brut) {
  const sym = (e.candidates || []).find((c) => /\.PA$/.test(c));
  if (sym && parSymbole.has(sym)) {
    const garde = parSymbole.get(sym);
    garde.candidates = [...new Set([...garde.candidates, ...e.candidates])];
    if (e.marche === "CAC40") garde.marche = "CAC40";
    continue;
  }
  if (sym) parSymbole.set(sym, e);
  liste.push(e);
}

liste.sort((a, b) =>
  a.marche === b.marche ? a.nom.localeCompare(b.nom, "fr") : a.marche.localeCompare(b.marche),
);

writeFileSync(SRC + "universe.candidates.json", JSON.stringify(liste, null, 2) + "\n");
console.log(
  `CAC40 ${liste.filter((e) => e.marche === "CAC40").length} | ` +
  `SBF120 ${liste.filter((e) => e.marche === "SBF120").length} | total ${liste.length} candidats`,
);
console.log("prochaine etape : npm run validate:universe");
