import { readFileSync } from "node:fs";
const s = readFileSync("app.js", "utf8");
const bad = s.match(/class="[^"]*"\s+class=/g) || [];
console.log("doublons class=", bad.length);
const ids = [...s.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);
const html = readFileSync("index.html", "utf8");
let missing = 0;
for (const id of ids) {
  if (!html.includes(`id="${id}"`)) { console.log("ID MANQUANT:", id); missing++; }
}
console.log("ids verifies:", ids.length, "manquants:", missing);
