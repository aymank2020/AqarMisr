// Use a local fixture server and isolated browser contexts; no user profile is loaded.
if (process.argv.includes("--help")) {
  console.log(
    "PLAYWRIGHT_MODULE=<existing Playwright module> URL=http://127.0.0.1:8080/ node scripts/verify-portability.cjs",
  );
  console.log(
    "Optional: OUTPUT_DIR=<output directory>, SOURCE_SHA=<operator-verified revision>, SCREENSHOT=1, --smoke. Outputs default to a new temporary directory.",
  );
  process.exit(0);
}
if (!process.env.PLAYWRIGHT_MODULE) {
  console.error(
    "Set PLAYWRIGHT_MODULE to an existing installed Playwright module. This script does not install dependencies.",
  );
  process.exit(1);
}
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const key = "aqar-misr-properties-v1";
const url = process.env.URL || "http://127.0.0.1:8080/";
const targetUrl = new URL(url);
if (
  !["http:", "https:"].includes(targetUrl.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(targetUrl.hostname)
) {
  throw new Error("URL must point to a local fixture server.");
}
let evidence;
const property = (id, kind = "sale") => ({
  id,
  title: "عرض " + id,
  location: "الجيزة",
  kind,
  price: 120000,
  area: 60,
  favorite: false,
});
const file = (rows) => ({
  name: "properties.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify({ schema_version: 1, properties: rows })),
});
let browser;
const errors = [];
const dialogs = [];
const checks = [];
async function preview(page, rows) {
  await page.locator("#import-file").setInputFiles(file(rows));
  await page
    .locator("#import-preview")
    .getByText(/عقار صالح/)
    .waitFor();
}
async function confirm(page) {
  await page.locator("#confirm-replace").check();
  await page.locator("#apply-import").click();
}
async function download(page, selector, filename) {
  const awaited = page.waitForEvent("download");
  await page.locator(selector).click();
  const transfer = await awaited;
  const target = path.join(evidence, filename);
  await transfer.saveAs(target);
  return fs.readFile(target, "utf8");
}
(async () => {
  evidence =
    process.env.OUTPUT_DIR || process.env.EVIDENCE_DIR
      ? path.resolve(process.env.OUTPUT_DIR || process.env.EVIDENCE_DIR)
      : await fs.mkdtemp(path.join(os.tmpdir(), "aqar-portability-"));
  await fs.mkdir(evidence, { recursive: true });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", async (d) => {
    dialogs.push(d.type());
    await d.dismiss();
  });
  await page.goto(url);
  for (const [name, kind, price] of [
    ["قديم للبيع", "sale", "200000"],
    ["قديم إيجار", "rent", "3000"],
  ]) {
    await page.getByLabel("العنوان", { exact: true }).fill(name);
    await page.getByLabel("الموقع", { exact: true }).fill("الجيزة");
    await page.locator('#property-form select[name="kind"]').selectOption(kind);
    await page.getByLabel("السعر بالجنيه", { exact: true }).fill(price);
    await page.getByLabel("المساحة بالمتر المربع", { exact: true }).fill("100");
    await page
      .getByRole("button", { name: "إضافة العقار", exact: true })
      .click();
  }
  await page
    .getByRole("button", { name: "إضافة للمفضلة: قديم للبيع", exact: true })
    .click();
  const originalRaw = await page.evaluate(
    (key) => localStorage.getItem(key),
    key,
  );
  const exported = JSON.parse(
    await download(page, "#export-properties", "aqar-export-synthetic.json"),
  );
  assert.equal(exported.schema_version, 1);
  assert.equal(exported.properties.length, 2);
  assert.equal(exported.properties[0].favorite, true);
  assert.deepEqual(
    exported.properties.map(({ id, ...row }) => {
      assert.equal(typeof id, "string");
      assert.ok(id.length > 0);
      return row;
    }),
    [
      {
        title: "قديم للبيع",
        location: "الجيزة",
        kind: "sale",
        price: 200000,
        area: 100,
        favorite: true,
      },
      {
        title: "قديم إيجار",
        location: "الجيزة",
        kind: "rent",
        price: 3000,
        area: 100,
        favorite: false,
      },
    ],
  );
  assert.notEqual(exported.properties[0].id, exported.properties[1].id);
  checks.push("real form -> export download with original favorite");
  if (process.argv.includes("--smoke")) {
    assert.deepEqual(errors, []);
    assert.deepEqual(dialogs, []);
    await fs.writeFile(
      path.join(evidence, "aqar-portability-smoke-result.json"),
      JSON.stringify(
        {
          checked_at: new Date().toISOString(),
          source_sha: process.env.SOURCE_SHA || null,
          source_sha_provenance: "operator supplied; not inferred from browser",
          status: "passed",
          mode: "smoke",
          real_browser: "Microsoft Edge headless",
          checks,
          page_errors: errors,
          unexpected_dialogs: dialogs,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      "PASS: local Edge form -> favorite -> JSON download smoke. Evidence directory: " +
        evidence,
    );
    return;
  }
  const imported = [
    property("r1", "rent"),
    property("r2", "rent"),
    property("r3", "rent"),
    property("r4", "rent"),
    property("s1"),
  ];
  imported[0].title = "<img src=x onerror=alert(1)> مستورد";
  imported[0].favorite = true;
  await preview(page, imported);
  assert.equal(await page.locator("#results article").count(), 2);
  assert.equal(
    await page.evaluate((key) => localStorage.getItem(key), key),
    originalRaw,
  );
  assert.equal(await page.locator("#apply-import").isDisabled(), true);
  const backup = JSON.parse(
    await download(page, "#download-backup", "aqar-backup-synthetic.json"),
  );
  assert.deepEqual(backup, exported);
  assert.equal(
    await download(page, "#download-saved", "aqar-raw-backup-synthetic.json"),
    originalRaw,
  );
  checks.push("preview does not mutate; real prior backup and raw download");
  await confirm(page);
  assert.equal(await page.locator("#results article").count(), 5);
  assert.equal(await page.locator("#results img").count(), 0);
  await page.reload();
  assert.equal(await page.locator("#results article").count(), 5);
  await page.getByLabel("المفضلة فقط").check();
  assert.equal(await page.locator("#results article").count(), 1);
  await page.getByLabel("المفضلة فقط").uncheck();
  checks.push(
    "confirmed import -> persistence/reload/favorite, HTML shown as text",
  );
  for (const title of [
    imported[0].title,
    imported[1].title,
    imported[2].title,
  ]) {
    await page
      .getByRole("button", { name: "قارن هذا العرض: " + title, exact: true })
      .click();
  }
  const comparison = page.locator("#comparison");
  await comparison.getByText("مقارنة 3 من عروض الإيجار الشهري").waitFor();
  await comparison.getByText("ج.م لكل م² / شهر", { exact: true }).waitFor();
  await page
    .getByRole("button", {
      name: "قارن هذا العرض: " + imported[3].title,
      exact: true,
    })
    .click();
  await page.locator("#status").getByText(/ثلاثة/).waitFor();
  assert.equal(await comparison.locator("thead th").count(), 4);
  await page
    .getByRole("button", {
      name: "إزالة من المقارنة: " + imported[2].title,
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "قارن هذا العرض: " + imported[4].title,
      exact: true,
    })
    .click();
  await page
    .locator("#status")
    .getByText(/البيع مع البيع/)
    .waitFor();
  assert.equal(await comparison.locator("thead th").count(), 3);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  if (process.env.SCREENSHOT === "1")
    await page.screenshot({
      path: path.join(evidence, "aqar-portability-phone.png"),
      fullPage: true,
    });
  checks.push(
    "real comparison: monthly units; fourth/mixed type rejected; phone no overflow",
  );
  await preview(page, exported.properties);
  await confirm(page);
  await page.reload();
  assert.deepEqual(
    JSON.parse(await page.evaluate((key) => localStorage.getItem(key), key)),
    exported.properties,
  );
  checks.push("export -> replacement -> real file reimport roundtrip");
  for (const [name, buffer, expected] of [
    [
      "version.json",
      JSON.stringify({ ...exported, schema_version: 2 }),
      /صيغة الملف غير مدعومة/,
    ],
    [
      "duplicate.json",
      JSON.stringify({
        schema_version: 1,
        properties: [property("dup"), property("dup")],
      }),
      /مكررة/,
    ],
    [
      "many.json",
      JSON.stringify({
        schema_version: 1,
        properties: Array.from({ length: 201 }, (_, i) => property("n" + i)),
      }),
      /200 عقار/,
    ],
    ["malformed.json", "{", /تعذر قراءة JSON/],
    ["oversize.json", " ".repeat(512 * 1024 + 1), /512 كيلوبايت/],
  ]) {
    await page.locator("#import-file").setInputFiles({
      name,
      mimeType: "application/json",
      buffer: Buffer.from(buffer),
    });
    await page.locator("#status").getByText(expected).waitFor();
    assert.equal(await page.locator("#apply-import").isDisabled(), true);
    assert.deepEqual(
      JSON.parse(await page.evaluate((key) => localStorage.getItem(key), key)),
      exported.properties,
    );
  }
  checks.push(
    "version/duplicate/201/malformed/oversize rejection does not change saved book",
  );
  await preview(page, imported);
  await page
    .getByRole("button", { name: "إضافة للمفضلة: قديم إيجار", exact: true })
    .click();
  assert.equal(await page.locator("#apply-import").isDisabled(), true);
  assert.equal(await page.locator("#import-preview").textContent(), "");
  checks.push("local mutation invalidates stale preview and confirmation");
  await preview(page, imported);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Full", "QuotaExceededError");
    };
  });
  const beforeQuota = await page.evaluate(
    (key) => localStorage.getItem(key),
    key,
  );
  await confirm(page);
  await page
    .locator("#status")
    .getByText(/تعذر الاستبدال/)
    .waitFor();
  assert.equal(await page.locator("#results article").count(), 2);
  assert.equal(
    await page.evaluate((key) => localStorage.getItem(key), key),
    beforeQuota,
  );
  checks.push("quota failure keeps the prior UI and saved book");
  const concurrentContext = await browser.newContext();
  const concurrent = await concurrentContext.newPage();
  concurrent.on("pageerror", (e) => errors.push(e.message));
  await concurrent.goto(url);
  await preview(concurrent, [property("new")]);
  const changedRaw = JSON.stringify([property("other-tab")]);
  const otherTab = await concurrentContext.newPage();
  await otherTab.goto(url);
  await otherTab.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
    key,
    raw: changedRaw,
  });
  await confirm(concurrent);
  await concurrent
    .locator("#status")
    .getByText(/نافذة أخرى/)
    .waitFor();
  assert.equal(
    await concurrent.evaluate((key) => localStorage.getItem(key), key),
    changedRaw,
  );
  assert.equal(await concurrent.locator("#results article").count(), 0);
  checks.push(
    "saved book changed after preview -> apply rejects instead of overwriting",
  );
  const corruptContext = await browser.newContext();
  await corruptContext.addInitScript(
    ({ key }) => localStorage.setItem(key, "corrupt fixture"),
    { key },
  );
  const corrupt = await corruptContext.newPage();
  corrupt.on("pageerror", (e) => errors.push(e.message));
  await corrupt.goto(url);
  await preview(corrupt, [property("session")]);
  assert.equal(
    await download(
      corrupt,
      "#download-saved",
      "aqar-corrupt-raw-synthetic.json",
    ),
    "corrupt fixture",
  );
  await confirm(corrupt);
  await corrupt
    .getByRole("button", { name: "إضافة للمفضلة: عرض session", exact: true })
    .click();
  assert.equal(await corrupt.locator("#results article").count(), 1);
  assert.equal(
    await corrupt.evaluate((key) => localStorage.getItem(key), key),
    "corrupt fixture",
  );
  await corrupt
    .locator("#status")
    .getByText(/لهذه الجلسة فقط/)
    .waitFor();
  checks.push(
    "corrupt raw download works and import+favorite remain session-only",
  );
  await concurrent.setViewportSize({ width: 1280, height: 900 });
  await concurrent.reload();
  assert.equal(
    await concurrent.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  checks.push("desktop no horizontal page overflow");
  assert.deepEqual(errors, []);
  assert.deepEqual(dialogs, []);
  await fs.writeFile(
    path.join(evidence, "aqar-portability-browser-result.json"),
    JSON.stringify(
      {
        checked_at: new Date().toISOString(),
        source_sha: process.env.SOURCE_SHA || null,
        source_sha_provenance: "operator supplied; not inferred from browser",
        status: "passed",
        real_browser: "Microsoft Edge headless",
        checks,
        page_errors: errors,
        unexpected_dialogs: dialogs,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Evidence directory: " + evidence);
  console.log(
    "PASS: Aqar portability and comparison through real Edge entry points (" +
      checks.length +
      " groups).",
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
  });
