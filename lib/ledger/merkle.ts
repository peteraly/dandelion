/**
 * Binary Merkle tree over ledger leaves.
 *
 *   node = keccak256(0x01 ‖ min(a,b) ‖ max(a,b))
 *
 * Sorted pairs mean a proof is just a list of sibling hashes (no left/right
 * flags). An odd node at the end of a level is promoted unchanged.
 */
import { concat, keccak256, toHex, type Hex } from "viem";

const NODE_PREFIX = toHex(1, { size: 1 });

export function hashPair(a: Hex, b: Hex): Hex {
  const [x, y] = BigInt(a) <= BigInt(b) ? [a, b] : [b, a];
  return keccak256(concat([NODE_PREFIX, x, y]));
}

export function buildLevels(leaves: readonly Hex[]): Hex[][] {
  if (leaves.length === 0) throw new Error("cannot build a tree with no leaves");
  const levels: Hex[][] = [[...leaves]];
  while (levels[levels.length - 1]!.length > 1) {
    const prev = levels[levels.length - 1]!;
    const next: Hex[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? hashPair(prev[i]!, prev[i + 1]!) : prev[i]!);
    }
    levels.push(next);
  }
  return levels;
}

export function merkleRoot(leaves: readonly Hex[]): Hex {
  const levels = buildLevels(leaves);
  return levels[levels.length - 1]![0]!;
}

export function merkleProof(leaves: readonly Hex[], index: number): Hex[] {
  if (index < 0 || index >= leaves.length) throw new Error("leaf index out of range");
  const levels = buildLevels(leaves);
  const proof: Hex[] = [];
  let i = index;
  for (let l = 0; l < levels.length - 1; l++) {
    const level = levels[l]!;
    const sibling = i % 2 === 0 ? i + 1 : i - 1;
    if (sibling < level.length) proof.push(level[sibling]!);
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyProof(leaf: Hex, proof: readonly Hex[], root: Hex): boolean {
  let h = leaf;
  for (const sib of proof) h = hashPair(h, sib);
  return h.toLowerCase() === root.toLowerCase();
}
