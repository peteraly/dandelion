/** ABI of contracts/src/LedgerAnchor.sol (checked by tests/unit/ledger.test.ts and the anvil integration test). */
export const LEDGER_ANCHOR_ABI = [
  {
    type: "constructor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "admin_", type: "address" },
      { name: "writer_", type: "address" },
    ],
  },
  {
    type: "function",
    name: "anchor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "root", type: "bytes32" },
      { name: "fromEventId", type: "uint64" },
      { name: "toEventId", type: "uint64" },
    ],
    outputs: [],
  },
  { type: "function", name: "pause", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "unpause", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "writer", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "admin", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "anchorCount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  {
    type: "function",
    name: "anchors",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "root", type: "bytes32" },
      { name: "fromEventId", type: "uint64" },
      { name: "toEventId", type: "uint64" },
      { name: "timestamp", type: "uint64" },
    ],
  },
  { type: "function", name: "setWriter", stateMutability: "nonpayable", inputs: [{ name: "newWriter", type: "address" }], outputs: [] },
  {
    type: "event",
    name: "Anchored",
    inputs: [
      { name: "index", type: "uint256", indexed: true },
      { name: "root", type: "bytes32", indexed: false },
      { name: "fromEventId", type: "uint64", indexed: false },
      { name: "toEventId", type: "uint64", indexed: false },
      { name: "timestamp", type: "uint64", indexed: false },
    ],
    anonymous: false,
  },
  { type: "event", name: "Paused", inputs: [{ name: "by", type: "address", indexed: true }], anonymous: false },
  { type: "event", name: "Unpaused", inputs: [{ name: "by", type: "address", indexed: true }], anonymous: false },
  {
    type: "event",
    name: "WriterChanged",
    inputs: [
      { name: "previousWriter", type: "address", indexed: true },
      { name: "newWriter", type: "address", indexed: true },
    ],
    anonymous: false,
  },
] as const;
