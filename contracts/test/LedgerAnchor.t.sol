// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {LedgerAnchor} from "../src/LedgerAnchor.sol";

contract LedgerAnchorTest is Test {
    LedgerAnchor internal la;
    address internal admin = address(0xA11CE);
    address internal writer = address(0xB0B);
    address internal stranger = address(0xBAD);

    event Anchored(uint256 indexed index, bytes32 root, uint64 fromEventId, uint64 toEventId, uint64 timestamp);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event WriterChanged(address indexed previousWriter, address indexed newWriter);

    function setUp() public {
        la = new LedgerAnchor(admin, writer);
    }

    function test_constructor_rejectsZero() public {
        vm.expectRevert(LedgerAnchor.ZeroAddress.selector);
        new LedgerAnchor(address(0), writer);
        vm.expectRevert(LedgerAnchor.ZeroAddress.selector);
        new LedgerAnchor(admin, address(0));
    }

    function test_writer_canAnchor_andEmits() public {
        bytes32 root = keccak256("root-1");
        vm.warp(1_700_000_000);
        vm.prank(writer);
        vm.expectEmit(true, false, false, true);
        emit Anchored(0, root, 1, 10, uint64(1_700_000_000));
        la.anchor(root, 1, 10);
        assertEq(la.anchorCount(), 1);
        (bytes32 r, uint64 f, uint64 t, uint64 ts) = la.anchors(0);
        assertEq(r, root);
        assertEq(f, 1);
        assertEq(t, 10);
        assertEq(ts, 1_700_000_000);
    }

    function test_nonWriter_cannotAnchor() public {
        vm.prank(stranger);
        vm.expectRevert(LedgerAnchor.NotWriter.selector);
        la.anchor(keccak256("x"), 1, 1);
        vm.prank(admin);
        vm.expectRevert(LedgerAnchor.NotWriter.selector);
        la.anchor(keccak256("x"), 1, 1);
    }

    function test_anchor_rejectsEmptyRootAndBadRange() public {
        vm.startPrank(writer);
        vm.expectRevert(LedgerAnchor.EmptyRoot.selector);
        la.anchor(bytes32(0), 1, 1);
        vm.expectRevert(LedgerAnchor.BadRange.selector);
        la.anchor(keccak256("x"), 5, 4);
        vm.stopPrank();
    }

    function test_pause_blocksAnchoring_andUnpauseRestores() public {
        vm.prank(admin);
        vm.expectEmit(true, false, false, false);
        emit Paused(admin);
        la.pause();
        assertTrue(la.paused());

        vm.prank(writer);
        vm.expectRevert(LedgerAnchor.IsPaused.selector);
        la.anchor(keccak256("x"), 1, 1);

        vm.prank(admin);
        vm.expectRevert(LedgerAnchor.IsPaused.selector);
        la.pause();

        vm.prank(admin);
        vm.expectEmit(true, false, false, false);
        emit Unpaused(admin);
        la.unpause();
        assertFalse(la.paused());

        vm.prank(admin);
        vm.expectRevert(LedgerAnchor.NotPaused.selector);
        la.unpause();

        vm.prank(writer);
        la.anchor(keccak256("x"), 1, 1);
        assertEq(la.anchorCount(), 1);
    }

    function test_onlyAdmin_canPauseOrRotate() public {
        vm.startPrank(writer);
        vm.expectRevert(LedgerAnchor.NotAdmin.selector);
        la.pause();
        vm.expectRevert(LedgerAnchor.NotAdmin.selector);
        la.unpause();
        vm.expectRevert(LedgerAnchor.NotAdmin.selector);
        la.setWriter(stranger);
        vm.stopPrank();
    }

    function test_setWriter_rotates() public {
        address newWriter = address(0xC0FFEE);
        vm.prank(admin);
        vm.expectEmit(true, true, false, false);
        emit WriterChanged(writer, newWriter);
        la.setWriter(newWriter);
        assertEq(la.writer(), newWriter);

        vm.prank(writer);
        vm.expectRevert(LedgerAnchor.NotWriter.selector);
        la.anchor(keccak256("x"), 1, 1);
        vm.prank(newWriter);
        la.anchor(keccak256("x"), 1, 1);

        vm.prank(admin);
        vm.expectRevert(LedgerAnchor.ZeroAddress.selector);
        la.setWriter(address(0));
    }

    function testFuzz_anchor_storesWhatWasGiven(bytes32 root, uint64 from, uint64 span) public {
        vm.assume(root != bytes32(0));
        vm.assume(from <= type(uint64).max - span);
        vm.prank(writer);
        la.anchor(root, from, from + span);
        (bytes32 r, uint64 f, uint64 t,) = la.anchors(0);
        assertEq(r, root);
        assertEq(f, from);
        assertEq(t, from + span);
    }

    function test_anchors_areAppendOnly() public {
        vm.startPrank(writer);
        la.anchor(keccak256("a"), 1, 5);
        la.anchor(keccak256("b"), 6, 9);
        vm.stopPrank();
        (bytes32 r0,,,) = la.anchors(0);
        (bytes32 r1,,,) = la.anchors(1);
        assertEq(r0, keccak256("a"));
        assertEq(r1, keccak256("b"));
        assertEq(la.anchorCount(), 2);
    }
}
