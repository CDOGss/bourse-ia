// Indicateurs techniques calcules a partir des seules clotures journalieres renvoyees par
// Yahoo (spark ne fournit ni plus haut / plus bas ni volumes). Tout est derive, rien n'est
// invente : ces valeurs sont transmises a l'IA pour qu'elle appuie ses arrets sur des chiffres
// reels plutot que sur sa seule impression.

const r2 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 100) / 100);
const r1 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 10) / 10);

export function sma(values, n) {
  if (!values || values.length < n) return null;
  const tail = values.slice(-n);
  return tail.reduce((a, b) => a + b, 0) / n;
}

// RSI de Wilder sur les clotures.
export function rsi(values, n = 14) {
  if (!values || values.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = values.length - n; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  if (loss === 0) return gain === 0 ? 50 : 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

// Volatilite annualisee (en %) a partir des rendements log sur n seances.
export function volatilitie(values, n = 20) {
  if (!values || values.length < n + 1) return null;
  const rets = [];
  for (let i = values.length - n; i < values.length; i++) {
    const prev = values[i - 1];
    if (!prev || values[i] <= 0) return null;
    rets.push(Math.log(values[i] / prev));
  }
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1 || 1);
  return Math.sqrt(v * 252) * 100;
}

// Tendance longue : comparaison de la moyenne courte a la moyenne longue + pente de la longue.
export function etatTendance(closes, court = 50, long = 200) {
  if (!closes || closes.length < long + 5) return null;
  const mCourte = sma(closes, court);
  const mLongue = sma(closes, long);
  const mLongueAvant = sma(closes.slice(0, -20), long);
  if (mCourte == null || mLongue == null || mLongueAvant == null) return null;
  const pentePct = ((mLongue - mLongueAvant) / mLongueAvant) * 100;
  const ecartPct = ((mCourte - mLongue) / mLongue) * 100;
  let etat;
  if (mCourte > mLongue && pentePct > 0.5) etat = "HAUSSE_CONFIRMEE";
  else if (mCourte > mLongue) etat = "HAUSSE_FAIBLE";
  else if (mCourte < mLongue && pentePct < -0.5) etat = "BAISSE_CONFIRMEE";
  else etat = "NEUTRE";
  return { etat, pentePct: r2(pentePct), ecartPct: r2(ecartPct) };
}

// Resume complet pour une valeur. `closes` : clotures journaliees, de la plus ancienne a la
// plus recente (derniere = dernier cours connu).
export function calculerIndicateurs(closes) {
  const v = (closes || []).filter((c) => typeof c === "number" && isFinite(c) && c > 0);
  if (v.length < 30) return null;
  const last = v[v.length - 1];
  const s20 = sma(v, 20);
  const s50 = sma(v, 50);
  const s200 = sma(v, 200);
  const r = rsi(v, 14);
  const vol = volatilitie(v, 20);
  const fenetre = v.slice(-252);
  const hi = Math.max(...fenetre);
  const lo = Math.min(...fenetre);
  const tend = etatTendance(v);
  const pct = (ref) => (ref ? r2(((last - ref) / ref) * 100) : null);

  let signalTechnique = "NEUTRE";
  if (r != null) {
    if (r <= 30) signalTechnique = "SURVENTE";
    else if (r >= 70) signalTechnique = "SURACHAT";
  }

  return {
    sma20: r2(s20),
    sma50: r2(s50),
    sma200: r2(s200),
    ecart_sma20_pct: pct(s20),
    ecart_sma50_pct: pct(s50),
    ecart_sma200_pct: pct(s200),
    rsi14: r1(r),
    volatilita_ann_pct: r1(vol),
    plus_haut_52s: r2(hi),
    plus_bas_52s: r2(lo),
    dist_plus_haut_52s_pct: pct(hi),
    dist_plus_bas_52s_pct: pct(lo),
    chg63d: v.length >= 64 ? pct(v[v.length - 64]) : null,
    chg126d: v.length >= 127 ? pct(v[v.length - 127]) : null,
    tendance: tend ? tend.etat : null,
    tendance_pente_pct: tend ? tend.pentePct : null,
    nb_seances: v.length,
    signal_technique: signalTechnique,
  };
}

// Largeur de marche : part des valeurs de l'univers au-dessus de leur moyenne a 200 jours.
// Mesure la sante du marche, independamment de l'avis du modele.
export function largeurDuMarche(entries) {
  const withSma = (entries || []).filter((e) => e && e.sma200 != null && e.prix != null);
  if (withSma.length < 10) return null;
  const above = withSma.filter((e) => e.prix > e.sma200).length;
  const auDessusPct = (above / withSma.length) * 100;
  let regimeLargeur;
  if (auDessusPct >= 70) regimeLargeur = "HAUSSE_GENERALISEE";
  else if (auDessusPct >= 45) regimeLargeur = "PARTAGEE";
  else if (auDessusPct >= 25) regimeLargeur = "FAIBLE";
  else regimeLargeur = "BAISSE_GENERALISEE";
  return { auDessusSma200Pct: r1(auDessusPct), nbValeurs: withSma.length, etat: regimeLargeur };
}
