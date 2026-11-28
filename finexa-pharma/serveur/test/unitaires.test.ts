import { test } from "node:test";
import assert from "node:assert/strict";
import { nombreEnLettres, montantEnLettres } from "../src/domaine/documents/lettres.js";
import { lireCsv, versCsv } from "../src/domaine/pharmacie/csv.js";

test("Montants en lettres (orthographe traditionnelle)", () => {
  const cas: [number, string][] = [
    [0, "zéro"], [1, "un"], [16, "seize"], [17, "dix-sept"], [21, "vingt et un"], [22, "vingt-deux"], [71, "soixante et onze"],
    [72, "soixante-douze"], [80, "quatre-vingts"], [81, "quatre-vingt-un"], [91, "quatre-vingt-onze"], [99, "quatre-vingt-dix-neuf"],
    [100, "cent"], [101, "cent un"], [200, "deux cents"], [201, "deux cent un"], [1000, "mille"], [1001, "mille un"],
    [2000, "deux mille"], [80000, "quatre-vingt mille"], [200000, "deux cent mille"], [180500, "cent quatre-vingt mille cinq cents"],
    [1000000, "un million"], [2500000, "deux millions cinq cent mille"], [1000000000, "un milliard"],
    [59625, "cinquante-neuf mille six cent vingt-cinq"], [1250000, "un million deux cent cinquante mille"],
  ];
  for (const [n, t] of cas) assert.equal(nombreEnLettres(n), t, String(n));
  assert.equal(montantEnLettres(596250), "Cinq cent quatre-vingt-seize mille deux cent cinquante francs CFA");
});

test("CSV : écriture lisible par Excel, lecture avec « ; » ou « , » et guillemets", () => {
  const t = versCsv(["Nom", "Prix"], [["Sirop \"enfant\"; 100 ml", 1300]]);
  assert.ok(t.startsWith("\ufeff"));
  assert.deepEqual(lireCsv(t), [["Nom", "Prix"], ['Sirop "enfant"; 100 ml', "1300"]]);
  assert.deepEqual(lireCsv("nom,prix_vente\r\nA,1\r\n\r\nB,2\n"), [["nom", "prix_vente"], ["A", "1"], ["B", "2"]]);
  assert.deepEqual(lireCsv('nom;dci\n"Ligne\nsur deux";X'), [["nom", "dci"], ["Ligne\nsur deux", "X"]]);
});
