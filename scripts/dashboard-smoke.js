import { readFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";

const els = {};
const mk = (id) => (els[id] ??= { innerHTML: "", textContent: "", className: "", style: {} });

global.document = {
  getElementById: (id) => mk(id),
  querySelector: (sel) => mk(sel),
};
global.fetch = async (url) => {
  const path = url.replace(/^\//, "").split("?")[0];
  try {
    const body = await readFile(join(process.cwd(), path), "utf8");
    return { ok: true, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false };
  }
};
global.setInterval = () => {};

await import("../app.js");
await new Promise((r) => setTimeout(r, 300));

assert.ok(/€/.test(els["compte"].innerHTML), "cartes compte avec euros");
const meta = els["meta"].innerHTML;
assert.ok(/Dernier passage|aucun passage/i.test(meta), "meta remplie: " + meta.slice(0, 80));
assert.ok(els["regime-badge"].textContent.length > 0, "badge regime");
assert.ok(/svg/.test(els["courbe"].innerHTML) || /disponible/.test(els["courbe"].innerHTML), "courbe");
assert.ok(els["#positions tbody"].innerHTML.length > 0, "positions rendues");
assert.ok(els["#trades tbody"].innerHTML.length > 0, "trades rendus");
assert.ok(els["#signaux tbody"].innerHTML.length > 0, "signaux rendus");
assert.ok(els["verdict"].innerHTML.length > 0, "verdict d'evaluation rendu");
assert.ok(/PAS_ENCORE|VALIDE|REJETE|FRAGILE|concluants?/i.test(els["verdict"].innerHTML), "verdict explicite: " + els["verdict"].innerHTML.slice(0, 120));
assert.ok(els["#qualite tbody"].innerHTML.includes("ACHAT"), "tableau de qualite des avis");
assert.ok(els["meriques"].innerHTML.includes("Drawdown"), "cartes d'evaluation");
console.log("SMOKE DASHBOARD OK");
