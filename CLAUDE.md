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
npm run export-abi                           # write abi/{PropertyTitle,LeaseEscrow,MockERC20}.json from compiled artifacts
```

TypeChain types land in `typechain-types/` after compile and are already wired into `tsconfig.json` — import contract types from there in scripts/tests.

## Architecture

Single-contract Hardhat + TypeScript project. The contract is one component of a larger system: this repo is consumed by a separate Express backend (`../express-project-template`) that calls `mintTitle` from a custodial minter wallet after off-chain listing verification.

- **`contracts/PropertyTitle.sol`** — ERC-721 (`PropertyTitle` / `PTITLE`) on OpenZeppelin 5 (`ERC721` + `Ownable` + `AccessControl` + `Pausable`). Each token anchors a verified listing by storing its off-chain `listingId` (string) and the sha-256 `documentHash` (bytes32) of the approved ownership document. `_nextTokenId` starts at 1.
  - **Two-tier access (this pattern is shared with LeaseEscrow):** `Ownable` owner is the administrator (grants/revokes operator roles via `setTitleOperator`, `pause`/`unpause`, `setBaseURI`). `TITLE_OPERATOR_ROLE` does day-to-day work — `mintTitle`, `markDisputed`, `clearDispute`, `revokeTitle` are all `onlyTitleOperator whenNotPaused`, **not** `onlyOwner`. At deploy the deployer holds both `DEFAULT_ADMIN_ROLE` and the operator role, so the single custodial wallet is owner *and* operator until you split them.
  - **Listing dedup:** a `keccak256(listingId) → tokenId` map (`_tokenByListingHash`) makes minting idempotent per listing — a second mint of the same `listingId` reverts with `ListingAlreadyMinted`. Look it up via `tokenIdOfListing`.
  - **Title lifecycle:** `TitleStatus { None, Active, Disputed, Revoked }`. Mint sets `Active`; `markDisputed` (Active→Disputed), `clearDispute` (Disputed→Active), `revokeTitle` (any→Revoked) gate on the current status and revert `InvalidTitleStatus` on illegal transitions. This is status tracking only — it does not block ERC-721 transfers.
  - **Metadata:** off-chain via `setBaseURI` (owner-only) + standard `tokenURI` (`baseURI + tokenId`). Read accessors (`documentHashOf`, `listingIdOf`, `titleStatusOf`) call `_requireOwned` so they revert for non-existent tokens.

- **Deploy → record → consume flow.** `scripts/deploy.ts` deploys all three contracts and writes `deployments/<network>.json` with keys `{ network, address, propertyTitle, leaseEscrow, mockToken, escrowToken }` (`address` equals `propertyTitle` for back-compat; `mockToken` is omitted on mainnet). It also **allowlists the escrow token automatically** by calling `escrow.setTokenAllowed(escrowToken, true)` — `escrowToken` is `process.env.ESCROW_TOKEN_ADDRESS` if set, else the freshly-deployed `mockToken`. On mainnet with no `ESCROW_TOKEN_ADDRESS`, nothing is allowlisted and `openAndFund` will revert until you allowlist a real stablecoin. The backend reads these addresses (or sets them via env vars — see Backend wiring). `npm run export-abi` writes clean ABIs to `abi/PropertyTitle.json`, `abi/LeaseEscrow.json`, and `abi/MockERC20.json`. The backend keeps its own copy of the PropertyTitle ABI at `src/core/blockchain/propertyTitle.abi.ts`; update it by hand or have the backend consume the exported file.

- **`contracts/LeaseEscrow.sol`** — ERC-20 escrow (`LeaseEscrow`) on OpenZeppelin 5 (`Ownable` + `AccessControl` + `Pausable` + `ReentrancyGuard`). Same two-tier access as PropertyTitle: owner administers (`setEscrowOperator`, `setTokenAllowed`, `pause`/`unpause`); `ESCROW_OPERATOR_ROLE` drives the lifecycle. **All fund moves are custodial** — the operator wallet is the `msg.sender` that transfers tokens in (`openAndFund` does `safeTransferFrom(msg.sender, ...)`), so the *operator* must hold and approve the tokens. The tenant pays the platform off-chain; the contract has no tenant-facing `fund` entrypoint.
  - **Lifecycle** `None → Funded → Active → Closed`, one `Escrow` struct per `escrowId` (starts at 1):
    - `openAndFund(leaseId, landlord, tenant, token, rentAmount, depositAmount, termsHash)` → pulls `rent + deposit`, state `Funded`. Reverts unless `token` is on the allowlist.
    - `activate` → releases first month's rent to landlord, state `Active`.
    - `releaseDeposit` (deposit → landlord) / `refundDeposit` (deposit → tenant) → close an Active lease.
    - `cancel` → only while `Funded`, refunds everything to the tenant.
  - **Token allowlist:** `openAndFund` requires `allowedTokens[token]`; set it with `setTokenAllowed` (owner-only). Tokens **must** be standard non-fee-on-transfer, non-rebasing ERC-20s — the contract pays out the stored amounts exactly, so a fee-on-transfer token under-funds the shared balance and later transfers revert. The invariant is that the contract balance always covers all non-Closed obligations.
  - `MockERC20` (`contracts/mocks/MockERC20.sol`) is a minimal faucet token for local/testnet demos only — not deployed on mainnet.

- **EVM target.** Solidity 0.8.24 with `evmVersion: "cancun"` — required because OpenZeppelin 5 emits the `mcopy` opcode. Don't downgrade evmVersion without also pinning OZ to a pre-5 version.

- **Networks.** `hardhat` (in-process, used by `npm test`), `localhost` (external node from `npm run node`), and `sepolia` (gated on env vars; the accounts array is empty if `DEPLOYER_PRIVATE_KEY` is unset, so a missing key produces a confusing "no signers" error rather than a config error).

## Backend wiring (quick reference)

1. `npm run node` — prints funded accounts + private keys.
2. `npm run deploy:local` — note the addresses (also in `deployments/localhost.json`).
3. Backend `.env`:
   ```
   BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
   MINTER_PRIVATE_KEY=<deployer key from step 1>
   TITLE_CONTRACT_ADDRESS=<propertyTitle address>
   ESCROW_CONTRACT_ADDRESS=<leaseEscrow address>
   ESCROW_TOKEN_ADDRESS=<mockToken address for local/testnet; real stablecoin on mainnet>
   ```
   `BLOCKCHAIN_RPC_URL` and `MINTER_PRIVATE_KEY` are shared by both contracts — the deployer wallet is owner of both.
4. Backend endpoints: `POST /api/v1/listings/:id/mint-title`, `GET /api/v1/listings/:id/title`.
