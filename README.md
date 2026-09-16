# IA Bourse France — papier trading CAC 40 / SBF 120

Une IA (Gemini 3.8 Flash) analyse cinq fois par jour de bourse les valeurs francaises du CAC 40
et du SBF 120 : cours et indicateurs techniques (Yahoo Finance) + actualite RSS de moins de 24 h.
Elle rend un regime de seance, un resume de marche et des signaux ACHAT / VENTE / CONSERVER. Un
moteur de garde-fous ecrit **en dur dans le code** applique ensuite ces signaux a un portefeuille
**virtuel** de 10 000 EUR. Le tout tourne sur GitHub Actions, meme PC eteint ; le dashboard est
servi par GitHub Pages.

**Objectif assume : maximiser la valeur du portefeuille a 12 mois.**

## Ce qui tourne

- **Cron GitHub Actions** : lundi a vendredi, 5 creneaux a 9 h, 11 h, 13 h, 15 h et 17 h UTC
  (soit ~11 h a ~19 h a Paris l'ete, ~10 h a ~18 h l'hiver ; le dernier passage fait le point
  de fin de seance). Chaque creneau est tente 3 fois (:07, :27, :47) car GitHub saute ou retarde
  souvent les schedules ; `run.js` refuse de tourner deux fois en moins de
  `espacementMinMinutes` (75 min, `config.json`), donc une seule tentative appelle l'IA.
  Week-ends et jours feries boursiers d'Euronext : skip.
- **Pipeline `src/run.js`** : cours + indicateurs → actualites → memoire des decisions
  precedentes → appel Gemini → validation stricte du JSON → garde-fous → portefeuille virtuel →
  journal des signaux → meriques → commit de l'etat dans `data/` → dashboard.

## Installation (10 minutes)

1. **Depot GitHub public** (Pages gratuit seulement en public) : poussez ce projet sur `main`.
2. **Secret** `GEMINI_API_KEY` : Settings → Secrets and variables → Actions → New repository
   secret. Cle gratuite sur <https://aistudio.google.com/apikey>.
   Variable optionnelle `GEMINI_MODEL` pour changer de modele sans toucher au code.
3. **Permissions d'ecriture** : Settings → Actions → General → Workflow permissions →
   *Read and write permissions* (sinon le bot ne peut pas committer son etat).
4. **Pages** : Settings → Pages → Source *Deploy from a branch* → `main` / `/ (root)`.
   Dashboard visible a `https://<ton-user>.github.io/<depot>/`.
5. **Premier run** : onglet Actions → *Analyse IA (2h)* → *Run workflow* → coche `dry_run` →
   verifie que la chaine fonctionne (aucun appel a l'IA). Puis relance sans `dry_run` une fois
   la cle en place. Ne pas oublier de committer l'etat produit par le premier run.

> L'etat du portefeuille est cree automatiquement des le premier passage en semaine
> (10 000 EUR d'especes). Avant cela, le dashboard affiche « aucun passage ».

## Ce que voit le modele

Chaque valeur de l'univers lui parvient avec des chiffres **calculs a partir de l'historique
reel des clotures** (`src/indicators.js`), pas avec des impressions :

| Champ | Sens |
|---|---|
| `chg1d` … `chg126d` | variation sur 1, 5, 20, 63 et 126 seances |
| `sma20` / `sma50` / `sma200` + `ecart_sma*_pct` | moyennes mobiles et ecart du cours |
| `rsi14` | RSI de Wilder (survente < 30, surachat > 70) |
| `volatilita_ann_pct` | volatilise realized annualisee sur 20 jours |
| `plus_haut_52s` / `dist_plus_haut_52s_pct` | distance aux extremes de l'annee |
| `tendance` | `HAUSSE_CONFIRMEE` … `BAISSE_CONFIRMEE` (50 vs 200 et pente) |
| `signal_technique` | `SURVENTE` / `NEUTRE` / `SURACHAT` |

Il recoit aussi la **largeur de marche** (part des valeurs au-dessus de leur SMA200), les
**couts reels** (courtage + taxe francaise), son **propre bilan** (`memoire`) : ses derniers
avis et ce qu'ils sont devenus a +1 semaine et +1 mois, ainsi que les ordres rejetes au passage
precedent. C'est la seule facon pour lui de s'ameender.

## Cout reel d'un ordre francais

`config.json` applique aux achats un courtage (`fraisPct`, 0,1 % par defaut) **et la TTF**
(`taxeTransactionPct`, 0,3 % : taxe francaise sur les transactions financieres, qui ne frappe
que les achats, jamais les ventes). Un aller-retour coute donc ~0,5 % du montant : **une
position doit gagner plus de 0,5 % juste pour revenir a zero.** C'est ce qui rend le
sur-trading perdant, et le modele a cette consigne noir sur blanc.

## Reglages

Tout est dans `config.json` :

| Cle | Defaut | Role |
|---|---|---|
| `modele` | `gemini-3.8-flash` | modele Gemini (`GEMINI_MODEL` l'ecrase) |
| `reflexion` | `high` | niveau de reflexion : `low`, `medium`, `high` (repli automatique si l'API refuse) |
| `miseDepart` | 10000 | capital virtuel initial (EUR) |
| `fraisPct` | 0.1 | courtage par ordre |
| `taxeTransactionPct` | 0.3 | TTF francaise, a l'achat uniquement |
| `gardeFous.confianceMinimale` | 70 | sous ce seuil, un ACHAT est rejete |
| `gardeFous.maxAchatsParPassage` | 3 | achats max par passage |
| `gardeFous.maxPositions` | 8 | lignes max en portefeuille |
| `gardeFous.maxPoidsLignePct` | 25 | poids max d'une ligne |
| `gardeFous.seuilKrachPct` | -3 | variation CAC 40 forcant le regime CATASTROPHIQUE |
| `evaluation.*` | voir [EVALUATION.md](EVALUATION.md) | seuils du verdict go/no-go |
| `grounding` | false | recherche Google native Gemini en plus des RSS |
| `news.*` | — | age max des actus, nombre de titres, flux sites |

Les garde-fous sont appliques **par le code** : le modele ne peut pas les contourner, meme en
revant. Le **prompt** est le bloc `<!-- PROMPT:BEGIN -->…<!-- PROMPT:END -->` de `PROMPT.md` :
c'est le levier de qualite principale, chaque run le relit.

## Univers

`src/universe.json` : **123 valeurs** resolues (44 etiquetees CAC 40, 79 SBF 120), symboles
Yahoo Finance `.PA`. Principales absences, assumees : **ArcelorMittal** (cote a Amsterdam,
`MT.PA` renvoie un fonds cote Yahoo), **Iliad** et quelques radies (LDC, Vilmorin, Solvay,
Esso, M6, Coca-Cola EP) qui n'ont pas de ligne Paris exploitable.

Entretien trimestriel (les indices sont revus par Euronext fin juin, application au 1er
septembre, et entre-temps sur operation sur capital) :

```bash
# 1. mettre a jour src/indices.json (liste des valeurs, cf. Wikipedia ou boursier.com)
npm run build:candidats     # regenere src/universe.candidates.json
npm run validate:universe   # resout les tickers Yahoo, complete src/universe.json
```

`validate:universe` ne fait jamais confiance aveuglement : il sonde Yahoo, verifie que le nom
repondu correspond bien a la valeur demandee, refuse obligations, ADR et doublons de symbole.

## Evaluation : quand passer en reel ?

Le dashboard a une section **Evaluation du systeme** (verdict, alpha vs CAC 40, drawdown,
Sharpe, profit factor, couts cumules, qualite brute des avis, calibration de la confiance).
Les criteres et la procedure sont ecrits dans **[EVALUATION.md](EVALUATION.md)**.

Regles de l'esprit : **jamais de passage en reel avant 90 jours de recul et 20 positions
soldees**, et seulement si le portefeuille bat le CAC 40 apres frais. Un verdict
`PAS_ENCORE_CONCLUANT` n'est pas un echec, c'est ce qu'il y a de plus probable au debut.

## Developpement

```bash
npm test                 # suite complete (necessite de pouvoir creer des processus fils)
npm run test:each        # meme suite, un fichier par processus (environnements confines)
npm run run:dry          # pipeline complet sans cle API (stub IA)
npm run run:analyze      # pipeline reel (GEMINI_API_KEY dans l'environnement)
npm run simulation       # rejeu du moteur sur cours synthetiques (valide arret/stop/TTF/meriques)
npm run preview          # dashboard local sur http://localhost:8080
npm run smoke:dashboard  # rendu du dashboard avec l'etat courant de data/
npm run check:static     # ids et classes references par le HTML
```

Fichiers d'etat (commits automatises du bot) : `data/portfolio.json` (vie du portefeuille,
trades, journal des signaux), `data/last-run.json` (derniere analyse et meriques),
`data/quotes.json` (derniers cours et indicateurs).

## Limites connues (a lire avant d'y croire)

- **Un modele flash sur donnees techniques + actualites a de bonnes chances d'etre deficitaire
  apres frais.** Le harnais `npm run simulation` le montre tres bien : une regle
  d'achat-en-survente bete perd face au CAC 40, et la seule TTF mange ~1,75 % du capital sur
  400 seances. L'interet de ce projet est de **mesurer** cela, pas de le supposer.
- **Yahoo Finance est une API non officielle** : gratuite, sans garantie, susceptible de
  changer ou de bloquer les adresses des runners GitHub. Le run echoue alors proprement (etat
  preserve) et se reprend au passage suivant.
- **Les schedules GitHub Actions ne sont pas fiables** : sur un depot gratuit, observe en
  septembre 2026, ~30 % des creneaux tournent, avec 1 a 3 h de retard. Les 3 tentatives par
  creneau ameliorent le taux sans le garantir ; pour une execution a l'heure, il faut un
  declencheur externe (`workflow_dispatch` via l'API GitHub depuis un cron tiers).
- **Un stop n'est verifie que 5 fois par jour.** Une ouverture en fort gap se solde au prix du
  marche, plus bas que le stop. C'est ce qui se passerait en reel avec des ordres au marche.
- **La vente a decouvert est volontairement desactivee** (le compte-titres le permettrait) :
  sur un horizon de 12 mois et avec ces donnees, elle ajoute du risque sans avantage demontre.
- Depot **prive** : Pages est payant et les schedules se **desactivent apres 60 jours
  d'inactivite**. Depot public recommande.
- Ceci n'est **pas un conseil en investissement** (voir la note legale dans le dashboard).
  Performance passee, surtout simulee, ne vaut pas performance future.
