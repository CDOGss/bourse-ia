// Merique d'evaluation de la phase papier. Tout part du portefeuille (trades, journal des
// signaux, historique de valorisation) : rien n'est demande au modele. Le verdict go/no-go
// n'est rendu qu'une fois les seuils de volume atteints, pour ne pas conclure sur du bruit.

const r1 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 100) / 100);

// Regroupe l'historique par jour de bourse (plusieurs passages par jour).
function seriesJournaliere(history) {
  const parJour = new Map();
  for (const h of history || []) {
    if (h.equity == null || !h.date) continue;
    const jour = h.date.slice(0, 10);
    parJour.set(jour, { date: h.date, jour, equity: h.equity, cac: h.cac ?? null });
  }
  return [...parJour.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, v]) => v);
}

function maxDrawdownPct(series) {
  let sommet = null;
  let md = 0;
  for (const s of series) {
    if (sommet == null || s.equity > sommet) sommet = s.equity;
    if (sommet > 0) md = Math.min(md, ((s.equity - sommet) / sommet) * 100);
  }
  return r1(md);
}

function sharpe(series) {
  if (!series || series.length < 20) return null;
  const rets = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].equity;
    if (prev > 0 && series[i].equity > 0) rets.push(series[i].equity / prev - 1);
  }
  if (rets.length < 20) return null;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1));
  if (!sd) return null;
  return r2((m / sd) * Math.sqrt(252));
}

function statSignaux(signaux, action) {
  const lignes = (signaux || []).filter((s) => s.action === action);
  const evalues = lignes.filter((s) => s.h1m && s.h1m.alphaPct != null);
  // Pour un ACHAT la reussite = alpha positif. Pour une VENTE la reussite = alpha negatif
  // (la valeur a sous-performe le marche apres l'avis).
  const sens = action === "VENTE" ? -1 : 1;
  const reussis = evalues.filter((s) => s.h1m.alphaPct * sens > 0).length;
  const alphaMoyen = evalues.length
    ? evalues.reduce((a, s) => a + s.h1m.alphaPct, 0) / evalues.length
    : null;
  const alphaMoyen1s = lignes.filter((s) => s.h1s?.alphaPct != null);
  return {
    nb: lignes.length,
    nbEvalues: evalues.length,
    tauxReussitePct: evalues.length ? r1((reussis / evalues.length) * 100) : null,
    alphaMoyen1mPct: r2(alphaMoyen),
    alphaMoyen1sPct: alphaMoyen1s.length
      ? r2(alphaMoyen1s.reduce((a, s) => a + s.h1s.alphaPct, 0) / alphaMoyen1s.length)
      : null,
  };
}

// Calibration : le modele annonce une confiance. On verifie qu'un 80 annonce se realise
// effectivement plus souvent qu'un 60. Sans calibration, le seuil de confiance n'a pas de sens.
function calibration(signaux) {
  const evalues = (signaux || []).filter((s) => s.action === "ACHAT" && s.h1m?.alphaPct != null);
  if (evalues.length < 10) return null;
  const tranches = [
    { label: "50-69", min: 50, max: 69 },
    { label: "70-79", min: 70, max: 79 },
    { label: "80-100", min: 80, max: 100 },
  ];
  const out = [];
  for (const t of tranches) {
    const g = evalues.filter((s) => s.confiance >= t.min && s.confiance <= t.max);
    if (!g.length) continue;
    out.push({
      tranche: t.label,
      nb: g.length,
      tauxReussitePct: r1((g.filter((s) => s.h1m.alphaPct > 0).length / g.length) * 100),
      alphaMoyenPct: r2(g.reduce((a, s) => a + s.h1m.alphaPct, 0) / g.length),
    });
  }
  return out.length >= 2 ? out : null;
}

export function calculerMeriques(portfolio, { equity, cacLevel, config }) {
  const seuils = config?.evaluation || {};
  const minAgeJours = seuils.ageMinJours ?? 90;
  const minTrades = seuils.tradesSoldesMin ?? 20;
  const alphaMin = seuils.alphaMinPct ?? 0;
  const pfMin = seuils.profitFactorMin ?? 1.3;
  const mdMax = seuils.maxDrawdownMinPct ?? -20;

  const cap0 = portfolio.meta?.initialCapital ?? 0;
  const trades = portfolio.trades || [];
  const ventes = trades.filter((t) => t.action === "VENTE" && t.pnlPct != null);
  const achats = trades.filter((t) => t.action === "ACHAT");
  const gains = ventes.filter((t) => t.pnlPct > 0);
  const pertes = ventes.filter((t) => t.pnlPct <= 0);

  const series = seriesJournaliere(portfolio.history);
  const brut = series.length > 1 ? (Date.parse(series.at(-1).date) - Date.parse(series[0].date)) / 86400000 : 0;
  // Un age illisible doit rester prudent : jamais conclure sur un historique mal forme.
  const ageJours = isFinite(brut) && brut > 0 ? brut : 0;

  const perfPct = cap0 > 0 ? ((equity - cap0) / cap0) * 100 : null;
  const cac0 = series.find((s) => s.cac)?.cac ?? null;
  const cacPerfPct = cac0 && cacLevel ? ((cacLevel - cac0) / cac0) * 100 : null;
  const alphaPct = perfPct != null && cacPerfPct != null ? perfPct - cacPerfPct : null;

  // P/L en euros a partir du produit de vente et du pourcentage :
  //   montant = investi * (1 + pnl/100)  =>  P/L = montant * pnl / (100 + pnl)
  const pnlEur = (t) => {
    const d = 100 + t.pnlPct;
    if (!isFinite(d) || d <= 0) return 0;
    return (t.montant * t.pnlPct) / d;
  };
  const montantGagne = gains.reduce((a, t) => a + pnlEur(t), 0);
  const montantPerdu = Math.abs(pertes.reduce((a, t) => a + pnlEur(t), 0));
  const profitFactor = montantPerdu > 0 ? montantGagne / montantPerdu : montantGagne > 0 ? null : null;

  const fraisCumules = trades.reduce((a, t) => a + (t.frais || 0), 0);
  const ttfCumule = trades.reduce((a, t) => a + (t.ttf || 0), 0);
  const montantAchat = achats.reduce((a, t) => a + (t.montant || 0), 0);
  const expositionPct = equity > 0 ? ((equity - portfolio.cash) / equity) * 100 : null;

  const sig = {
    achats: statSignaux(portfolio.signaux, "ACHAT"),
    ventes: statSignaux(portfolio.signaux, "VENTE"),
    calibration: calibration(portfolio.signaux),
  };

  // --- Verdict ---
  const raisons = [];
  let etat;
  if (ageJours < minAgeJours || ventes.length < minTrades) {
    etat = "PAS_ENCORE_CONCLUANT";
    if (ageJours < minAgeJours) raisons.push(`il faut ${minAgeJours} jours de recul (actuellement ${Math.round(ageJours)})`);
    if (ventes.length < minTrades) raisons.push(`il faut ${minTrades} positions soldees (actuellement ${ventes.length})`);
  } else {
    const pbAlpha = alphaPct == null || alphaPct <= alphaMin;
    const pbPf = profitFactor != null && profitFactor < 1;
    const pfFaible = profitFactor != null && profitFactor < pfMin;
    const pbDd = maxDrawdownPct(series) != null && maxDrawdownPct(series) < mdMax;
    const pbJugote = sig.achats.nbEvalues >= 10 && sig.achats.alphaMoyen1mPct != null && sig.achats.alphaMoyen1mPct <= 0;
    if (pbAlpha || pbPf || pbJugote) {
      etat = "REJETE";
      if (pbAlpha) raisons.push("le portefeuille ne bat pas le CAC 40 sur la periode");
      if (pbPf) raisons.push("les pertes cumulees depassent les gains cumules");
      if (pbJugote) raisons.push("les signaux d'achat perdent du terrain face au marche a un mois");
    } else if (pfFaible || pbDd) {
      etat = "FRAGILE";
      if (pfFaible) raisons.push(`profit factor sous ${pfMin}`);
      if (pbDd) raisons.push(`drawdown au-dela de ${mdMax} %`);
    } else {
      etat = "VALIDE";
      raisons.push("tous les criteres de passage en reel sont remplis");
    }
  }

  return {
    ageJours: Math.round(ageJours),
    nbPassages: (portfolio.history || []).length,
    equity: r2(equity),
    perfPct: r2(perfPct),
    cacPerfPct: r2(cacPerfPct),
    alphaPct: r2(alphaPct),
    maxDrawdownPct: maxDrawdownPct(series),
    sharpe: sharpe(series),
    expositionPct: r1(expositionPct),
    trades: {
      nbAchats: achats.length,
      nbSolde: ventes.length,
      tauxReussitePct: ventes.length ? r1((gains.length / ventes.length) * 100) : null,
      gainMoyenPct: gains.length ? r2(gains.reduce((a, t) => a + t.pnlPct, 0) / gains.length) : null,
      perteMoyennePct: pertes.length ? r2(pertes.reduce((a, t) => a + t.pnlPct, 0) / pertes.length) : null,
      profitFactor: profitFactor == null ? null : r2(profitFactor),
      montantGagne: r2(montantGagne),
      montantPerdu: r2(montantPerdu),
    },
    couts: {
      fraisCumules: r2(fraisCumules),
      ttfCumule: r2(ttfCumule),
      totalEur: r2(fraisCumules + ttfCumule),
      montantAchete: r2(montantAchat),
      coutEnPctDuCapital: cap0 ? r2(((fraisCumules + ttfCumule) / cap0) * 100) : null,
    },
    signaux: sig,
    verdict: {
      etat,
      raisons,
      criteres: { ageMinJours: minAgeJours, tradesSoldesMin: minTrades, alphaMinPct: alphaMin, profitFactorMin: pfMin, maxDrawdownMinPct: mdMax },
    },
  };
}
