// Journal des signaux : chaque avis emis par le modele est enregistre, qu'il ait ete execute
// par les garde-fous ou non. A +1 semaine et +1 mois, on releve ce qu'il est devenu et on
// compare au CAC 40 sur la meme fenetre. C'est ce journal qui repond a la vraie question de la
// phase papier : le modele a-t-il du jugote, independamment de la facon dont le portefeuille
// l'applique ?

const r2 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 100) / 100);
const JOURS = { h1s: 7, h1m: 30 };

let compteur = 0;
function nouvelId(asOf, symbole, index) {
  compteur += 1;
  return `${asOf.slice(0, 16).replace(/[:T]/g, "")}-${symbole}-${index}`;
}

// Ajoute les signaux du passage courant au journal.
export function enregistrerSignaux(portfolio, entrees) {
  const { asOf, signaux, prixMap, cacLevel, motifsRejet } = entrees;
  const log = portfolio.signaux || (portfolio.signaux = []);
  const dejaEnregistres = new Set(
    log.filter((s) => (s.date || "").slice(0, 13) === asOf.slice(0, 13)).map((s) => `${s.symbole}:${s.action}`),
  );

  const ajoutes = [];
  (signaux || []).forEach((s, i) => {
    const cle = `${s.symbole}:${s.action}`;
    if (dejaEnregistres.has(cle)) return;
    dejaEnregistres.add(cle);
    const prix = prixMap?.[s.symbole]?.price ?? null;
    const ligne = {
      id: nouvelId(asOf, s.symbole, i),
      date: asOf,
      symbole: s.symbole,
      nom: prixMap?.[s.symbole]?.nom || s.symbole,
      action: s.action,
      confiance: s.confiance,
      prixSignal: prix,
      cacAuSignal: cacLevel ?? null,
      execute: !motifsRejet?.[s.symbole + ":" + s.action],
      motifRejet: motifsRejet?.[s.symbole + ":" + s.action] || null,
      justification: (s.justification || "").slice(0, 300),
      h1s: null,
      h1m: null,
      solde: null,
    };
    log.push(ligne);
    ajoutes.push(ligne);
  });

  // On borne la taille du journal (un an de passages environ 1 300 lignes).
  if (log.length > 4000) portfolio.signaux = log.slice(-4000);
  return ajoutes;
}

function evalHorizon(entree, prixActuel, cacActuel, asOf, joursAttendus) {
  if (entree.prixSignal == null || prixActuel == null) return null;
  const ageJours = (new Date(asOf) - new Date(entree.date)) / 86400000;
  if (!isFinite(ageJours) || ageJours < joursAttendus) return null;
  const chgPct = ((prixActuel - entree.prixSignal) / entree.prixSignal) * 100;
  let cacChgPct = null;
  if (entree.cacAuSignal != null && cacActuel != null) {
    cacChgPct = ((cacActuel - entree.cacAuSignal) / entree.cacAuSignal) * 100;
  }
  return {
    date: asOf,
    jours: Math.round(ageJours),
    prix: r2(prixActuel),
    chgPct: r2(chgPct),
    cacChgPct: r2(cacChgPct),
    alphaPct: cacChgPct == null ? null : r2(chgPct - cacChgPct),
  };
}

// Renseigne les horizons echus. Les signaux VENTE sont lus a l'envers : un bon signal de vente
// est un signal dont la valeur a BAISSE depuis (l'alpha est alors negatif, ce qui est un succes).
export function mettreAJourHorizons(portfolio, { asOf, quotes, cacLevel }) {
  let misAJour = 0;
  for (const s of portfolio.signaux || []) {
    const prix = quotes?.[s.symbole]?.price ?? null;
    for (const [cle, jours] of Object.entries(JOURS)) {
      if (!s[cle]) {
        const h = evalHorizon(s, prix, cacLevel, asOf, jours);
        if (h) {
          s[cle] = h;
          misAJour += 1;
        }
      }
    }
  }
  return misAJour;
}

// Quand une position est revendue, on rattache le resultat a son signal d'entree.
export function rattacherResultatSortie(portfolio, { symbole, asOf, prix, pnlPct, motif }) {
  const log = portfolio.signaux || [];
  for (let i = log.length - 1; i >= 0; i--) {
    const s = log[i];
    if (s.symbole === symbole && s.action === "ACHAT" && !s.solde) {
      s.solde = { date: asOf, prix: r2(prix), pnlPct: r2(pnlPct), motif };
      return s;
    }
  }
  return null;
}
