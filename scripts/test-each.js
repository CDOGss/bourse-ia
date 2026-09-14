// Execute chaque fichier de test dans son propre processus, sans decouvrir le runner
// `node --test` (certains environnements bloquent la creation de processus fils).
//
//   npm run test:each

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const fichiers = readdirSync(join(RACINE, "tests")).filter((f) => f.endsWith(".test.js")).sort();

let echecs = 0;
let total = 0;
const sansAnsi = (s) => String(s || "").replace(/\x1b\[[0-9;]*m/g, "");
for (const f of fichiers) {
  const r = spawnSync(process.execPath, [join(RACINE, "tests", f)], {
    encoding: "utf8",
    env: { ...process.env, NODE_DISABLE_COLORS: "1", NO_COLOR: "1" },
  });
  const sortie = sansAnsi(`${r.stdout || ""}${r.stderr || ""}`);
  const resume = sortie.match(/tests\s+(\d+)/);
  const n = Number(resume ? resume[1] : 0);
  const ko = Number((sortie.match(/fail\s+(\d+)/) || [])[1] || 0);
  // Un fichier qui ne rend pas de resume (processus fils tue, erreur de syntaxe, test
  // non lance) doit etre compte comme un echec : jamais afficher « ok » sur du vide.
  const hs = !resume || r.status !== 0;

  total += n;
  echecs += ko + (hs ? 1 : 0);
  console.log(`${ko || hs ? "ECHEC" : "ok   "}  ${f.padEnd(26)} ${n} tests, ${ko} echec(s)${hs ? " - resume absent (sortie : " + (sortie.slice(0, 90).replace(/\s+/g, " ") || "vide") + ")" : ""}`);
  if (ko) console.log(sortie.split("\n").filter((l) => /not ok|✖|Error|expected|actual/.test(l)).slice(0, 14).join("\n"));
}
console.log(`\n${total} tests, ${echecs} echec(s) sur ${fichiers.length} fichiers`);
process.exitCode = echecs ? 1 : 0;
