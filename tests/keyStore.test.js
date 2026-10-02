import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createKeyStore, normalizeRegion } from "../src/keyStore.js";

function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

describe("normalizeRegion", () => {
  test("accepts codes and fixes display names", () => {
    assert.equal(normalizeRegion("westeurope"), "westeurope");
    assert.equal(normalizeRegion(" West Europe "), "westeurope");
    assert.equal(normalizeRegion("ea stus"), "eastus");
  });

  test("rejects what cannot be a region code", () => {
    assert.equal(normalizeRegion("east_us"), null);
    assert.equal(normalizeRegion("https://eastus.api.cognitive.microsoft.com/"), null);
    assert.equal(normalizeRegion(""), null);
  });
});

describe("createKeyStore", () => {
  test("remember on: survives a new store over the same storage", () => {
    const storage = fakeStorage();
    createKeyStore(storage).save({ key: "k1", region: "eastus", remember: true });
    assert.deepEqual(createKeyStore(storage).load(), { key: "k1", region: "eastus", remembered: true });
  });

  test("remember off: memory only, nothing written, gone with the page", () => {
    const storage = fakeStorage();
    const store = createKeyStore(storage);
    store.save({ key: "k1", region: "eastus", remember: false });
    assert.deepEqual(store.load(), { key: "k1", region: "eastus", remembered: false });
    assert.equal(storage.map.size, 0);
    assert.equal(createKeyStore(storage).load(), null);
  });

  test("switching remember off removes a previously stored key", () => {
    const storage = fakeStorage();
    const store = createKeyStore(storage);
    store.save({ key: "k1", region: "eastus", remember: true });
    store.save({ key: "k1", region: "eastus", remember: false });
    assert.equal(storage.map.size, 0);
  });

  test("forget clears memory and storage", () => {
    const storage = fakeStorage();
    const store = createKeyStore(storage);
    store.save({ key: "k1", region: "eastus", remember: true });
    store.forget();
    assert.equal(store.load(), null);
    assert.equal(storage.map.size, 0);
  });

  test("blocked storage does not throw", () => {
    const throwing = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };
    const store = createKeyStore(throwing);
    store.save({ key: "k", region: "eastus", remember: true });
    assert.equal(store.load().key, "k");
    store.forget();
    assert.equal(store.load(), null);
  });
});
