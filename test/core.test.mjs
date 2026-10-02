import test from "node:test";
import assert from "node:assert/strict";
import {
  validateProperty,
  parseProperties,
  filterProperties,
} from "../core.mjs";
const valid = {
  title: "شقة",
  location: "الجيزة",
  price: "2500000",
  area: "125",
  kind: "sale",
};
test("validate property and preserve positive finite values", () => {
  assert.equal(validateProperty(valid).price, 2500000);
  for (const bad of ["NaN", "Infinity", "0", "-1", "1.5", "1000000000001"])
    assert.throws(() => validateProperty({ ...valid, price: bad }));
  assert.throws(() => validateProperty({ ...valid, area: "Infinity" }));
  assert.throws(() => validateProperty({ ...valid, kind: "loan" }));
});
test("saved records enforce schema and unique ids", () => {
  const row = { ...validateProperty(valid), id: "one", favorite: true };
  assert.equal(parseProperties(JSON.stringify([row]))[0].favorite, true);
  assert.throws(() => parseProperties("{}"));
  assert.throws(() => parseProperties(JSON.stringify([row, row])));
  assert.throws(() => parseProperties(JSON.stringify([{ ...row, area: 0 }])));
});
test("combined filters and price order do not mutate source", () => {
  const rows = [
    { ...valid, id: "one", price: 2, favorite: true },
    { ...valid, id: "two", price: 1, kind: "rent", favorite: false },
  ];
  assert.deepEqual(
    filterProperties(rows, { query: "جيزة", favorites: true }).map((x) => x.id),
    ["one"],
  );
  assert.deepEqual(
    filterProperties(rows, { sort: "price" }).map((x) => x.id),
    ["two", "one"],
  );
  assert.equal(rows[0].id, "one");
  assert.equal(filterProperties(rows, { query: "missing" }).length, 0);
});
