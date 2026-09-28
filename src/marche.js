// Calendrier boursier d'Euronext Paris.
//
// Fermetures (calendrier officiel Euronext, marche actions) : 1er janvier, Vendredi saint,
// lundi de Paques, 1er mai, 25 et 26 decembre. Les autres feries francais (8 mai, Ascension,
// lundi de Pentecote, 14 juillet, 15 aout, 1er et 11 novembre) sont des jours de SEANCE.
// Seances : 09:00 a 17:30 heure de Paris.

function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}

const FIXES = new Set(["01-01", "05-01", "12-25", "12-26"]);

// `localDate` : date civile locale (heure de Paris), sans composante horaire trompeuse.
export function estJourFerieBoursier(localDate) {
  const y = localDate.getFullYear();
  const md = `${String(localDate.getMonth() + 1).padStart(2, "0")}-${String(localDate.getDate()).padStart(2, "0")}`;
  if (FIXES.has(md)) return true;
  const rel = (offset) => {
    const d = new Date(easter(y).getTime() + offset * 86400000);
    return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  };
  return new Set([rel(-2), rel(1)]).has(md); // Vendredi saint, lundi de Paques
}

// Renvoie un motif (chaine) si le marche est ferme, null s'il est ouvert.
export function marcheFerme(now = new Date()) {
  const wd = now.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", weekday: "short" });
  if (wd === "dim." || wd === "sam.") return "week-end";
  const local = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  if (estJourFerieBoursier(local)) return "jour ferie";
  return null;
}

// Renvoie un motif si l'heure de Paris est hors seance (09:00-17:35), null sinon. Un
// lancement de secours du cron GitHub peut arriver avec plusieurs heures de retard :
// on refuse alors d'analyser apres la cloture (cours figes, ordres impossibles).
export function horsSeance(now = new Date()) {
  const [h, m] = now
    .toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hour12: false })
    .split(":")
    .map(Number);
  const minutes = h * 60 + m;
  if (minutes < 9 * 60) return `avant l'ouverture (${String(h).padStart(2, "0")}h${String(m).padStart(2, "0")} Paris)`;
  if (minutes > 17 * 60 + 35) return `apres la cloture (${String(h).padStart(2, "0")}h${String(m).padStart(2, "0")} Paris)`;
  return null;
}

// Garde d'espacement : renvoie un motif si un vrai passage (hors dry-run) a eu lieu il y a
// moins de `minutes`, null sinon. Sert quand le cron tente plusieurs fois le meme creneau.
export function passageTropRecent(now, dernierRun, minutes) {
  if (!minutes || !dernierRun?.date || dernierRun.dryRun) return null;
  const ecartMin = (now - new Date(dernierRun.date)) / 60000;
  if (Number.isNaN(ecartMin) || ecartMin < 0 || ecartMin >= minutes) return null;
  return `dernier passage il y a ${Math.round(ecartMin)} min (< ${minutes} min)`;
}
