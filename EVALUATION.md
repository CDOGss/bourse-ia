# Protocole d'evaluation — quand passer de la simulation au reel

Ce fichier est le contrat que vous passez avec vous-meme **avant** d'avoir vu les resultats.
Son unique but : repondre a une question, objectivement.

> Le portefeuille pilote par Gemini bat-il le CAC 40 sur 12 mois, **apres frais** ?

Si la reponse est non, le projet n'a pas echoue : il vous a evite de perdre de l'argent reel.
C'est le resultat le plus probable, et l'une des rares choses utiles qu'un tel systeme puisse
produire.

## Ce qui est mesure, et ou

| Indicateur | Definition | Ou le voir |
|---|---|---|
| `perfPct` | variation de la valorisation depuis l'origine | section Evaluation |
| `cacPerfPct` | variation du CAC 40 sur la **meme** periode | idem |
| `alphaPct` | `perfPct - cacPerfPct` : la seule chose qui compte | idem |
| `maxDrawdownPct` | pire recul depuis un sommet | idem |
| `sharpe` | rendement moyen daily rapporte a son ecart-type, annualise | idem |
| `profitFactor` | gains cumules (EUR) divises par les pertes cumulees (EUR) | idem |
| `tauxReussitePct` | part des positions soldees en gain | idem |
| `couts.totalEur` | courtage + TTF payes depuis l'origine | idem |
| `signaux.achats.alphaMoyen1mPct` | alpha moyen, a +1 mois, des avis **ACHAT** | « Qualite brute des avis » |
| `signaux.calibration` | est-ce qu'un 85 annonce reussit mieux qu'un 55 ? | « Calibration » |

Point important : **les avis non executes par les garde-fous sont suivis eux aussi.** On peut
ainsi separer la qualite du jugement du modele de la politique du portefeuille. Si les avis
sont bons et le portefeuille mauvais, le probleme est dans les garde-fous ; si les avis sont
mauvais, aucun reglage ne sauvera la mise.

## Les seuils du verdict

Dans `config.json`, bloc `evaluation` :

| Cle | Defaut | Pourquoi |
|---|---|---|
| `ageMinJours` | 90 | en dessous, un bon resultat releve surtout de la chance |
| `tradesSoldesMin` | 20 | 20 positions soldees : intervalle de confiance encore large, mais deja parlant |
| `alphaMinPct` | 0 | il faut battre l'indice, pas « faire du positif » |
| `profitFactorMin` | 1.3 | en dessous, un mauvais trade efface plusieurs bons |
| `maxDrawdownMinPct` | -20 | au-dela, vous n'auriez pas tenu psychologiquement en reel |

**Ces seuils ne se changent qu'avant, jamais apres.** Les bouger pour obtenir un verdict
favorable est la facon la plus rapide et la plus frequente de se mentir a soi-meme.

## Les quatre verdicts

| Verdict | Signification | Conduite |
|---|---|---|
| `PAS_ENCORE_CONCLUANT` | volume ou recul insuffisant | continuer, ne rien conclure, ne rien changer |
| `REJETE` | ne bat pas le marche, ou pertes > gains, ou les avis achat perdent du terrain | **ne pas passer en reel.** Modifier le prompt ou l'horizon, repartir pour 90 jours |
| `FRAGILE` | positif mais profit factor < 1,3 ou drawdown > 20 % | continuer 90 jours de plus sans engager d'argent |
| `VALIDE` | tous les criteres sont reunis | passage en reel possible, **en commencant a 20 % du capital vise** et en gardant la simulation en parallele |

## Calendrier

- **Jour 0 a 30.** Rien a conclure. A faire : verifier que les 5 passages quotidiens tournent,
  que les cours arrivent, que les flux RSS ne sont pas tous en echec, que le portefeuille
  ressemble a ce que vous vouliez (8 lignes max, stops coherents). Un `dry_run` par semaine
  coute zero et prouve que la chaine est vivante.
- **Jour 30 a 90.** Premier signal utile : la **calibration**. Si les avis a 85 ne reussissent
  pas mieux que ceux a 60, la confiance du modele ne veut rien dire : c'est le moment d'agir sur
  le prompt (exigence de preuves croisees, seuils), pas sur les garde-fous.
- **Jour 90+ et 20 positions soldees.** Le verdict devient licite. Notez-le dans ce fichier, a
  cote de la date. Ne changez plus rien entre deux mesures.

## Ce qu'il ne faut surtout pas faire

1. **Conclure sur 5 trades.** Avec un taux de reussite de 55 %, 5 trades ne disent rien.
2. **Comparer brut contre brut.** La reference est le CAC 40 **tel que vous l'auriez achete**,
   avec ses frais. Le CAC 40 par ETF a 0,2 %/an ne se refuse pas a un modele qui tourne 3 fois
   par semaine.
3. **Oublier la TTF.** 0,3 % a chaque achat francais : cinq allers-retours par mois sur
   portefeuille plein coutent ~3 % par an, a eux seuls, avant toute performance.
4. **Effacer un mauvais run** ou modifier `data/portfolio.json` a la main. L'historique est la
   seule chose qui vaille ; un trou dedans rend toute la suite ininterpretable.
5. **Passer en reel sur un `VALIDE` obtenu en changeant les seuils en route.**

## Journal d'evaluation

A completer a chaque echeance (notez aussi le lien vers l'onglet Actions du run concerne) :

| Date | Jours | Positions soldees | Perf % | CAC 40 % | Alpha % | Drawdown % | Profit factor | Verdict | Decision prise |
|---|---|---|---|---|---|---|---|---|---|
| _2026-09-14 (installation)_ | 0 | 0 | 0 | 0 | 0 | 0 | — | PAS_ENCORE_CONCLUANT | demarrage de la simulation |
| | | | | | | | | | |
| | | | | | | | | | |

## Note legale

Projet personnel d'aide a la decision et d'apprentissage. Ne constitue ni un conseil en
investissement financier (statut CIF reglemente par l'AMF), ni une offre de services. Aucun
ordre reel n'est passe. Les donnees proviennent de sources gratuites pouvant comporter des
delais ou des erreurs. Les performances affichees sont celles d'une simulation : elles ne sont
pas l'engagement d'un resultat futur.
