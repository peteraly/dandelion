// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {LedgerAnchor} from "../src/LedgerAnchor.sol";

/// Deploy to the current Celo testnet (verify the network and RPC on docs.celo.org first):
///   ADMIN=0x... WRITER=0x... forge script script/Deploy.s.sol --rpc-url $CHAIN_RPC_URL --broadcast --private-key $DEPLOYER_KEY
/// Then record the address with: npm run ledger:record -- <address> <txHash>
contract Deploy is Script {
    function run() external {
        address admin = vm.envAddress("ADMIN");
        address writer = vm.envAddress("WRITER");
        vm.startBroadcast();
        LedgerAnchor la = new LedgerAnchor(admin, writer);
        vm.stopBroadcast();
        console.log("LedgerAnchor deployed at", address(la));
    }
}
