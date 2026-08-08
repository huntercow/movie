import assert from "node:assert/strict";
import test from "node:test";
import { openOrFocusXianyuIm } from "../src/webhook/xianyuImNavigator.ts";

test("focuses an existing Xianyu IM tab and its window", async () => {
  const calls = [];
  const chromeApi = {
    tabs: {
      async query(query) { calls.push(["query", query]); return [{ id: 7, windowId: 3 }]; },
      async update(id, update) { calls.push(["update", id, update]); },
      async create(create) { calls.push(["create", create]); }
    },
    windows: {
      async update(id, update) { calls.push(["window", id, update]); }
    }
  };
  await openOrFocusXianyuIm(chromeApi);
  assert.deepEqual(calls, [
    ["query", { url: "https://www.goofish.com/im*" }],
    ["update", 7, { active: true }],
    ["window", 3, { focused: true }]
  ]);
});

test("opens Xianyu IM when no existing tab exists", async () => {
  const calls = [];
  const chromeApi = {
    tabs: {
      async query() { return []; },
      async update() {},
      async create(create) { calls.push(create); }
    },
    windows: { async update() {} }
  };
  await openOrFocusXianyuIm(chromeApi);
  assert.deepEqual(calls, [{ url: "https://www.goofish.com/im" }]);
});
