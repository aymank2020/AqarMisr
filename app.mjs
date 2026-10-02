import {
  validateProperty,
  parseProperties,
  filterProperties,
  importProperties,
  exportProperties,
  compareProperties,
  MAX_TRANSFER_BYTES,
} from "./core.mjs";
const key = "aqar-misr-properties-v1";
const status = document.querySelector("#status");
const results = document.querySelector("#results");
let rows = [];
let storageReadFailed = false;
let savedRaw = null;
let pendingImport = null;
let previousBackup = null;
let importRevision = 0;
let selectedIds = [];
try {
  savedRaw = localStorage.getItem(key);
  if (savedRaw) rows = parseProperties(savedRaw);
} catch {
  storageReadFailed = true;
  status.textContent =
    "تعذر قراءة البيانات المحفوظة. لم تُحذف؛ يبدأ دفتر مؤقت فارغ.";
}
function persist() {
  invalidatePreview();
  if (storageReadFailed) {
    status.textContent =
      "بيانات سابقة غير مقروءة. التغييرات لهذه الجلسة فقط؛ النسخة المحفوظة لم تتغير.";
    return;
  }
  try {
    const text = JSON.stringify(rows);
    localStorage.setItem(key, text);
    savedRaw = text;
    status.textContent = "حُفظ الدفتر على هذا المتصفح.";
  } catch {
    status.textContent = "تعذر الحفظ. التغييرات متاحة لهذه الجلسة فقط.";
  }
}
function element(tag, text, cls) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function render() {
  const visible = filterProperties(rows, {
    query: document.querySelector("#query").value,
    kind: document.querySelector("#kind").value,
    sort: document.querySelector("#sort").value,
    favorites: document.querySelector("#favorites").checked,
  });
  results.replaceChildren();
  document.querySelector("#count").textContent =
    `${visible.length} من ${rows.length} عقار`;
  if (!visible.length)
    results.append(
      element(
        "p",
        rows.length
          ? "لا توجد نتائج لهذه الفلاتر."
          : "لا توجد عقارات بعد. أضف أول عرض أعلاه.",
        "empty",
      ),
    );
  for (const row of visible) {
    const card = element("article", "");
    card.append(
      element("h3", row.title),
      element("p", row.location),
      element(
        "p",
        `${row.price.toLocaleString("ar-EG")} ج.م${row.kind === "rent" ? " / شهر" : ""}`,
        "price",
      ),
      element(
        "p",
        `${row.area.toLocaleString("ar-EG")} م² · ${(row.price / row.area).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م لكل م²${row.kind === "rent" ? " / شهر" : ""}`,
      ),
    );
    const favorite = element(
      "button",
      row.favorite ? "إزالة من المفضلة" : "إضافة للمفضلة",
    );
    favorite.type = "button";
    favorite.setAttribute(
      "aria-label",
      `${favorite.textContent}: ${row.title}`,
    );
    favorite.setAttribute("aria-pressed", String(row.favorite));
    favorite.addEventListener("click", () => {
      row.favorite = !row.favorite;
      persist();
      render();
    });
    const remove = element("button", "حذف");
    remove.type = "button";
    remove.className = "secondary";
    remove.setAttribute("aria-label", `حذف: ${row.title}`);
    remove.addEventListener("click", () => {
      rows = rows.filter((item) => item.id !== row.id);
      selectedIds = selectedIds.filter((id) => id !== row.id);
      persist();
      render();
    });
    const compare = element(
      "button",
      selectedIds.includes(row.id) ? "إزالة من المقارنة" : "قارن هذا العرض",
    );
    compare.type = "button";
    compare.setAttribute("aria-label", `${compare.textContent}: ${row.title}`);
    compare.setAttribute("aria-pressed", String(selectedIds.includes(row.id)));
    compare.addEventListener("click", () => {
      try {
        const ids = selectedIds.includes(row.id)
          ? selectedIds.filter((id) => id !== row.id)
          : [...selectedIds, row.id];
        compareProperties(rows, ids);
        selectedIds = ids;
        render();
      } catch (error) {
        status.textContent = error.message;
      }
    });
    card.append(favorite, remove, compare);
    results.append(card);
  }
  renderComparison();
}

function renderComparison() {
  const panel = document.querySelector("#comparison");
  panel.replaceChildren();
  const selected = compareProperties(rows, selectedIds);
  if (!selected.length) {
    panel.append(
      element("p", "اختر «قارن هذا العرض» في حتى ثلاث بطاقات من النوع نفسه."),
    );
    return;
  }
  const rent = selected[0].kind === "rent";
  const table = element("table", "");
  const caption = element(
    "caption",
    `مقارنة ${selected.length} من عروض ${rent ? "الإيجار الشهري" : "البيع"}`,
  );
  const head = element("thead", "");
  const titles = element("tr", "");
  titles.append(element("th", "العرض"));
  for (const row of selected) {
    const th = element("th", row.title);
    th.setAttribute("scope", "col");
    titles.append(th);
  }
  head.append(titles);
  const body = element("tbody", "");
  const format = (value) =>
    value.toLocaleString("ar-EG", { maximumFractionDigits: 2 });
  for (const [label, value] of [
    ["الموقع", (row) => row.location],
    [
      rent ? "الإيجار الشهري (ج.م / شهر)" : "سعر البيع (ج.م)",
      (row) => format(row.price),
    ],
    ["المساحة (م²)", (row) => format(row.area)],
    [
      rent ? "ج.م لكل م² / شهر" : "ج.م لكل م²",
      (row) => format(row.pricePerArea),
    ],
  ]) {
    const tr = element("tr", "");
    const heading = element("th", label);
    heading.setAttribute("scope", "row");
    tr.append(heading);
    for (const row of selected) tr.append(element("td", value(row)));
    body.append(tr);
  }
  table.append(caption, head, body);
  panel.append(table);
}

function invalidatePreview() {
  importRevision++;
  pendingImport = null;
  document.querySelector("#confirm-replace").checked = false;
  document.querySelector("#apply-import").disabled = true;
  document.querySelector("#import-preview").replaceChildren();
}

function download(text, filename) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json;charset=utf-8" }),
  );
  const anchor = element("a", "");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.querySelector("#export-properties").addEventListener("click", () => {
  try {
    download(exportProperties(rows), "aqar-misr-v1.json");
  } catch (error) {
    status.textContent = error.message;
  }
});
document.querySelector("#download-backup").addEventListener("click", () => {
  if (previousBackup)
    download(previousBackup.text, "aqar-misr-before-import-v1.json");
});
document.querySelector("#download-saved").addEventListener("click", () => {
  if (previousBackup?.raw !== null && previousBackup?.raw !== undefined)
    download(previousBackup.raw, "aqar-misr-previous-storage-raw.json");
});
document
  .querySelector("#import-file")
  .addEventListener("change", async (event) => {
    invalidatePreview();
    const revision = importRevision;
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_TRANSFER_BYTES)
        throw new Error("الحد الأقصى للملف 512 كيلوبايت.");
      const text = await file.text();
      if (revision !== importRevision) return;
      const incoming = importProperties(text);
      if (!storageReadFailed && localStorage.getItem(key) !== savedRaw)
        throw new Error(
          "تغير الدفتر المحفوظ في نافذة أخرى. أعد تحميل الصفحة قبل الاستيراد.",
        );
      previousBackup = { text: exportProperties(rows), raw: savedRaw };
      pendingImport = { rows: incoming, raw: savedRaw };
      const preview = document.querySelector("#import-preview");
      preview.append(
        element(
          "p",
          `${incoming.length} عقار صالح سيستبدل ${rows.length} عقارًا. بيع: ${incoming.filter((row) => row.kind === "sale").length}؛ إيجار شهري: ${incoming.filter((row) => row.kind === "rent").length}.`,
        ),
      );
      const list = element("ul", "");
      for (const row of incoming.slice(0, 5))
        list.append(element("li", `${row.title} · ${row.location}`));
      preview.append(list);
      if (incoming.length > 5)
        preview.append(
          element("p", "تُعرض أول خمسة عروض؛ فُحصت حقول جميع العروض."),
        );
      if (storageReadFailed)
        preview.append(
          element(
            "p",
            "بيانات محفوظة غير مقروءة: الاستبدال لهذه الجلسة فقط. لن تتغير النسخة المحفوظة.",
          ),
        );
      document.querySelector("#download-backup").disabled = false;
      document.querySelector("#download-saved").disabled = savedRaw === null;
      document.querySelector("#backup-note").textContent =
        "نسخة الدفتر قبل الاستيراد محفوظة في ذاكرة هذه الصفحة. نزّلها الآن قبل الاعتماد؛ إغلاق الصفحة يفقد نسخة الذاكرة.";
      status.textContent =
        "المعاينة جاهزة. لم يتغير الدفتر؛ يلزم تأكيد الاستبدال أدناه.";
    } catch (error) {
      if (revision === importRevision) status.textContent = error.message;
    }
  });
document
  .querySelector("#confirm-replace")
  .addEventListener("change", (event) => {
    document.querySelector("#apply-import").disabled =
      !pendingImport || !event.currentTarget.checked;
  });
document.querySelector("#cancel-import").addEventListener("click", () => {
  invalidatePreview();
  document.querySelector("#import-file").value = "";
  status.textContent = "أُلغيت المعاينة. لم يتغير الدفتر.";
});
document.querySelector("#apply-import").addEventListener("click", () => {
  if (!pendingImport || !document.querySelector("#confirm-replace").checked)
    return;
  const incoming = pendingImport.rows;
  try {
    if (!storageReadFailed) {
      if (localStorage.getItem(key) !== pendingImport.raw)
        throw new Error(
          "تغير الدفتر المحفوظ في نافذة أخرى. أعد تحميل الصفحة؛ لم يُستبدل.",
        );
      const text = JSON.stringify(incoming);
      localStorage.setItem(key, text);
      savedRaw = text;
    }
    rows = incoming;
    selectedIds = [];
    invalidatePreview();
    document.querySelector("#import-file").value = "";
    status.textContent = storageReadFailed
      ? "استُبدل دفتر هذه الجلسة فقط. البيانات المحفوظة غير المقروءة لم تتغير؛ نزّل الدفتر الجديد للاحتفاظ به."
      : "استُبدل الدفتر بعد تأكيدك. نسخة ما قبل الاستيراد ما زالت متاحة للتنزيل.";
    render();
  } catch (error) {
    status.textContent = `تعذر الاستبدال؛ الدفتر السابق لم يتغير. ${error.message}`;
  }
});
document.querySelector("#property-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    if (rows.length >= 200)
      throw new Error("وصلت إلى حد 200 عقار. احذف عرضًا قبل الإضافة.");
    const property = validateProperty(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    rows.push({ ...property, id: crypto.randomUUID(), favorite: false });
    persist();
    event.currentTarget.reset();
    render();
  } catch (error) {
    status.textContent = error.message;
  }
});
for (const id of ["query", "kind", "sort", "favorites"])
  document.querySelector(`#${id}`).addEventListener("input", render);
render();
