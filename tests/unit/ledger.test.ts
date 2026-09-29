import { describe, expect, it } from "vitest";
import { keccak256, toHex, type Hex } from "viem";
import { canonicalJson, leafHash, newSalt } from "@/lib/ledger/leaf";
import { buildLevels, hashPair, merkleProof, merkleRoot, verifyProof } from "@/lib/ledger/merkle";
import { LEDGER_ANCHOR_ABI } from "@/lib/ledger/abi";

const leaves = (n: number): Hex[] => Array.from({ length: n }, (_, i) => keccak256(toHex(`leaf-${i}`)));

describe("ledger leaves", () => {
  it("canonical JSON has fixed key order and day-granularity dates only", () => {
    const c = canonicalJson({ type: "PAYMENT_CONFIRMED", ref: "OR-1", amountTzs: 8000, role: "BOSS_RIDER", date: "2026-09-29" });
    expect(c).toBe('{"amountTzs":8000,"date":"2026-09-29","ref":"OR-1","role":"BOSS_RIDER","type":"PAYMENT_CONFIRMED","v":1}');
    expect(() => canonicalJson({ type: "PAYMENT_CONFIRMED", ref: "x", amountTzs: null, role: null, date: "2026-09-29T10:00:00Z" })).toThrow();
    expect(() => canonicalJson({ type: "PAYMENT_CONFIRMED", ref: "x", amountTzs: 1.5, role: null, date: "2026-09-29" })).toThrow();
  });

  it("salted leaves hide low-entropy contents", () => {
    const c = canonicalJson({ type: "HANDOVER_COMPLETED", ref: "B-1", amountTzs: null, role: null, date: "2026-09-29" });
    const a = leafHash(c, newSalt());
    const b = leafHash(c, newSalt());
    expect(a).not.toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("merkle tree", () => {
  it("single leaf: root is the leaf, proof is empty", () => {
    const [l] = leaves(1);
    expect(merkleRoot([l!])).toBe(l);
    expect(merkleProof([l!], 0)).toEqual([]);
    expect(verifyProof(l!, [], l!)).toBe(true);
  });

  it.each([2, 3, 5, 8, 13, 64])("every leaf of a %i-leaf tree has a valid proof", (n) => {
    const ls = leaves(n);
    const root = merkleRoot(ls);
    for (let i = 0; i < n; i++) {
      const proof = merkleProof(ls, i);
      expect(verifyProof(ls[i]!, proof, root)).toBe(true);
      // a proof for one leaf never verifies another
      expect(verifyProof(ls[(i + 1) % n]!, proof, root)).toBe(false);
    }
  });

  it("pair hashing is order independent (sorted pairs) and domain separated", () => {
    const [a, b] = leaves(2);
    expect(hashPair(a!, b!)).toBe(hashPair(b!, a!));
    expect(hashPair(a!, b!)).not.toBe(keccak256(toHex(a! + b!.slice(2))));
    expect(buildLevels(leaves(5)).length).toBe(4);
  });

  it("tampering a leaf breaks the proof", () => {
    const ls = leaves(6);
    const root = merkleRoot(ls);
    const proof = merkleProof(ls, 2);
    expect(verifyProof(keccak256(toHex("tampered")), proof, root)).toBe(false);
  });

  it("refuses an empty tree", () => {
    expect(() => merkleRoot([])).toThrow();
  });
});

describe("contract ABI", () => {
  it("matches the LedgerAnchor surface the anchor cron relies on", () => {
    const names = LEDGER_ANCHOR_ABI.filter((x) => x.type === "function").map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(["anchor", "pause", "unpause", "paused", "writer", "admin", "anchorCount", "anchors", "setWriter"]));
    const anchor = LEDGER_ANCHOR_ABI.find((x) => x.type === "function" && x.name === "anchor")!;
    expect(anchor.type === "function" && anchor.inputs.map((i) => i.type)).toEqual(["bytes32", "uint64", "uint64"]);
  });
});
