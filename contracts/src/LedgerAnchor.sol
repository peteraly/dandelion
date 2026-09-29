// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title LedgerAnchor
/// @notice Records Merkle roots of the pilot's off-chain ledger. Non-upgradeable.
///
/// What an anchor proves: that a set of records existed, in the form committed to
/// by `root`, at the time of the anchoring transaction, and has not changed since.
/// It does NOT prove the underlying events were true. Correctness comes from the
/// backend state machine, database constraints, and monthly reconciliation
/// against the payment provider's statements.
///
/// Roles:
///  - `writer`: the platform backend (a KMS-held key). Only it may anchor.
///  - `admin`: the founders' Safe. Only it may pause/unpause and rotate the writer.
///
/// Replacing this contract means deploying a new one; old anchors stay
/// verifiable at their original address.
contract LedgerAnchor {
    struct Anchor {
        bytes32 root;
        uint64 fromEventId;
        uint64 toEventId;
        uint64 timestamp;
    }

    address public immutable admin;
    address public writer;
    bool public paused;
    Anchor[] public anchors;

    event Anchored(uint256 indexed index, bytes32 root, uint64 fromEventId, uint64 toEventId, uint64 timestamp);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event WriterChanged(address indexed previousWriter, address indexed newWriter);

    error NotWriter();
    error NotAdmin();
    error IsPaused();
    error NotPaused();
    error ZeroAddress();
    error EmptyRoot();
    error BadRange();

    constructor(address admin_, address writer_) {
        if (admin_ == address(0) || writer_ == address(0)) revert ZeroAddress();
        admin = admin_;
        writer = writer_;
    }

    modifier onlyWriter() {
        if (msg.sender != writer) revert NotWriter();
        _;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    /// @notice Anchor a Merkle root covering off-chain ledger events [fromEventId, toEventId].
    function anchor(bytes32 root, uint64 fromEventId, uint64 toEventId) external onlyWriter {
        if (paused) revert IsPaused();
        if (root == bytes32(0)) revert EmptyRoot();
        if (toEventId < fromEventId) revert BadRange();
        uint64 ts = uint64(block.timestamp);
        anchors.push(Anchor({root: root, fromEventId: fromEventId, toEventId: toEventId, timestamp: ts}));
        emit Anchored(anchors.length - 1, root, fromEventId, toEventId, ts);
    }

    function anchorCount() external view returns (uint256) {
        return anchors.length;
    }

    function pause() external onlyAdmin {
        if (paused) revert IsPaused();
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyAdmin {
        if (!paused) revert NotPaused();
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @notice Rotate the backend writer key (e.g. after a KMS key rotation).
    function setWriter(address newWriter) external onlyAdmin {
        if (newWriter == address(0)) revert ZeroAddress();
        emit WriterChanged(writer, newWriter);
        writer = newWriter;
    }
}
