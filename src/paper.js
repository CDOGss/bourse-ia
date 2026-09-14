const round2 = (x) => Math.round(x * 100) / 100;

export function initPortfolio(config, isoDate) {
  return {
    meta: {
      initialCapital: config.initialCapital,
      currency: "EUR",
      startDate: isoDate,
      createdAt: new Date().toISOString(),
      feePct: config.feePct,
      ttfPct: config.ttfPct ?? 0,
    },
    cash: config.initialCapital,
    positions: [],
    trades: [],
    history: [],
    signaux: [],
  };
}

export function equityOf(portfolio, quotes) {
  let eq = portfolio.cash;
  for (const pos of portfolio.positions) {
    const price = quotes?.[pos.symbole]?.price ?? pos.price ?? pos.pmc;
    eq += pos.shares * price;
  }
  return round2(eq);
}

function sell(portfolio, pos, price, motif, applied, asOf, config) {
  const brut = pos.shares * price;
  const frais = brut * (config.feePct || 0) / 100;
  // La taxe sur les transactions financieres francaises ne frappe que les achats.
  const proceeds = brut - frais;
  portfolio.cash = round2(portfolio.cash + proceeds);
  const pnlPct = round2(((price - pos.pmc) / pos.pmc) * 100);
  const pnlEur = round2(proceeds - pos.shares * pos.pmc);
  portfolio.trades.push({
    date: asOf, symbole: pos.symbole, nom: pos.nom, action: "VENTE",
    shares: pos.shares, prix: round2(price), montant: round2(proceeds),
    pmc: pos.pmc, pnlPct, pnlEur, frais: round2(frais), ttf: 0, motif,
  });
  applied.push({
    symbole: pos.symbole, nom: pos.nom, action: "VENTE", shares: pos.shares,
    prix: round2(price), montant: round2(proceeds), pnlPct, pnlEur, motif,
  });
  portfolio.positions = portfolio.positions.filter((p) => p.symbole !== pos.symbole);
}

export function applyRun(portfolioIn, input, config) {
  const p = structuredClone(portfolioIn);
  const { asOf, quotes } = input;
  const applied = [];
  const rejected = [];

  let regime = input.regime === "CATASTROPHIQUE" || input.regime === "PRUDENT" ? input.regime : "NORMAL";
  if ((input.cacChangePct ?? 0) <= config.krachSeuilPct) regime = "CATASTROPHIQUE";

  for (const pos of p.positions) {
    const q = quotes[pos.symbole];
    if (q?.price) pos.price = round2(q.price);
  }

  for (const pos of [...p.positions]) {
    if (!pos.price) continue;
    if (pos.price <= pos.stop) {
      sell(p, pos, pos.price, "stop-perte declenche", applied, asOf, config);
    } else if (pos.price >= pos.target) {
      sell(p, pos, pos.price, "objectif atteint", applied, asOf, config);
    }
  }

  const signals = [...(input.signaux || [])]
    .filter((s) => s.action === "ACHAT" || s.action === "VENTE")
    .sort((a, b) => {
      if (a.action !== b.action) return a.action === "VENTE" ? -1 : 1;
      return (b.confiance ?? 0) - (a.confiance ?? 0);
    });

  let achats = 0;
  for (const s of signals) {
    const sym = s.symbole;
    const quote = quotes[sym];
    if (!quote?.price) {
      rejected.push({ symbole: sym, action: s.action, motif: "symbole_inconnu" });
      continue;
    }
    const price = quote.price;
    const pos = p.positions.find((x) => x.symbole === sym);

    if (s.action === "VENTE") {
      if (!pos) {
        rejected.push({ symbole: sym, action: "VENTE", motif: "position_inexistante" });
        continue;
      }
      sell(p, pos, price, s.justification || "vente decidee par l'IA", applied, asOf, config);
      continue;
    }

    if (pos) {
      rejected.push({ symbole: sym, action: "ACHAT", motif: "position_deja_ouverte" });
      continue;
    }
    if (regime === "CATASTROPHIQUE") {
      rejected.push({ symbole: sym, action: "ACHAT", motif: "journee_catastrophique" });
      continue;
    }
    if ((s.confiance ?? 0) < config.minConfiance) {
      rejected.push({ symbole: sym, action: "ACHAT", motif: "confiance_insuffisante" });
      continue;
    }
    if (achats >= config.maxAchatsParRun) {
      rejected.push({ symbole: sym, action: "ACHAT", motif: "max_achats_passage" });
      continue;
    }
    if (p.positions.length >= config.maxPositions) {
      rejected.push({ symbole: sym, action: "ACHAT", motif: "max_positions" });
      continue;
    }

    const equity = equityOf(p, quotes);
    const taille = Math.min(Math.max(s.taille_pct ?? 10, 1), config.maxPoidsLigne);
    // Deboursee a l'achat = cours + courtage + taxe francaise sur les transactions (TTF).
    const feePct = config.feePct || 0;
    const ttfPct = config.ttfPct || 0;
    const coutUnite = price * (1 + feePct / 100 + ttfPct / 100);
    let budget = Math.min((equity * taille) / 100, p.cash);
    let shares = Math.floor(budget / coutUnite);
    if (shares < 1) {
      rejected.push({ symbole: sym, action: "ACHAT", motif: "cash_insuffisant" });
      continue;
    }
    let spend = shares * coutUnite;
    if (spend > p.cash) {
      shares = Math.floor(p.cash / coutUnite);
      spend = shares * coutUnite;
      if (shares < 1) {
        rejected.push({ symbole: sym, action: "ACHAT", motif: "cash_insuffisant" });
        continue;
      }
    }
    const brut = shares * price;
    const frais = brut * feePct / 100;
    const ttf = brut * ttfPct / 100;
    p.cash = round2(p.cash - spend);
    p.positions.push({
      symbole: sym,
      nom: quote.nom || sym,
      shares,
      pmc: round2(spend / shares),
      price,
      stop: s.stop_perte > 0 && s.stop_perte < price ? round2(s.stop_perte) : round2(price * 0.92),
      target: s.prise_profit > price ? round2(s.prise_profit) : round2(price * 1.15),
      dateAchat: asOf,
      these: s.justification || "",
      confiance: s.confiance,
    });
    achats += 1;
    p.trades.push({
      date: asOf, symbole: sym, nom: quote.nom || sym, action: "ACHAT",
      shares, prix: round2(price), montant: round2(spend),
      frais: round2(frais), ttf: round2(ttf), motif: s.justification || "",
      confiance: s.confiance, stop: s.stop_perte > 0 ? round2(s.stop_perte) : null,
      objectif: s.prise_profit > price ? round2(s.prise_profit) : null,
    });
    applied.push({
      symbole: sym, nom: quote.nom || sym, action: "ACHAT", shares,
      prix: round2(price), montant: round2(spend), motif: s.justification || "",
      confiance: s.confiance,
    });
  }

  const equity = equityOf(p, quotes);
  p.history.push({ date: asOf, equity, cac: input.cacLevel ?? null });
  if (p.history.length > 3000) p.history = p.history.slice(-3000);

  return { portfolio: p, applied, rejected, regimeApplique: regime };
}
