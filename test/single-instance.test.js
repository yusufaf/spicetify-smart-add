const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "smart-add.js"), "utf8");

// Marketplace and the Extensions folder can both load the file into the same window.
test("a second copy in the same window skips itself", () => {
  const info = [];
  const noop = () => {};
  const context = {
    console: { log: noop, warn: noop, error: noop, info: (msg) => info.push(msg) },
    setTimeout: noop,
    clearTimeout: noop,
    setInterval: noop,
    clearInterval: noop,
    Spicetify: {},
    document: {},
    navigator: {},
  };
  context.window = context;
  vm.createContext(context);

  vm.runInContext(source, context);
  assert.equal(context.__smartAddActive, true);
  assert.equal(info.length, 0);

  vm.runInContext(source, context);
  assert.equal(info.length, 1);
  assert.match(info[0], /Another copy is already running/);
});
