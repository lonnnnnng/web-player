"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createSafeStorage } = require("../static/utils.js");
const { createProgressSync } = require("../static/progress.js");

function memoryStorage() {
  const data = new Map();
  return {
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k),
    key: i => [...data.keys()][i],
    get length() { return data.size; },
  };
}

function harness(overrides = {}) {
  const backing = overrides.backing || memoryStorage();
  const storage = createSafeStorage(() => backing);
  const timers = new Map();
  let timerId = 0;
  const calls = [];
  const sync = createProgressSync({ storage, now: () => 200000,
    setTimer(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimer: id => timers.delete(id),
    beacon: () => true,
    fetch: async (url, options) => {
      calls.push(options);
      if (!options) return { ok: true, json: async () => ({ items: {} }) };
      const items = Object.fromEntries(JSON.parse(options.body).items.map(({ path, ...rec }) => [path, rec]));
      return { ok: true, json: async () => ({ ok: true, items, rejected: [] }) };
    }, ...overrides,
  });
  return { sync, storage, backing, calls, timers,
    pending: () => JSON.parse(storage.getItem("vp-pending-progress")) || [] };
}

test("acknowledged progress clears only after server success", async () => {
  const h = harness();
  h.sync.write("clip.mp4", 9, 10);
  assert.equal(h.pending().length, 1);
  await h.sync.push();
  assert.deepEqual(h.pending(), []);
  assert.equal(h.sync.read("clip.mp4").t, 9);
});

test("sync status distinguishes local queue, confirmation and offline failure", async () => {
  const states = [];
  const h = harness({ onStatus: state => states.push(state) });
  await h.sync.pull();
  assert.equal(states.at(-1), "synced");
  h.sync.write("clip.mp4", 3, 10);
  assert.equal(states.at(-1), "pending");
  const pushing = h.sync.push();
  assert.equal(states.at(-1), "syncing");
  await pushing;
  assert.equal(states.at(-1), "synced");
  const offlineStates = [];
  const offline = harness({ fetch: async () => ({ ok: false, status: 503 }), onStatus: state => offlineStates.push(state) });
  await offline.sync.pull();
  assert.equal(offlineStates.at(-1), "offline");
  offline.sync.write("clip.mp4", 4, 10);
  await offline.sync.push();
  assert.equal(offlineStates.at(-1), "offline");
  assert.equal(offline.pending().length, 1);
});

test("HTTP errors and invalid acknowledgments retain a durable retry queue", async () => {
  for (const response of [{ ok: false, status: 503 }, { ok: true, json: async () => ({ ok: true }) }]) {
    const h = harness({ fetch: async () => response });
    h.sync.write("clip.mp4", 4, 10);
    await h.sync.push();
    assert.equal(h.pending().length, 1);
    assert.ok([...h.timers.values()].some(t => t.delay === 2000));
    const reloaded = harness({ backing: h.backing });
    await reloaded.sync.push();
    assert.equal(reloaded.calls.length, 1);
    assert.deepEqual(reloaded.pending(), []);
  }
});

test("synchronous network failure does not leave the sender stuck", async () => {
  let attempts = 0;
  const h = harness({ fetch() { attempts++; throw new Error("offline"); } });
  h.sync.write("clip.mp4", 4, 10);
  await h.sync.push();
  await h.sync.push();
  assert.equal(attempts, 2);
  assert.equal(h.pending().length, 1);
});

test("older response cannot clear a newer in-flight update", async () => {
  let respond;
  const h = harness({ fetch: () => new Promise(resolve => { respond = resolve; }) });
  h.sync.write("clip.mp4", 2, 10);
  const old = h.sync.read("clip.mp4");
  const sending = h.sync.push();
  await Promise.resolve();
  h.sync.write("clip.mp4", 3, 10);
  respond({ ok: true, json: async () => ({ ok: true, items: { "clip.mp4": old }, rejected: [] }) });
  await sending;
  assert.equal(h.pending()[0][1].t, 3);
  assert.equal(h.sync.read("clip.mp4").t, 3);
});

test("beacon success never acknowledges server persistence; refusal falls back to fetch", async () => {
  for (const accepted of [true, false]) {
    const h = harness({ beacon: () => accepted });
    h.sync.remove("clip.mp4");
    h.sync.flushBeacon();
    assert.equal(h.pending().length, 1);
    if (!accepted) {
      await h.sync.push();
      assert.equal(h.calls.length, 1);
      assert.deepEqual(h.pending(), []);
    }
  }
});

test("continuous writes keep the first send deadline and upload the latest version", async () => {
  const h = harness();
  h.sync.write("clip.mp4", 1, 10);
  const firstTimer = [...h.timers.keys()][0];
  const firstTs = h.sync.read("clip.mp4").ts;
  for (let t = 2; t < 10; t++) h.sync.write("clip.mp4", t, 10);
  assert.deepEqual([...h.timers.keys()], [firstTimer]);
  assert.ok(h.sync.read("clip.mp4").ts > firstTs);
  h.timers.get(firstTimer).fn();
  await h.sync.push();
  assert.equal(h.calls.length, 1);
  assert.equal(JSON.parse(h.calls[0].body).items[0].t, 9);
  assert.deepEqual(h.pending(), []);
});

test("server tombstones suppress local history, including equal timestamp conflicts", async () => {
  const backing = memoryStorage();
  backing.setItem("vp-progress:clip.mp4", JSON.stringify({ t: 5, d: 10, ts: 200 }));
  const tombstone = { t: 0, d: 0, ts: 200 };
  const h = harness({ backing, fetch: async () => ({ ok: true, json: async () => ({ items: { "clip.mp4": tombstone } }) }) });
  await h.sync.pull();
  assert.equal(h.sync.read("clip.mp4").d, 0);
  assert.deepEqual(h.pending(), []);
});

test("pending deletion survives reload and defeats an older server record", async () => {
  const h = harness();
  h.sync.remove("clip.mp4");
  const reloaded = harness({ backing: h.backing,
    fetch: async () => ({ ok: true, json: async () => ({ items: { "clip.mp4": { t: 5, d: 10, ts: 199 } } }) }),
  });
  await reloaded.sync.pull();
  assert.equal(reloaded.sync.read("clip.mp4").d, 0);
  assert.equal(reloaded.pending().length, 1);
});

test("newer server confirmation replaces an older client record", async () => {
  const h = harness({ fetch: async () => ({ ok: true,
    json: async () => ({ ok: true, items: { "clip.mp4": { t: 8, d: 10, ts: 300 } }, rejected: [] }),
  }) });
  h.sync.write("clip.mp4", 2, 10);
  await h.sync.push();
  assert.equal(h.sync.read("clip.mp4").t, 8);
  assert.deepEqual(h.pending(), []);
});

test("disabled localStorage does not block progress or network sync", async () => {
  const denied = new Proxy({}, { get() { throw new Error("SecurityError"); } });
  const h = harness({ backing: denied });
  h.sync.write("clip.mp4", 5, 10);
  assert.equal(h.sync.read("clip.mp4").t, 5);
  await h.sync.push();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.pending(), []);
});

test("quota exhaustion evicts only disposable thumbnails and preserves failed new values", () => {
  const backing = memoryStorage();
  backing.setItem("vp-thumb:clip.mp4", "cache");
  backing.setItem("vp-progress:clip.mp4", "old");
  const originalSet = backing.setItem;
  backing.setItem = (k, v) => {
    if (backing.getItem("vp-thumb:clip.mp4")) throw new Error("QuotaExceededError");
    originalSet(k, v);
  };
  const storage = createSafeStorage(() => backing);
  storage.setItem("vp-progress:clip.mp4", "new");
  assert.equal(backing.getItem("vp-thumb:clip.mp4"), null);
  assert.equal(storage.getItem("vp-progress:clip.mp4"), "new");
  backing.setItem = () => { throw new Error("QuotaExceededError"); };
  storage.setItem("vp-progress:clip.mp4", "newest");
  assert.equal(storage.getItem("vp-progress:clip.mp4"), "newest");
});

test("beacon payload is bounded for multibyte paths", () => {
  let bytes = 0;
  const h = harness({ beacon: (url, blob) => { bytes = blob.size; return true; } });
  for (let i = 0; i < 110; i++) h.sync.write("音".repeat(150) + i + ".mp4", 1, 10);
  h.sync.flushBeacon();
  assert.ok(bytes > 0 && bytes <= 48000);
  assert.equal(h.pending().length, 110);
});
