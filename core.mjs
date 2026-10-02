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

export const MAX_TRANSFER_BYTES = 512 * 1024;

function transferRows(rows) {
  if (!Array.isArray(rows) || rows.length > 200)
    throw new Error("الملف يجب أن يحتوي على 200 عقار أو أقل.");
  const ids = new Set();
  const keys = ["title", "location", "price", "area", "kind", "id", "favorite"];
  return rows.map((row, index) => {
    if (
      !row ||
      Array.isArray(row) ||
      typeof row !== "object" ||
      Object.keys(row).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(row, key)) ||
      typeof row.title !== "string" ||
      typeof row.location !== "string" ||
      typeof row.price !== "number" ||
      typeof row.area !== "number" ||
      typeof row.favorite !== "boolean" ||
      typeof row.id !== "string" ||
      !row.id.trim() ||
      row.id.length > 128 ||
      ids.has(row.id)
    )
      throw new Error(
        `حقول أو معرّف العقار رقم ${index + 1} غير صالحة أو مكررة.`,
      );
    ids.add(row.id);
    try {
      return { ...validateProperty(row), id: row.id, favorite: row.favorite };
    } catch (error) {
      throw new Error(`العقار رقم ${index + 1}: ${error.message}`);
    }
  });
}

export function importProperties(text) {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > MAX_TRANSFER_BYTES
  )
    throw new Error("الحد الأقصى للملف 512 كيلوبايت.");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("تعذر قراءة JSON. لم يتغير الدفتر.");
  }
  if (
    !data ||
    Array.isArray(data) ||
    typeof data !== "object" ||
    data.schema_version !== 1 ||
    Object.keys(data).length !== 2 ||
    !Object.hasOwn(data, "properties")
  )
    throw new Error(
      "صيغة الملف غير مدعومة. يلزم schema_version: 1 وقائمة properties.",
    );
  return transferRows(data.properties);
}

export function exportProperties(rows) {
  const text = JSON.stringify(
    { schema_version: 1, properties: transferRows(rows) },
    null,
    2,
  );
  if (new TextEncoder().encode(text).length > MAX_TRANSFER_BYTES)
    throw new Error("الدفتر أكبر من حد ملف النقل 512 كيلوبايت.");
  return text;
}

export function compareProperties(rows, ids) {
  if (!Array.isArray(ids) || ids.length > 3 || new Set(ids).size !== ids.length)
    throw new Error("اختر حتى ثلاثة عروض مختلفة للمقارنة.");
  const selected = ids.map((id) => rows.find((row) => row.id === id));
  if (selected.some((row) => !row))
    throw new Error("أحد العروض المختارة لم يعد موجودًا.");
  if (new Set(selected.map((row) => row.kind)).size > 1)
    throw new Error(
      "قارن عروض البيع مع البيع، أو الإيجار الشهري مع الإيجار الشهري.",
    );
  return selected.map((row) => ({
    ...row,
    pricePerArea: row.price / row.area,
  }));
}
