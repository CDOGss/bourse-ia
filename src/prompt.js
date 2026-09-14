import { readFileSync } from "node:fs";

const MARQUEUR_DEBUT = /<!--\s*PROMPT:BEGIN\s*-->([\s\S]*?)<!--\s*PROMPT:END\s*-->/g;

// Extrait la consigne systeme. La documentation du fichier cite les marqueurs : on retient donc
// le plus LONG des blocs trouves, jamais le premier (qui peut etre une mention de 6 caracteres
// dans une phrase d'explication). Sans ce garde-fou, une phrase de doc bien intentionnee vide
// silencieusement le prompt envoye au modele.
export function systemInstructionFrom(mdText, { tailleMin = 500 } = {}) {
  const candidats = [...String(mdText || "").matchAll(MARQUEUR_DEBUT)]
    .map((m) => m[1].trim())
    .filter((t) => t.length > 0);
  if (!candidats.length) throw new Error("PROMPT.md: bloc PROMPT:BEGIN/END introuvable");
  const bloc = candidats.reduce((a, b) => (b.length > a.length ? b : a));
  if (tailleMin && bloc.length < tailleMin) {
    throw new Error(
      `PROMPT.md: bloc PROMPT trop court (${bloc.length} caracteres) - la consigne systeme semble videe par une mention des marqueurs dans le texte`,
    );
  }
  return bloc;
}

export function loadSystemInstruction(path) {
  return systemInstructionFrom(readFileSync(path, "utf8"));
}
