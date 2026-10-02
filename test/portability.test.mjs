import test from "node:test";
import assert from "node:assert/strict";
import {
  importProperties,
  exportProperties,
  compareProperties,
  MAX_TRANSFER_BYTES,
} from "../core.mjs";

const row = {
  id: "one",
  title: "شقة",
  location: "الجيزة",
  kind: "rent",
  price: 6000,
  area: 120,
  favorite: true,
};
const file = (properties) => JSON.stringify({ schema_version: 1, properties });

test("versioned export/import preserves every property and favorite", () => {
  assert.deepEqual(importProperties(exportProperties([row])), [row]);
  assert.deepEqual(importProperties(exportProperties([])), []);
  assert.equal(JSON.parse(exportProperties([row])).schema_version, 1);
});

test("import rejects invalid schemas, duplicate IDs, coercion, and excessive input", () => {
  for (const text of [
    "{",
    "[]",
    "null",
    file([row, row]),
    JSON.stringify({ schema_version: 2, properties: [row] }),
    JSON.stringify({ schema_version: 1, properties: [], extra: true }),
    file([{ ...row, favorite: "false" }]),
    file([{ ...row, price: "6000" }]),
    file([{ ...row, area: null }]),
    file([{ ...row, kind: "yearly-rent" }]),
    file([{ ...row, id: " " }]),
    file([{ ...row, id: "x".repeat(129) }]),
    file([{ ...row, title: [] }]),
    file([{ ...row, extra: 1 }]),
    " ".repeat(MAX_TRANSFER_BYTES + 1),
  ])
    assert.throws(() => importProperties(text));
  assert.throws(() =>
    importProperties(
      file(Array.from({ length: 201 }, (_, i) => ({ ...row, id: String(i) }))),
    ),
  );
  assert.equal(
    importProperties(
      file(Array.from({ length: 200 }, (_, i) => ({ ...row, id: String(i) }))),
    ).length,
    200,
  );
  // Byte size, rather than JS character count, protects Arabic UTF-8 input too.
  assert.throws(() => importProperties("ش".repeat(MAX_TRANSFER_BYTES / 2 + 1)));
});

test("comparison uses up to three unique offers with the same price period", () => {
  const rows = [
    row,
    { ...row, id: "two", price: 9000, area: 150 },
    { ...row, id: "three" },
    { ...row, id: "four" },
    { ...row, id: "sale", kind: "sale" },
  ];
  assert.deepEqual(
    compareProperties(rows, ["one", "two"]).map((x) => x.pricePerArea),
    [50, 60],
  );
  assert.equal(compareProperties(rows, ["one", "two", "three"]).length, 3);
  for (const ids of [
    ["one", "sale"],
    ["one", "two", "three", "four"],
    ["one", "one"],
    ["missing"],
  ])
    assert.throws(() => compareProperties(rows, ids));
  assert.equal(rows[0].favorite, true);
});
