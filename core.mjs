export function validateProperty(input) {
  const title = String(input.title ?? "").trim();
  const location = String(input.location ?? "").trim();
  const price = Number(input.price);
  const area = Number(input.area);
  if (!title || title.length > 100 || !location || location.length > 100)
    throw new Error("أدخل عنوانًا وموقعًا من 1 إلى 100 حرف.");
  if (!Number.isSafeInteger(price) || price <= 0 || price > 1e12)
    throw new Error("أدخل سعرًا صحيحًا موجبًا بالجنيه، حتى تريليون.");
  if (!Number.isFinite(area) || area < 0.01 || area > 1e6)
    throw new Error("أدخل مساحة بين 0.01 ومليون متر مربع.");
  if (!["sale", "rent"].includes(input.kind))
    throw new Error("اختر بيعًا أو إيجارًا شهريًا.");
  return { title, location, price, area, kind: input.kind };
}
export function parseProperties(text) {
  const rows = JSON.parse(text);
  if (!Array.isArray(rows) || rows.length > 200)
    throw new Error("ملف البيانات غير صالح أو يزيد عن 200 عقار.");
  const ids = new Set();
  return rows.map((row) => {
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.id !== "string" ||
      !row.id ||
      ids.has(row.id)
    )
      throw new Error("معرّفات العقارات غير صالحة.");
    ids.add(row.id);
    return {
      ...validateProperty(row),
      id: row.id,
      favorite: row.favorite === true,
    };
  });
}
export function filterProperties(
  rows,
  { query = "", kind = "", favorites = false, sort = "newest" } = {},
) {
  const needle = query.trim().toLocaleLowerCase("ar");
  const found = rows.filter(
    (row) =>
      (!needle ||
        `${row.title} ${row.location}`
          .toLocaleLowerCase("ar")
          .includes(needle)) &&
      (!kind || row.kind === kind) &&
      (!favorites || row.favorite),
  );
  return sort === "price"
    ? [...found].sort((a, b) => a.price - b.price)
    : [...found].reverse();
}
