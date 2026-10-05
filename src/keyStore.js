/**
 * Azure key and region storage, by the user's choice:
 * "remember" on -> localStorage; off -> this page's memory only.
 */

const KEY_ITEM = "pronunciation-coach.key";
const REGION_ITEM = "pronunciation-coach.region";

import { AZURE_REGIONS } from "./config.js";

const KNOWN_REGIONS = new Set(AZURE_REGIONS.map(([code]) => code));

/**
 * Whether a value is one of the Azure Speech region codes the app offers. The region becomes
 * part of request URLs, so only listed codes are used, including values read back from storage.
 *
 * @param {unknown} code
 * @returns {boolean}
 */
export function isKnownRegion(code) {
  return typeof code === "string" && KNOWN_REGIONS.has(code);
}

/**
 * @param {Storage | null} [storage] Defaults to localStorage when available.
 */
export function createKeyStore(storage = defaultStorage()) {
  let memory = null;

  const read = (name) => {
    try {
      return storage?.getItem(name) ?? null;
    } catch {
      return null;
    }
  };
  const write = (name, value) => {
    try {
      storage?.setItem(name, value);
    } catch {
      // Storage blocked: the key still works for this page.
    }
  };
  const remove = (name) => {
    try {
      storage?.removeItem(name);
    } catch {
      // Nothing stored.
    }
  };

  return {
    /** @returns {{key: string, region: string, remembered: boolean} | null} */
    load() {
      if (memory) return { ...memory, remembered: read(KEY_ITEM) !== null };
      const key = read(KEY_ITEM);
      const region = read(REGION_ITEM);
      if (!key || !region) return null;
      if (!isKnownRegion(region)) {
        // Corrupted, stale or foreign value: drop it with the key and ask again.
        remove(KEY_ITEM);
        remove(REGION_ITEM);
        return null;
      }
      return { key, region, remembered: true };
    },

    /** @param {{key: string, region: string, remember: boolean}} credentials */
    save({ key, region, remember }) {
      memory = { key, region };
      if (remember) {
        write(KEY_ITEM, key);
        write(REGION_ITEM, region);
      } else {
        remove(KEY_ITEM);
        remove(REGION_ITEM);
      }
    },

    /** Clear the key and region from memory and storage. */
    forget() {
      memory = null;
      remove(KEY_ITEM);
      remove(REGION_ITEM);
    },
  };
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
