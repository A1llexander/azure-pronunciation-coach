/**
 * Azure key and region storage, by the user's choice:
 * "remember" on -> localStorage; off -> this page's memory only.
 */

const KEY_ITEM = "pronunciation-coach.key";
const REGION_ITEM = "pronunciation-coach.region";

/**
 * Normalize a region typed by the user ("West Europe" -> "westeurope").
 *
 * @param {string} raw
 * @returns {string | null} Region code, or null if it cannot be one.
 */
export function normalizeRegion(raw) {
  const region = raw.replace(/\s+/g, "").toLowerCase();
  return /^[a-z0-9]+$/.test(region) ? region : null;
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
      return key && region ? { key, region, remembered: true } : null;
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
