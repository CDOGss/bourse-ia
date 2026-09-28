# Déclenchement externe (cron-job.org)

Le cron de GitHub Actions est *best-effort* : en septembre 2026, les créneaux
partaient avec **~5 h de retard** et la plupart étaient sautés (2 passages par
jour au lieu de 5, dont un après la clôture). Le déclencheur principal est donc
**cron-job.org**, qui appelle l'API GitHub (`workflow_dispatch`) à heure fixe.

Le cron GitHub reste en **secours** : il ne lance une analyse que si aucun
passage n'a eu lieu depuis `espacementSecoursMinutes` (150 min, `config.json`),
donc seulement si cron-job.org a manqué un créneau, et jamais hors séance
(09:00-17:35 Paris).

## 1. Jeton GitHub (fine-grained, portée minimale)

GitHub → **Settings** → **Developer settings** → **Personal access tokens** →
**Fine-grained tokens** → **Generate new token**.

- **Name** : `cron-job bourse-ia`
- **Expiration** : 1 an (note la date dans ton agenda)
- **Repository access** : *Only select repositories* → `bourse-ia`
- **Permissions** → *Repository permissions* → **Actions : Read and write**
- **Generate token** → copie-le tout de suite (`github_pat_…`).

Ce jeton ne va QUE dans cron-job.org. Ne le commite jamais.

## 2. Cronjob sur cron-job.org

<https://console.cron-job.org> → **Create cronjob**.

- **Title** : `bourse-ia — analyse`
- **URL** :
  `https://api.github.com/repos/CDOGss/bourse-ia/actions/workflows/analyze.yml/dispatches`
- **Request method** : `POST`
- **Headers** :

  | Clé | Valeur |
  |---|---|
  | `Authorization` | `Bearer <TON_JETON>` |
  | `Accept` | `application/vnd.github+json` |
  | `X-GitHub-Api-Version` | `2022-11-28` |
  | `Content-Type` | `application/json` |

- **Request body** : `{"ref":"main"}`
- **Schedule** (mode personnalisé) :
  - **Timezone : Europe/Paris**
  - Jours de la semaine : **lundi → vendredi**
  - Heures : **9, 11, 13, 15, 17** — Minutes : **20**
    (soit 09h20, 11h20, 13h20, 15h20, 17h20 ; le dernier juste avant la clôture)
- **Notifications** : active « notifier en cas d'échec ».

GitHub répond **`204 No Content`** en cas de succès.

Les jours fériés boursiers, le run démarre mais `src/run.js` s'arrête tout de
suite (« marché fermé ») sans appeler l'IA : rien à configurer.

## 3. Tester

Bouton **Test run** sur cron-job.org → réponse `204`, puis onglet **Actions** :
un run *workflow_dispatch* apparaît dans la minute. Hors séance, son log affiche
« marché fermé (…) - rien à faire » : c'est normal, le déclenchement fonctionne.

## Dépannage

Plus aucun run *workflow_dispatch* depuis plusieurs jours → console
cron-job.org → **History** : `401` = jeton expiré (le régénérer), `404` = dépôt
renommé ou jeton sans accès, `403` = permission Actions manquante, aucune
tentative = job désactivé après trop d'échecs (le réactiver).
