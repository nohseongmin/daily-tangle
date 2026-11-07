"use strict";

// Run with: node game.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const handlers = new Map();
const captures = [];
const drawing = Object.fromEntries(
  ["clearRect", "beginPath", "moveTo", "lineTo", "stroke", "arc", "fill"].map((name) => [name, () => {}])
);
const canvas = {
  width: 420,
  height: 520,
  getContext: () => drawing,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 420, height: 520 }),
  addEventListener: (name, handler) => handlers.set(name, handler),
  setPointerCapture: (pointerId) => captures.push(pointerId),
};
const elements = new Map([["game", canvas]]);
const context = vm.createContext({
  document: {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        textContent: "",
        style: {},
        classList: { add() {}, remove() {} },
        addEventListener() {},
      });
      return elements.get(id);
    },
    addEventListener() {},
  },
  window: {},
  localStorage: { getItem: () => null, setItem() {} },
  location: { search: "?seed=1", pathname: "/" },
  history: { replaceState() {} },
  URLSearchParams,
  Date: class extends Date { static now() { return 1; } },
  setInterval: () => 1,
  clearInterval() {},
  setTimeout() {},
  clearTimeout() {},
});
const source = fs.readFileSync(path.join(__dirname, "game.js"), "utf8");
vm.runInContext(source, context);
const state = vm.runInContext("state", context);
state.puzzle = {
  pos: [{ x: 100, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }, { x: 300, y: 100 }],
  edges: [[0, 1], [2, 3]],
};
state.solved = false;
state.moves = 0;
state.crossPairs = 1;

handlers.get("pointerdown")({ pointerId: 1, clientX: 100, clientY: 100 });
handlers.get("pointerdown")({ pointerId: 2, clientX: 300, clientY: 300 });
assert.equal(state.dragIndex, 0);
assert.deepEqual(captures, [1]);

handlers.get("pointermove")({ pointerId: 2, clientX: 200, clientY: 250 });
assert.equal(state.puzzle.pos[0].x, 100);
assert.equal(state.puzzle.pos[0].y, 100);
assert.equal(state.dragMoved, false);
handlers.get("pointerup")({ pointerId: 2 });
handlers.get("pointercancel")({ pointerId: 2 });
assert.equal(state.dragIndex, 0);
assert.equal(state.moves, 0);

handlers.get("pointermove")({ pointerId: 1, clientX: 110, clientY: 110 });
assert.equal(state.puzzle.pos[0].x, 110);
assert.equal(state.puzzle.pos[0].y, 110);
handlers.get("pointerup")({ pointerId: 1 });
assert.equal(state.dragIndex, -1);
assert.equal(state.dragPointerId, null);
assert.equal(elements.get("moves").textContent, "1");
handlers.get("pointerup")({ pointerId: 1 });
assert.equal(state.moves, 1);

handlers.get("pointerdown")({ pointerId: 3, clientX: 300, clientY: 300 });
handlers.get("pointermove")({ pointerId: 3, clientX: 290, clientY: 290 });
handlers.get("pointercancel")({ pointerId: 3 });
assert.equal(state.dragIndex, -1);
assert.equal(state.dragPointerId, null);
assert.equal(state.moves, 2);

handlers.get("pointerdown")({ pointerId: 4, clientX: 110, clientY: 110 });
handlers.get("pointermove")({ pointerId: 4, clientX: 100, clientY: 350 });
assert.equal(state.solved, true);
assert.equal(state.dragIndex, -1);
assert.equal(state.dragPointerId, null);
assert.equal(state.moves, 3);

// Storage restrictions must not prevent startup or in-session sound toggling.
const warnings = [];
const blockedContext = vm.createContext({
  ...context,
  localStorage: {
    getItem() { throw new Error("Storage unavailable"); },
    setItem() { throw new Error("Storage unavailable"); },
  },
  console: { warn: (message) => warnings.push(message) },
});
assert.doesNotThrow(() => vm.runInContext(source, blockedContext));
assert.equal(vm.runInContext("state.puzzle !== null", blockedContext), true);
assert.equal(vm.runInContext("SFX.muted", blockedContext), false);
assert.equal(vm.runInContext("SFX.toggle()", blockedContext), true);
assert.equal(vm.runInContext("SFX.toggle()", blockedContext), false);
assert.equal(warnings.length, 3);
