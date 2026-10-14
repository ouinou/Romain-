import { test } from "node:test";
import assert from "node:assert/strict";
import { nombreEnLettres, montantEnLettres } from "../src/domaine/ventes/lettres.js";
import { montantLigne, montantTva, quantiteEnMilliemes } from "../src/domaine/ventes/calculs.js";

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

test("Calculs de facture exacts", () => {
  assert.equal(montantLigne(quantiteEnMilliemes(3), 15000), 45000);
  assert.equal(montantLigne(quantiteEnMilliemes(2.5), 1001), 2503, "2502,5 arrondi à 2503");
  assert.equal(montantLigne(quantiteEnMilliemes(0.333), 1000), 333);
  assert.equal(montantTva(500000, 1925), 96250);
  assert.equal(montantTva(1, 1925), 0);
  assert.equal(montantTva(26, 1925), 5, "5,005 arrondi à 5");
  assert.throws(() => quantiteEnMilliemes(1.2345));
  assert.throws(() => quantiteEnMilliemes(0));
});
