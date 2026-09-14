const fmtEur = (v) => v == null ? "-" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const fmt2 = (v) => v == null ? "-" : new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const fmtPct = (v) => v == null ? "-" : `${v > 0 ? "+" : ""}${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(v)} %`;
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }) : "-";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const css = "data/";

async function load(name) {
  try {
    const res = await fetch(`${css}${name}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function badge(texte, cls) {
  const el = document.getElementById("regime-badge");
  el.textContent = texte;
  el.className = `badge ${cls || ""}`;
}

function cards(p, run, cac) {
  const el = document.getElementById("compte");
  const equity = run?.stats?.equity ?? p?.meta?.initialCapital;
  const perf = p?.meta ? ((equity - p.meta.initialCapital) / p.meta.initialCapital) * 100 : null;
  const hist = p?.history?.filter((h) => h.cac);
  let benchPerf = null;
  if (hist && hist.length > 1 && p.meta) {
    const cac0 = hist[0].cac;
    const cacN = hist[hist.length - 1].cac;
    benchPerf = ((cacN - cac0) / cac0) * 100;
  }
  el.innerHTML = `
    <div class="card"><div class="label">Valorisation</div><div class="value">${fmtEur(equity)}</div></div>
    <div class="card"><div class="label">Perf. ${p?.meta ? ((p.history?.length || 1) + " pass.") : ""}</div><div class="value ${perf > 0 ? "pos" : perf < 0 ? "neg" : ""}">${fmtPct(perf)}</div></div>
    <div class="card"><div class="label">CAC 40 meme periode</div><div class="value ${benchPerf > 0 ? "pos" : benchPerf < 0 ? "neg" : ""}">${fmtPct(benchPerf)}</div><div class="sub">vs perf portefeuille</div></div>
    <div class="card"><div class="label">Espèces</div><div class="value">${fmtEur(p?.cash)}</div></div>
    <div class="card"><div class="label">Positions</div><div class="value">${p?.positions?.length ?? 0}</div></div>
    <div class="card"><div class="label">CAC 40</div><div class="value">${fmt2(cac?.niveau)}</div><div class="sub ${cac?.chg1d > 0 ? "pos" : "neg"}">${fmtPct(cac?.chg1d)} jour</div></div>`;
}

const ACTION_CLS = { ACHAT: "pos", VENTE: "neg", CONSERVER: "" };

function signaux(run, quotes) {
  const tbody = document.querySelector("#signaux tbody");
  const sigs = run?.signaux || [];
  tbody.innerHTML = sigs.length ? sigs.map((s) => `
    <tr>
      <td class="${ACTION_CLS[s.action] || ""}"><strong>${esc(s.action)}</strong></td>
      <td>${esc(nomOf(s.symbole, quotes))}<span class="muted"> ${esc(s.symbole)}</span></td>
      <td>${s.confiance}</td>
      <td>${fmt2(s.prix_entree)}</td>
      <td>${fmt2(s.stop_perte)}</td>
      <td>${fmt2(s.prise_profit)}</td>
      <td>${s.taille_pct != null ? s.taille_pct + " %" : "-"}</td>
      <td class="justif">${esc(s.justification)}</td>
    </tr>`).join("")
    : `<tr><td colspan="8" class="muted">Aucun signal au dernier passage (le systeme considere qu'il ne faut rien faire).</td></tr>`;

  const rejets = run?.rejetes || [];
  const ecartes = run?.signaux_ecartes || [];
  const lignes = [];
  if (rejets.length) lignes.push(`Ordres filtrés par les garde-fous : ${rejets.map((r) => `${r.action} ${r.symbole} (${r.motif})`).join(", ")}`);
  if (ecartes.length) lignes.push(`Signaux écartés car invalides (${ecartes.length}) : ${ecartes.map((e) => esc(String(e))).join(" · ")}`);
  document.getElementById("rejets").innerHTML = lignes.map((l) => `<div>${l}</div>`).join("");
}

function nomOf(sym, quotes) {
  const v = quotes?.valeurs?.find((x) => x.symbole === sym);
  return v ? v.nom : sym;
}

function positions(p, quotes) {
  const tbody = document.querySelector("#positions tbody");
  tbody.innerHTML = p.positions.length ? p.positions.map((x) => {
    const cours = quotes?.valeurs?.find((v) => v.symbole === x.symbole)?.prix ?? x.price;
    const pl = cours && x.pmc ? ((cours - x.pmc) / x.pmc) * 100 : null;
    return `<tr>
      <td>${esc(x.nom)}<span class="muted"> ${esc(x.symbole)}</span></td>
      <td>${x.shares}</td><td>${fmt2(x.pmc)}</td><td>${fmt2(cours)}</td>
      <td class="${pl > 0 ? "pos" : pl < 0 ? "neg" : ""}">${fmtPct(pl)}</td>
      <td>${fmt2(x.stop)}</td><td>${fmt2(x.target)}</td>
      <td class="justif">${esc(x.these)}</td></tr>`;
  }).join("") : `<tr><td colspan="8" class="muted">Aucune position ouverte — portefeuille 100 % especes.</td></tr>`;
}

function courbe(p) {
  const el = document.getElementById("courbe");
  const h = p.history || [];
  if (h.length < 2) { el.innerHTML = `<p class="muted">Courbe disponible apres quelques passages.</p>`; return; }
  const W = 900, H = 260, PAD = 44;
  const eq0 = p.meta.initialCapital, cac0 = h.find((x) => x.cac)?.cac;
  const seriesP = h.filter((x) => x.cac != null).map((x) => ((x.equity - eq0) / eq0) * 100);
  const seriesC = h.filter((x) => x.cac != null).map((x) => ((x.cac - cac0) / cac0) * 100);
  const all = [...seriesP, ...seriesC];
  const min = Math.min(...all, 0), max = Math.max(...all, 0);
  const X = (i) => PAD + (i / Math.max(all.length - 1, 1)) * (W - PAD * 2);
  const Y = (v) => H - PAD - ((v - min) / (max - min || 1)) * (H - PAD * 2);
  const path = (s) => s.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  const ticks = 4;
  let grid = "";
  for (let g = 0; g <= ticks; g++) {
    const v = min + ((max - min) * g) / ticks;
    grid += `<line x1="${PAD}" y1="${Y(v)}" x2="${W - PAD}" y2="${Y(v)}" stroke="#2a2f3a"/>` +
      `<text x="6" y="${Y(v) + 4}" fill="#6b7280" font-size="11">${v.toFixed(1)}%</text>`;
  }
  const zero = min < 0 ? `<line x1="${PAD}" y1="${Y(0)}" x2="${W - PAD}" y2="${Y(0)}" stroke="#4b5563" stroke-dasharray="4 4"/>` : "";
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">${grid}${zero}
    <path d="${path(seriesC)}" fill="none" stroke="#9ca3af" stroke-width="1.6"/>
    <path d="${path(seriesP)}" fill="none" stroke="#38bdf8" stroke-width="2.4"/>
    <text x="${W - PAD}" y="18" fill="#38bdf8" font-size="12" text-anchor="end">Portefeuille</text>
    <text x="${W - PAD}" y="34" fill="#9ca3af" font-size="12" text-anchor="end">CAC 40</text>
  </svg>`;
}

function trades(p) {
  const tbody = document.querySelector("#trades tbody");
  const t = [...(p.trades || [])].reverse();
  tbody.innerHTML = t.length ? t.map((x) => `<tr>
    <td>${fmtDate(x.date)}</td>
    <td class="${x.action === "ACHAT" ? "pos" : "neg"}">${esc(x.action)}</td>
    <td>${esc(x.nom || x.symbole)}</td><td>${x.shares}</td>
    <td>${fmt2(x.prix)}</td><td>${fmtEur(x.montant)}</td>
    <td class="${x.pnlPct > 0 ? "pos" : x.pnlPct < 0 ? "neg" : ""}">${x.pnlPct != null ? fmtPct(x.pnlPct) : "-"}</td>
    <td class="justif">${esc(x.motif)}</td></tr>`).join("")
    : `<tr><td colspan="8" class="muted">Aucun trade encore.</td></tr>`;
}

const VERDICT = {
  PAS_ENCORE_CONCLUANT: { cls: "warn", titre: "Pas encore concluant" },
  FRAGILE: { cls: "warn", titre: "Fragile — à surveiller" },
  VALIDE: { cls: "ok", titre: "Critères de passage en réel remplis" },
  REJETE: { cls: "danger", titre: "À ne pas passer en réel" },
};

function evaluation(run) {
  const m = run?.meriques;
  const vEl = document.getElementById("verdict");
  if (!m) {
    vEl.innerHTML = `<span class="badge warn">Évaluation indisponible</span> <span class="muted">lance un passage pour alimenter les statistiques.</span>`;
    document.getElementById("meriques").innerHTML = "";
    document.querySelector("#qualite tbody").innerHTML = `<tr><td colspan="6" class="muted">Aucune donnée.</td></tr>`;
    document.querySelector("#calibration tbody").innerHTML = `<tr><td colspan="4" class="muted">Pas assez d'avis jugés.</td></tr>`;
    return;
  }
  const v = VERDICT[m.verdict?.etat] || { cls: "", titre: m.verdict?.etat || "?" };
  vEl.innerHTML = `<span class="badge ${v.cls}">${v.titre}</span>` +
    (m.verdict?.raisons?.length ? ` <span class="muted">${esc(m.verdict.raisons.join(" · "))}</span>` : "");

  const carte = (label, valeur, sous, cls = "") =>
    `<div class="card"><div class="label">${label}</div><div class="value ${cls}">${valeur}</div>${sous ? `<div class="sub">${sous}</div>` : ""}</div>`;

  document.getElementById("meriques").innerHTML =
    carte("Performance", fmtPct(m.perfPct), `${m.ageJours} jours de recul`, m.perfPct > 0 ? "pos" : m.perfPct < 0 ? "neg" : "") +
    carte("CAC 40 même période", fmtPct(m.cacPerfPct), "référence à battre", m.cacPerfPct > 0 ? "pos" : "") +
    carte("Alpha", fmtPct(m.alphaPct), "écart au CAC 40", m.alphaPct > 0 ? "pos" : m.alphaPct < 0 ? "neg" : "") +
    carte("Drawdown max", fmtPct(m.maxDrawdownPct), "pire recul depuis un sommet", m.maxDrawdownPct < -20 ? "neg" : "") +
    carte("Sharpe", m.sharpe == null ? "-" : fmt2(m.sharpe), "rendement par unité de risque") +
    carte("Positions soldées", m.trades.nbSolde, `${m.trades.nbAchats} achats au total`) +
    carte("Taux de réussite", m.trades.tauxReussitePct == null ? "-" : fmtPct(m.trades.tauxReussitePct).replace("+", ""), "sur les ventes") +
    carte("Profit factor", m.trades.profitFactor == null ? "-" : fmt2(m.trades.profitFactor), "gains ÷ pertes", m.trades.profitFactor >= 1.3 ? "pos" : m.trades.profitFactor < 1 ? "neg" : "") +
    carte("Gain moyen", fmtPct(m.trades.gainMoyenPct), "lorsqu'une position rapporte", "pos") +
    carte("Perte moyenne", fmtPct(m.trades.perteMoyennePct), "lorsqu'une position perd", "neg") +
    carte("Coûts cumulés", fmtEur(m.couts.totalEur), `dont TTF ${fmtEur(m.couts.ttfCumule)} · ${fmtPct(m.couts.coutEnPctDuCapital).replace("+", "")} du capital`) +
    carte("Part investie", m.expositionPct == null ? "-" : fmtPct(m.expositionPct).replace("+", ""), "du portefeuille hors espèces");

  const q = (x) => x || { nb: 0, nbEvalues: 0, tauxReussitePct: null, alphaMoyen1sPct: null, alphaMoyen1mPct: null };
  const a = q(m.signaux?.achats), vte = q(m.signaux?.ventes);
  const ligne = (nom, s, sens) => `<tr>
    <td>${nom}</td><td>${s.nb}</td><td>${s.nbEvalues}</td>
    <td>${s.tauxReussitePct == null ? "-" : fmtPct(s.tauxReussitePct).replace("+", "")}</td>
    <td class="${couleurAlpha(s.alphaMoyen1sPct, sens)}">${fmtPct(s.alphaMoyen1sPct)}</td>
    <td class="${couleurAlpha(s.alphaMoyen1mPct, sens)}">${fmtPct(s.alphaMoyen1mPct)}</td></tr>`;
  document.querySelector("#qualite tbody").innerHTML =
    ligne("ACHAT (doit battre le marché)", a, 1) + ligne("VENTE (doit sous-performer)", vte, -1);

  const cal = m.signaux?.calibration;
  const wrap = document.getElementById("calibration-wrap");
  if (wrap) wrap.style.display = cal ? "" : "none";
  if (cal) {
    document.querySelector("#calibration tbody").innerHTML = cal.map((c) => `<tr>
      <td>${c.tranche}</td><td>${c.nb}</td>
      <td>${fmtPct(c.tauxReussitePct).replace("+", "")}</td>
      <td class="${c.alphaMoyenPct > 0 ? "pos" : "neg"}">${fmtPct(c.alphaMoyenPct)}</td></tr>`).join("");
  }
  document.getElementById("note-eval").textContent =
    "Un signal est réputé réussi s'il a fait mieux que le CAC 40 sur la même fenêtre. Les avis non exécutés par les garde-fous sont suivis eux aussi : " +
    "c'est la qualité du modèle seul, indépendamment de la façon dont le portefeuille l'applique.";
}

function couleurAlpha(v, sens) {
  if (v == null) return "";
  return v * sens > 0 ? "pos" : v * sens < 0 ? "neg" : "";
}

async function render() {
  const [p, run, quotes] = await Promise.all(["portfolio.json", "last-run.json", "quotes.json"].map(load));
  document.getElementById("meta").innerHTML = run
    ? `Dernier passage : <strong>${fmtDate(run.date)}</strong>${run.dryRun ? ' — <span class="tag">dry-run</span>' : ""} — maj ${new Date().toLocaleTimeString("fr-FR")}`
    : "Aucun passage effectue pour l'instant. L'IA tourne toutes les 2 heures en semaine (voir Actions).";
  document.getElementById("modele").textContent = run?.modele || "Gemini";
  const regime = run?.regimeApplique || run?.regime;
  badge(run ? `Regime : ${regime}` : "En attente",
    regime === "CATASTROPHIQUE" ? "danger" : regime === "PRUDENT" ? "warn" : regime ? "ok" : "");
  document.getElementById("resume").textContent = run?.resume_marche || "";
  cards(p || { meta: null, cash: null, positions: [], history: [] }, run, quotes?.cac);
  signaux(run, quotes);
  evaluation(run);
  if (p) { positions(p, quotes); courbe(p); trades(p); }
}

render();
setInterval(render, 5 * 60 * 1000);
