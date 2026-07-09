/**
 * Integration tests for Solidity parsing via tree-sitter-solidity.
 *
 * These tests require the tree-sitter-solidity WASM grammar to be installed.
 * They verify that parseCode extracts the correct symbol hierarchy from .sol files.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { parseCode } from "./manager.js";
import type { SymbolInfo } from "../types.js";

/** Sample Solidity contract exercising all major constructs. */
const SAMPLE_CONTRACT = `
pragma solidity ^0.8.20;

interface IDeFi {
    function deposit() external payable;
}

abstract contract Base {
    event Initialized(uint version);
    error Unauthorized(address caller);

    modifier onlyOwner() {
        _;
    }

    function baseFn() public virtual returns (uint) { }
}

contract MyContract is Base, IDeFi {
    enum State { Active, Paused }

    struct Config {
        uint256 limit;
        address admin;
    }

    State public state;
    Config public config;

    constructor(address _admin) onlyOwner { }

    function deposit() public payable override { }

    function setState(State _s) external { }

    fallback() external payable { }
    receive() external payable { }
}

library SafeMath {
    function add(uint a, uint b) internal pure returns (uint) { return a + b; }
}

function helper() pure { }
`;

/** Run parseCode and return top-level symbols keyed by name for assertions. */
function indexByName(symbols: SymbolInfo[]): Map<string, SymbolInfo> {
  const map = new Map<string, SymbolInfo>();
  for (const s of symbols) {
    map.set(s.name, s);
  }
  return map;
}

describe("Solidity parser integration", () => {
  let symbols: SymbolInfo[];

  before(async () => {
    symbols = await parseCode("solidity", SAMPLE_CONTRACT);
  });

  it("parses all top-level symbols", () => {
    const byName = indexByName(symbols);

    // Container declarations
    assert.ok(byName.has("IDeFi"), "interface IDeFi not found");
    assert.ok(byName.has("Base"), "contract Base not found");
    assert.ok(byName.has("MyContract"), "contract MyContract not found");
    assert.ok(byName.has("SafeMath"), "library SafeMath not found");
    assert.ok(byName.has("helper"), "file-level function helper not found");
  });

  it("assigns correct types to top-level symbols", () => {
    const byName = indexByName(symbols);

    assert.equal(byName.get("IDeFi")?.type, "interface");
    assert.equal(byName.get("Base")?.type, "contract");
    assert.equal(byName.get("MyContract")?.type, "contract");
    assert.equal(byName.get("SafeMath")?.type, "library");
    assert.equal(byName.get("helper")?.type, "function");
  });

  it("includes inheritance detail on contracts", () => {
    const myContract = indexByName(symbols).get("MyContract")!;
    assert.ok(
      myContract.detail?.includes("Base"),
      `Expected inheritance detail to mention Base, got: ${myContract.detail}`,
    );
    assert.ok(
      myContract.detail?.includes("IDeFi"),
      `Expected inheritance detail to mention IDeFi, got: ${myContract.detail}`,
    );
  });

  it("extracts contract body children (functions, events, modifiers, errors, etc.)", () => {
    const base = indexByName(symbols).get("Base")!;
    assert.ok(base.children, "Base should have children");
    const baseChildren = indexByName(base.children);

    assert.ok(baseChildren.has("onlyOwner"), "modifier onlyOwner not found");
    assert.equal(baseChildren.get("onlyOwner")?.type, "modifier");

    assert.ok(baseChildren.has("Initialized"), "event Initialized not found");
    assert.equal(baseChildren.get("Initialized")?.type, "event");

    assert.ok(baseChildren.has("Unauthorized"), "error Unauthorized not found");
    assert.equal(baseChildren.get("Unauthorized")?.type, "error");

    assert.ok(baseChildren.has("baseFn"), "function baseFn not found");
    assert.equal(baseChildren.get("baseFn")?.type, "function");
  });

  it("extracts enum with values inside contracts", () => {
    const myContract = indexByName(symbols).get("MyContract")!;
    assert.ok(myContract.children, "MyContract should have children");

    const stateSymbol = myContract.children.find(
      (c) => c.name === "State" && c.type === "enum",
    );
    assert.ok(stateSymbol, "enum State not found in MyContract");
    assert.ok(stateSymbol!.children, "State enum should have children");
    assert.equal(stateSymbol!.children!.length, 2, "State should have 2 enum values");

    const valueNames = stateSymbol!.children!.map((c) => c.name);
    assert.ok(valueNames.includes("Active"), "enum value Active missing");
    assert.ok(valueNames.includes("Paused"), "enum value Paused missing");
  });

  it("extracts struct with members inside contracts", () => {
    const myContract = indexByName(symbols).get("MyContract")!;
    const configSymbol = myContract.children!.find(
      (c) => c.name === "Config" && c.type === "struct",
    );
    assert.ok(configSymbol, "struct Config not found in MyContract");
    assert.ok(configSymbol!.children, "Config struct should have children");
    assert.equal(configSymbol!.children!.length, 2, "Config should have 2 fields");

    const fieldNames = configSymbol!.children!.map((c) => c.name);
    assert.ok(fieldNames.includes("limit"), "struct field limit missing");
    assert.ok(fieldNames.includes("admin"), "struct field admin missing");
  });

  it("extracts state variables inside contracts", () => {
    const myContract = indexByName(symbols).get("MyContract")!;
    const stateVar = myContract.children!.find(
      (c) => c.name === "state" && c.type === "variable",
    );
    assert.ok(stateVar, "state variable 'state' not found");
    assert.ok(stateVar!.detail?.includes("State"), "state variable type missing");

    const configVar = myContract.children!.find(
      (c) => c.name === "config" && c.type === "variable",
    );
    assert.ok(configVar, "state variable 'config' not found");
  });

  it("extracts constructor inside contracts", () => {
    const myContract = indexByName(symbols).get("MyContract")!;
    const ctor = myContract.children!.find(
      (c) => c.type === "constructor",
    );
    assert.ok(ctor, "constructor not found in MyContract");
    assert.ok(ctor!.detail?.includes("_admin"), "constructor parameter missing");
  });

  it("extracts fallback and receive", () => {
    const myContract = indexByName(symbols).get("MyContract")!;
    const fallback = myContract.children!.find(
      (c) => c.type === "fallback",
    );
    assert.ok(fallback, "fallback not found");

    const receive = myContract.children!.find(
      (c) => c.type === "receive",
    );
    assert.ok(receive, "receive not found");
  });

  it("extracts library with functions", () => {
    const safeMath = indexByName(symbols).get("SafeMath")!;
    assert.ok(safeMath.children, "SafeMath should have children");
    const addFn = safeMath.children.find((c) => c.name === "add");
    assert.ok(addFn, "library function add not found");
    assert.equal(addFn!.type, "function");
  });
});
