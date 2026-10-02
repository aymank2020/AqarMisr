import {
  validateProperty,
  parseProperties,
  filterProperties,
} from "./core.mjs";
const key = "aqar-misr-properties-v1";
const status = document.querySelector("#status");
const results = document.querySelector("#results");
let rows = [];
let storageReadFailed = false;
try {
  const saved = localStorage.getItem(key);
  if (saved) rows = parseProperties(saved);
} catch {
  storageReadFailed = true;
  status.textContent =
    "تعذر قراءة البيانات المحفوظة. لم تُحذف؛ يبدأ دفتر مؤقت فارغ.";
}
function persist() {
  if (storageReadFailed) {
    status.textContent =
      "بيانات سابقة غير مقروءة. التغييرات لهذه الجلسة فقط؛ النسخة المحفوظة لم تتغير.";
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(rows));
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
      persist();
      render();
    });
    card.append(favorite, remove);
    results.append(card);
  }
}
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
