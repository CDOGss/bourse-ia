import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { initPortfolio, applyRun, equityOf } from "./paper.js";
import { fetchQuotes, fetchBenchmark } from "./quotes.js";
import { largeurDuMarche } from "./indicators.js";
import { fetchNews } from "./news.js";
import { callGemini, validerAnalyseTolerante } from "./llm.js";
import { systemInstructionFrom } from "./prompt.js";
import { marcheFerme, passageTropRecent } from "./marche.js";
import { enregistrerSignaux, mettreAJourHorizons, rattacherResultatSortie } from "./review.js";
import { calculerMeriques } from "./metrics.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const argVal = (f) => {
  const a = argv.find((x) => x.startsWith(f + "="));
  return a ? a.slice(f.length + 1) : null;
};

function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 1));
}

function lireJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// Ce que le modele sait de son propre parcours : ses derniers avis et leur resultat mesure.
// Sans cette boucle, chaque passage repart de zero et ne peut pas s'ameender.
function construireMemoire(portfolio, dernierRun) {
  const decisions = (portfolio.signaux || []).slice(-25).map((s) => ({
    date: s.date.slice(0, 16),
    symbole: s.symbole,
    action: s.action,
    confiance: s.confiance,
    execute: s.execute,
    motif_rejet: s.motifRejet,
    h1s: s.h1s ? { chg_pct: s.h1s.chgPct, alpha_pct: s.h1s.alphaPct } : null,
    h1m: s.h1m ? { chg_pct: s.h1m.chgPct, alpha_pct: s.h1m.alphaPct } : null,
    solde: s.solde ? { pnl_pct: s.solde.pnlPct, motif: s.solde.motif } : null,
  }));
  const achatsEvalues = (portfolio.signaux || []).filter(
    (s) => s.action === "ACHAT" && s.h1m?.alphaPct != null,
  );
  const alphaMoyen = achatsEvalues.length
    ? Math.round((achatsEvalues.reduce((a, s) => a + s.h1m.alphaPct, 0) / achatsEvalues.length) * 100) / 100
    : null;
  return {
    decisions,
    rejets_recents: (dernierRun?.rejetes || []).map((r) => ({
      symbole: r.symbole,
      action: r.action,
      motif: r.motif,
    })),
    bilan: {
      nb_achats_juges: achatsEvalues.length,
      alpha_moyen_achats_1m_pct: alphaMoyen,
      nb_positions_soldees: (portfolio.trades || []).filter((t) => t.action === "VENTE").length,
    },
  };
}

async function main() {
  const t0 = Date.now();
  const dataDir = argVal("--data-dir") || join(ROOT, "data");
  const now = argVal("--now") ? new Date(argVal("--now")) : new Date();
  const dryRun = has("--dry-run");

  if (!has("--force")) {
    const closed = marcheFerme(now);
    if (closed) {
      console.log(`marche ferme (${closed}) - rien a faire`);
      return;
    }
  }

  const config = JSON.parse(readFileSync(join(ROOT, "config.json"), "utf8"));

  // Le cron tente chaque creneau plusieurs fois (GitHub en saute souvent) : une seule tentative
  // doit aboutir. `--force` court-circuite la garde pour les lancements manuels.
  const dernierRun = lireJson(join(dataDir, "last-run.json"));
  if (!has("--force")) {
    const recent = passageTropRecent(now, dernierRun, config.espacementMinMinutes);
    if (recent) {
      console.log(`${recent} - rien a faire`);
      return;
    }
  }

  const universe = JSON.parse(readFileSync(join(ROOT, "src", "universe.json"), "utf8"));
  const systemInstruction = systemInstructionFrom(readFileSync(join(ROOT, "PROMPT.md"), "utf8"));
  const gf = config.gardeFous;
  const engineCfg = {
    initialCapital: config.miseDepart,
    feePct: config.fraisPct,
    ttfPct: config.taxeTransactionPct ?? 0,
    minConfiance: gf.confianceMinimale,
    maxAchatsParRun: gf.maxAchatsParPassage,
    maxPositions: gf.maxPositions,
    maxPoidsLigne: gf.maxPoidsLignePct,
    krachSeuilPct: gf.seuilKrachPct,
  };

  const portfolioPath = join(dataDir, "portfolio.json");
  let portfolio = lireJson(portfolioPath) || initPortfolio(engineCfg, now.toISOString());
  if (!Array.isArray(portfolio.signaux)) portfolio.signaux = [];
  if (!Array.isArray(portfolio.trades)) portfolio.trades = [];

  console.log("[1/5] cours et indicateurs...");
  const valeurs = await fetchQuotes(universe);
  if (valeurs.length < Math.min(40, universe.length)) {
    throw new Error(`cours insuffisants (${valeurs.length}) - run interrompu, etat non modifie`);
  }
  const cac = await fetchBenchmark(config.benchmark);
  const largeur = largeurDuMarche(valeurs);
  console.log(
    `      ${valeurs.length} cours, CAC40 = ${cac.level} (${cac.chg1d > 0 ? "+" : ""}${cac.chg1d} %), ` +
    `largeur ${largeur ? largeur.auDessusSma200Pct + " % au-dessus de la SMA200" : "indisponible"}`,
  );

  const quotesMap = Object.fromEntries(valeurs.map((v) => [v.symbole, { nom: v.nom, price: v.prix }]));

  console.log("[2/5] actualites...");
  const { items: newsItems, errors: newsErrors } = await fetchNews({
    config, universe, quotes: valeurs, holdings: portfolio.positions,
  });
  console.log(`      ${newsItems.length} titres${newsErrors.length ? ` (${newsErrors.length} flux en echec)` : ""}`);

  console.log("[3/5] memoire du modele...");
  const memoire = construireMemoire(portfolio, dernierRun);

  let analyse;
  const model = process.env.GEMINI_MODEL || config.modele;
  const courtage = config.fraisPct ?? 0;
  const ttf = config.taxeTransactionPct ?? 0;
  const payload = {
    contexte: {
      date: now.toISOString(),
      heure_paris: now.toLocaleString("fr-FR", { timeZone: "Europe/Paris" }),
      cac40: { niveau: cac.level, chg1d: cac.chg1d },
      seuil_krach_pct: gf.seuilKrachPct,
      nb_passages: (portfolio.history || []).length + 1,
      jours_ecoules: portfolio.meta?.startDate
        ? Math.max(0, Math.round((now - new Date(portfolio.meta.startDate)) / 86400000))
        : 0,
      limites: {
        max_achats_par_passage: gf.maxAchatsParPassage,
        max_positions: gf.maxPositions,
        max_poids_ligne_pct: gf.maxPoidsLignePct,
        confiance_minimale_achat: gf.confianceMinimale,
      },
    },
    couts: {
      courtage_pct: courtage,
      taxe_transaction_francaise_pct: ttf,
      total_pct: Math.round((2 * courtage + ttf) * 100) / 100,
      remarque: "cout d un aller-retour, deja deduit de la simulation",
    },
    largeur_marche: largeur,
    portefeuille: {
      capital_initial: portfolio.meta?.initialCapital ?? config.miseDepart,
      cash: portfolio.cash,
      valorisation: equityOf(portfolio, quotesMap),
      part_investie_pct: (() => {
        const eq = equityOf(portfolio, quotesMap);
        return eq > 0 ? Math.round(((eq - portfolio.cash) / eq) * 1000) / 10 : null;
      })(),
      positions: portfolio.positions.map((p) => ({
        symbole: p.symbole,
        nom: p.nom,
        shares: p.shares,
        pmc: p.pmc,
        prix_actuel: quotesMap[p.symbole]?.price ?? p.price,
        pnl_pct: (() => {
          const px = quotesMap[p.symbole]?.price ?? p.price;
          return px && p.pmc ? Math.round(((px - p.pmc) / p.pmc) * 1000) / 10 : null;
        })(),
        stop: p.stop,
        objectif: p.target,
        depuis: p.dateAchat?.slice(0, 10),
        these: (p.these || "").slice(0, 220),
      })),
    },
    valeurs,
    actualites: newsItems.map((n) => ({
      source: n.source, date: n.date, titre: n.titre, description: n.description.slice(0, 140),
    })),
    memoire,
  };

  if (dryRun) {
    analyse = {
      regime: "NORMAL",
      resume_marche: "MODE ESSAI (dry-run) : aucun appel a l'IA, aucun ordre genere.",
      signaux: [],
    };
    console.log("[4/5] analyse ignoree (dry-run)");
  } else {
    console.log(`[4/5] analyse Gemini (${model}, reflexion ${config.reflexion || "high"})...`);
    const raw = await callGemini({
      model,
      apiKey: process.env.GEMINI_API_KEY,
      systemInstruction,
      payload,
      grounding: config.grounding,
      thinkingLevel: config.reflexion || "high",
    });
    const { analyse: a, invalides } = validerAnalyseTolerante(raw, universe.map((u) => u.symbol));
    if (!a) throw new Error("reponse du modele inexploitable");
    if (invalides.length) console.log(`      ${invalides.length} signal(aux) ecarte(s) : ${invalides.join(" | ").slice(0, 300)}`);
    analyse = { ...a, signaux_ecartes: invalides };
  }

  console.log("[5/5] garde-fous, papier trading, evaluation...");
  const res = applyRun(portfolio, {
    asOf: now.toISOString(),
    regime: analyse.regime,
    cacLevel: cac.level,
    cacChangePct: cac.chg1d,
    quotes: quotesMap,
    signaux: analyse.signaux,
  }, engineCfg);

  // Rattache chaque vente au signal d'achat qui l'a ouverte, puis enregistre les avis du jour
  // et fait avancer les horizons a +1 semaine / +1 mois des avis plus anciens.
  mettreAJourHorizons(res.portfolio, { asOf: now.toISOString(), quotes: quotesMap, cacLevel: cac.level });
  for (const v of res.applied.filter((x) => x.action === "VENTE")) {
    rattacherResultatSortie(res.portfolio, {
      symbole: v.symbole, asOf: now.toISOString(), prix: v.prix, pnlPct: v.pnlPct, motif: v.motif,
    });
  }
  const motifsRejet = Object.fromEntries(
    res.rejected.map((r) => [`${r.symbole}:${r.action}`, r.motif]),
  );
  for (const s of analyse.signaux) {
    if (s.action === "CONSERVER") motifsRejet[`${s.symbole}:${s.action}`] = "avis_de_conservation";
  }
  enregistrerSignaux(res.portfolio, {
    asOf: now.toISOString(),
    signaux: analyse.signaux,
    prixMap: quotesMap,
    cacLevel: cac.level,
    motifsRejet,
  });

  const equity = equityOf(res.portfolio, quotesMap);
  const meriques = calculerMeriques(res.portfolio, { equity, cacLevel: cac.level, config });

  writeJson(portfolioPath, res.portfolio);
  writeJson(join(dataDir, "quotes.json"), {
    date: now.toISOString(),
    cac: { niveau: cac.level, chg1d: cac.chg1d },
    largeur: largeur,
    valeurs,
  });
  writeJson(join(dataDir, "last-run.json"), {
    date: now.toISOString(),
    dureeS: Math.round((Date.now() - t0) / 1000),
    dryRun,
    modele: model,
    regime: analyse.regime,
    regimeApplique: res.regimeApplique,
    resume_marche: analyse.resume_marche,
    signaux: analyse.signaux,
    signaux_ecartes: analyse.signaux_ecartes || [],
    appliques: res.applied,
    rejetes: res.rejected,
    fluxEnEchec: newsErrors,
    meriques,
    stats: {
      equity,
      cash: res.portfolio.cash,
      nbPositions: res.portfolio.positions.length,
    },
  });

  for (const a of res.applied) {
    console.log(`  ${a.action} ${a.symbole} x${a.shares} @ ${a.prix} (${a.motif})`);
  }
  const v = meriques.verdict;
  console.log(
    `equity=${equity} EUR cash=${res.portfolio.cash} positions=${res.portfolio.positions.length} ` +
    `regime=${res.regimeApplique} | perf ${meriques.perfPct} % vs CAC ${meriques.cacPerfPct} % ` +
    `| evaluation: ${v.etat}${v.raisons.length ? " (" + v.raisons.join(", ") + ")" : ""}`,
  );
}

main().catch((e) => {
  console.error("ERREUR:", e.message);
  process.exitCode = 1;
});
