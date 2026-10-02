import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { exportProperties, MAX_TRANSFER_BYTES } from "../core.mjs";

const key = "aqar-misr-properties-v1";
const initial = {
  id: "old",
  title: "العرض القديم",
  location: "الجيزة",
  kind: "rent",
  price: 6000,
  area: 120,
  favorite: true,
};
const imported = {
  ...initial,
  id: "new",
  title: "العرض الجديد",
  favorite: false,
};
const markup = await readFile(
  new URL("../index.html", import.meta.url),
  "utf8",
);
const modulePath = new URL("../app.mjs", import.meta.url).href;

// Only the browser boundary is simulated. Actual app.mjs and core.mjs imports,
// event registration, parsing, rendering, and storage decisions execute unchanged.
async function appFixture(raw = JSON.stringify([initial])) {
  const downloads = [];
  const blobs = new Map();
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.listeners = {};
      this.attributes = {};
      this.value = "";
      this.checked = false;
      this.disabled = false;
      this.files = [];
      this.text = "";
    }
    set textContent(value) {
      this.text = String(value);
      this.children = [];
    }
    get textContent() {
      return (
        this.text + this.children.map((child) => child.textContent).join(" ")
      );
    }
    append(...children) {
      for (const child of children) {
        child.parent = this;
        this.children.push(child);
      }
    }
    replaceChildren(...children) {
      this.children = [];
      this.append(...children);
    }
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
    addEventListener(name, listener) {
      (this.listeners[name] ??= []).push(listener);
    }
    async emit(name, extra = {}) {
      for (const listener of this.listeners[name] ?? [])
        await listener({ currentTarget: this, preventDefault() {}, ...extra });
    }
    click() {
      if (this.tagName === "a")
        downloads.push({ filename: this.download, blob: blobs.get(this.href) });
      else return this.emit("click");
    }
    remove() {
      this.parent.children = this.parent.children.filter(
        (child) => child !== this,
      );
    }
  }
  const nodes = new Map(
    [...markup.matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"[^>]*>/g)].map((match) => {
      const node = new Element(match[1]);
      node.disabled = /\bdisabled\b/.test(match[0]);
      return [match[2], node];
    }),
  );
  nodes.get("sort").value = "newest";
  const values = new Map(raw === null ? [] : [[key, raw]]);
  const storage = {
    failWrite: false,
    getItem: (name) => values.get(name) ?? null,
    setItem(name, value) {
      if (this.failWrite) throw new Error("QuotaExceededError");
      values.set(name, value);
    },
  };
  const originals = {
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    URL: globalThis.URL,
  };
  globalThis.document = {
    querySelector: (selector) => nodes.get(selector.slice(1)),
    createElement: (tag) => new Element(tag),
    body: new Element("body"),
  };
  globalThis.localStorage = storage;
  globalThis.URL = {
    createObjectURL(blob) {
      const url = randomUUID();
      blobs.set(url, blob);
      return url;
    },
    revokeObjectURL(url) {
      blobs.delete(url);
    },
  };
  try {
    await import(`${modulePath}?fixture=${randomUUID()}`);
  } catch (error) {
    Object.assign(globalThis, originals);
    throw error;
  }
  return {
    nodes,
    values,
    storage,
    downloads,
    async preview(text, size = Buffer.byteLength(text)) {
      const input = nodes.get("import-file");
      input.files = [{ size, text: async () => text }];
      await input.emit("change");
    },
    async approve() {
      const checkbox = nodes.get("confirm-replace");
      checkbox.checked = true;
      await checkbox.emit("change");
      await nodes.get("apply-import").emit("click");
    },
    close() {
      Object.assign(globalThis, originals);
    },
  };
}

test("real app preview leaves data intact; backup precedes explicit replacement and roundtrip", async () => {
  const app = await appFixture();
  try {
    await app.preview(exportProperties([imported]));
    assert.deepEqual(JSON.parse(app.values.get(key)), [initial]);
    assert.match(app.nodes.get("import-preview").textContent, /1 عقار صالح/);
    assert.equal(app.nodes.get("apply-import").disabled, true);
    await app.nodes.get("apply-import").emit("click");
    assert.deepEqual(JSON.parse(app.values.get(key)), [initial]);
    await app.nodes.get("download-backup").emit("click");
    assert.deepEqual(
      JSON.parse(await app.downloads[0].blob.text()).properties,
      [initial],
    );
    await app.approve();
    assert.deepEqual(JSON.parse(app.values.get(key)), [imported]);
    await app.nodes.get("export-properties").emit("click");
    const exported = await app.downloads.at(-1).blob.text();
    await app.preview(exportProperties([]));
    await app.approve();
    assert.deepEqual(JSON.parse(app.values.get(key)), []);
    await app.preview(exported);
    await app.approve();
    assert.deepEqual(JSON.parse(app.values.get(key)), [imported]);
  } finally {
    app.close();
  }
});

test("real app invalid/large imports and cancellation never replace data", async () => {
  const app = await appFixture();
  try {
    for (const text of [
      "{",
      JSON.stringify({ schema_version: 99, properties: [] }),
      exportProperties([imported]).replace(
        '"favorite": false',
        '"favorite": "false"',
      ),
    ]) {
      await app.preview(text);
      await app.approve();
      assert.deepEqual(JSON.parse(app.values.get(key)), [initial]);
      assert.equal(app.nodes.get("apply-import").disabled, true);
    }
    await app.preview(exportProperties([imported]), MAX_TRANSFER_BYTES + 1);
    assert.match(app.nodes.get("status").textContent, /512/);
    await app.preview(exportProperties([imported]));
    await app.nodes.get("cancel-import").emit("click");
    await app.approve();
    assert.deepEqual(JSON.parse(app.values.get(key)), [initial]);
  } finally {
    app.close();
  }
});

test("real app preserves corrupt storage even after import and favorite", async () => {
  const corrupt = "{unreadable-original";
  const app = await appFixture(corrupt);
  try {
    await app.preview(exportProperties([imported]));
    await app.nodes.get("download-saved").emit("click");
    assert.equal(await app.downloads[0].blob.text(), corrupt);
    await app.approve();
    assert.equal(app.values.get(key), corrupt);
    assert.match(app.nodes.get("status").textContent, /الجلسة فقط/);
    const favorite = app.nodes
      .get("results")
      .children[0].children.find((child) =>
        child.attributes["aria-label"]?.startsWith("إضافة للمفضلة"),
      );
    await favorite.emit("click");
    assert.equal(app.values.get(key), corrupt);
  } finally {
    app.close();
  }
});

test("real app failed write or concurrent tab preserves the preceding book", async () => {
  const app = await appFixture();
  try {
    await app.preview(exportProperties([imported]));
    app.storage.failWrite = true;
    await app.approve();
    assert.deepEqual(JSON.parse(app.values.get(key)), [initial]);
    assert.match(app.nodes.get("results").textContent, /العرض القديم/);
    assert.match(app.nodes.get("status").textContent, /لم يتغير/);
    app.storage.failWrite = false;
    const external = JSON.stringify([{ ...initial, id: "external" }]);
    app.values.set(key, external);
    await app.approve();
    assert.equal(app.values.get(key), external);
    assert.match(app.nodes.get("results").textContent, /العرض القديم/);
  } finally {
    app.close();
  }
});

test("real compare buttons reject mixed types/fourth offer and keep monthly units", async () => {
  const rows = Array.from({ length: 4 }, (_, i) => ({
    ...initial,
    id: String(i),
    title: `إيجار ${i}`,
  }));
  rows.push({ ...initial, id: "sale", title: "بيع", kind: "sale" });
  const app = await appFixture(JSON.stringify(rows));
  try {
    const select = async (title) => {
      const card = app.nodes
        .get("results")
        .children.find((node) => node.children[0].textContent === title);
      await card.children
        .find((node) =>
          node.attributes["aria-label"]?.startsWith("قارن هذا العرض"),
        )
        .emit("click");
    };
    await select("إيجار 0");
    await select("بيع");
    assert.match(app.nodes.get("status").textContent, /الإيجار الشهري/);
    await select("إيجار 1");
    await select("إيجار 2");
    await select("إيجار 3");
    assert.match(app.nodes.get("status").textContent, /ثلاثة/);
    assert.match(app.nodes.get("comparison").textContent, /مقارنة 3/);
    assert.match(app.nodes.get("comparison").textContent, /ج\.م لكل م² \/ شهر/);
  } finally {
    app.close();
  }
});

test("real app ignores a stale async file and invalidates preview after an edit", async () => {
  const app = await appFixture();
  try {
    let release;
    const input = app.nodes.get("import-file");
    input.files = [
      {
        size: 1,
        text: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      },
    ];
    const firstRead = input.emit("change");
    await app.preview(exportProperties([imported]));
    release(exportProperties([{ ...imported, title: "ملف قديم متأخر" }]));
    await firstRead;
    assert.match(app.nodes.get("import-preview").textContent, /العرض الجديد/);
    assert.doesNotMatch(app.nodes.get("import-preview").textContent, /متأخر/);
    const favorite = app.nodes
      .get("results")
      .children[0].children.find((child) =>
        child.attributes["aria-label"]?.startsWith("إزالة من المفضلة"),
      );
    await favorite.emit("click");
    await app.approve();
    assert.deepEqual(JSON.parse(app.values.get(key)), [
      { ...initial, favorite: false },
    ]);
    assert.equal(app.nodes.get("apply-import").disabled, true);
  } finally {
    app.close();
  }
});
