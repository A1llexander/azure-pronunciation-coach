import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createKeyStore, isKnownRegion } from "../src/keyStore.js";

function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

describe("isKnownRegion", () => {
  test("accepts listed region codes only", () => {
    assert.equal(isKnownRegion("westeurope"), true);
    assert.equal(isKnownRegion("eastus"), true);
    for (const bad of ["West Europe", "eastus1", "x.evil.com#", "", null, undefined, 42]) {
      assert.equal(isKnownRegion(bad), false, String(bad));
    }
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

  test("a stored region that is not a known code is dropped together with the key", () => {
    const storage = fakeStorage();
    storage.setItem("pronunciation-coach.key", "k1");
    storage.setItem("pronunciation-coach.region", "x.evil.com#");
    assert.equal(createKeyStore(storage).load(), null);
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
