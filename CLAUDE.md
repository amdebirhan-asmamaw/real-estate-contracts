# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run compile                              # hardhat compile (solc 0.8.24, Cancun EVM)
npm test                                     # full hardhat test suite (in-process `hardhat` network)
npx hardhat test test/PropertyTitle.test.ts  # run a single test file
npx hardhat test --grep "mintTitle"          # run tests matching a name
npm run node                                 # local JSON-RPC node at http://127.0.0.1:8545
npm run deploy:local                         # deploy to localhost, writes deployments/<network>.json
npm run deploy:sepolia                       # requires SEPOLIA_RPC_URL + DEPLOYER_PRIVATE_KEY in .env
npm run export-abi                           # write abi/PropertyTitle.json from compiled artifact
```

TypeChain types land in `typechain-types/` after compile and are already wired into `tsconfig.json` — import contract types from there in scripts/tests.

## Architecture

Single-contract Hardhat + TypeScript project. The contract is one component of a larger system: this repo is consumed by a separate Express backend (`../express-project-template`) that calls `mintTitle` from a custodial minter wallet after off-chain listing verification.

- **`contracts/PropertyTitle.sol`** — ERC-721 (`PropertyTitle` / `PTITLE`) built on OpenZeppelin 5 (`ERC721` + `Ownable`). Each token anchors a verified listing by storing its off-chain `listingId` (string) and the sha-256 `documentHash` (bytes32) of the approved ownership document. `mintTitle` is `onlyOwner` — minting is custodial in this increment; a later increment is planned to mint directly to property-owner wallets. `_nextTokenId` starts at 1. Read accessors (`documentHashOf`, `listingIdOf`) call `_requireOwned` so they revert for non-existent tokens.

- **Deploy → record → consume flow.** `scripts/deploy.ts` deploys and writes `deployments/<network>.json` (just `{ address, network }`). The backend reads that address (or it's set as `TITLE_CONTRACT_ADDRESS` in the backend's `.env`) together with `BLOCKCHAIN_RPC_URL` and `MINTER_PRIVATE_KEY` (the deployer key — owner of the contract). The backend keeps its own copy of the ABI at `src/core/blockchain/propertyTitle.abi.ts`; if you change the contract's external surface, either update that file by hand or have the backend consume `abi/PropertyTitle.json` produced by `npm run export-abi`.

- **EVM target.** Solidity 0.8.24 with `evmVersion: "cancun"` — required because OpenZeppelin 5 emits the `mcopy` opcode. Don't downgrade evmVersion without also pinning OZ to a pre-5 version.

- **Networks.** `hardhat` (in-process, used by `npm test`), `localhost` (external node from `npm run node`), and `sepolia` (gated on env vars; the accounts array is empty if `DEPLOYER_PRIVATE_KEY` is unset, so a missing key produces a confusing "no signers" error rather than a config error).

## Backend wiring (quick reference)

1. `npm run node` — prints funded accounts + private keys.
2. `npm run deploy:local` — note the address (also in `deployments/localhost.json`).
3. Backend `.env`: `BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545`, `TITLE_CONTRACT_ADDRESS=<address>`, `MINTER_PRIVATE_KEY=<deployer key from step 1>`.
4. Backend endpoints: `POST /api/v1/listings/:id/mint-title`, `GET /api/v1/listings/:id/title`.
