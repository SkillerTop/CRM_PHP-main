import { test } from "node:test";
import { strict as assert } from "node:assert";
import { identicalName, sameName } from "../src/name-match.ts";

test("name comparison retains PHP duplicate warnings across scripts and spelling variants", () => {
  for (const [left, right] of [
    ["Acme", "Аcme"],
    ["ACME", "АСМЕ"],
    ["Anna Smith", "Smith, Anna"],
    ["Иван Петров", "Ivan Petrov"],
    ["Юрій Ковальчук", "Iurii Kovalchuk"],
    ["Ольга", "Olha"],
    ["Александр", "Aleksandr"],
    ["Müller GmbH", "Mueller GmbH"],
    ["Côte Bleue", "Cote Bleue"],
    ["Müller", "Muller"],
    ["Ａｃｍｅ", "Acme"],
    ["𝐀𝐜𝐦𝐞", "Acme"],
    ["Coca-Cola", "CocaCola"],
    ["PayPal", "Раураl"],
    ["Ђорђе Петровић", "Djordje Petrovic"],
    ["Цветков", "Tsvetkov"],
    ["محمد علي", "Mohammed Ali"],
    ["דוד כהן", "David Cohen"],
    ["Արամ", "Aram"],
    ["გიორგი", "Giorgi"],
    ["王伟", "Wang Wei"],
    ["Юрий Ковальчук", "Yuriy Kovalchuk"],
    ["Ольга", "Olga"],
    ["Мария", "Mariya"],
    ["Евгений", "Yevgeniy"],
    ["Харків", "Kharkiv"],
    ["Щербаков", "Shcherbakov"],
    ["Фёдор", "Fedor"],
    ["Pâte Fête Île Hôtel Sûr", "pate fete ile hotel sur"],
    ["Jean-René Lefèvre", "Jean Rene Lefevre"],
    ["François", "Francois"],
    ["Ştefan Țară", "Stefan Tara"],
    ["Åsa", "Aasa"],
    ["Þór", "Thor"],
    ["Łukasz", "Lukasz"],
    ["Şükrü", "Sukru"],
    ["İstanbul Ltd", "Istanbul Ltd"],
    ["ﬁrma", "Firma"],
    ["Љубица", "Ljubica"],
    ["Нұрлан", "Nurlan"],
    ["Moritz", "Мориц"],
    ["Χρήστος Παπαδόπουλος", "Christos Papadopoulos"],
    ["محمد علي", "Muhammad Ali"],
    ["محمود", "Mahmoud"],
    ["يوسف", "Yousef"],
    ["أحمد", "Ahmed"],
    ["فاطمة", "Fatima"],
    ["राम शर्मा", "Ram Sharma"],
    ["สมชาย", "Somchai"],
    ["たなか", "Tanaka"],
    ["タナカ", "Tanaka"],
  ])
    assert.equal(sameName(left, right), true, `${left} / ${right}`);
  for (const [left, right] of [
    ["Anna Smith", "Anna Smyth Jones"],
    ["Иван Петров", "Иван Сидоров"],
    ["Ivan Petrov", "Ivan Petrova Ltd"],
    ["Company 1", "Company 2"],
    ["Acme", "Acne"],
    ["Олег", "Ольга"],
    ["محمد", "Mahmoud"],
    ["Ali", "Lee"],
    ["", ""],
  ])
    assert.equal(sameName(left, right), false, `${left} / ${right}`);
});

test("only case and spacing differences are identical", () => {
  assert.equal(identicalName("Acme Ltd", "ACME  ltd "), true);
  assert.equal(identicalName("Co\u0302te", "Côte"), true);
  assert.equal(identicalName("Müller", "Mueller"), false);
});
