# Real Estate Contracts

Solidity smart contracts for the decentralized real-estate platform. **Increment 2** ships `PropertyTitle` — an ERC-721 digital title that anchors a verified listing's ownership-document hash on-chain. It is consumed by the [backend](../express-project-template) chain service.

## Stack

- **Hardhat** + TypeScript, **Solidity 0.8.24**, **OpenZeppelin 5** (ERC721 + Ownable), ethers v6 (via `@nomicfoundation/hardhat-toolbox`).

## Contract

`contracts/PropertyTitle.sol`

| Member | Description |
| --- | --- |
| `mintTitle(address to, string listingId, bytes32 documentHash) → uint256` | `onlyOwner`; mints a title and anchors the listing id + document hash |
| `ownerOf(uint256) → address` | ERC-721 owner |
| `documentHashOf(uint256) → bytes32` | Anchored sha-256 document hash |
| `listingIdOf(uint256) → string` | Off-chain listing id |
| `event TitleMinted(uint256 tokenId, address to, string listingId, bytes32 documentHash)` | Emitted on mint |

Minting is custodial (restricted to the deployer / platform minter wallet). A later increment can mint directly to a property owner's wallet.

## Commands

```bash
npm install
npm run compile        # compile contracts (downloads solc 0.8.24 on first run)
npm test               # run the Hardhat test suite
npm run node           # start a local node at http://127.0.0.1:8545
npm run deploy:local   # deploy to the local node, records deployments/localhost.json
npm run export-abi     # write abi/PropertyTitle.json from the compiled artifact
```

## Wiring the backend

After deploying locally:

1. Start a node: `npm run node` (prints funded accounts + private keys).
2. In another shell: `npm run deploy:local` → note the printed address (also in `deployments/localhost.json`).
3. In the backend `.env`:
   ```
   BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
   TITLE_CONTRACT_ADDRESS=<deployed address>
   MINTER_PRIVATE_KEY=<the deployer account's private key from `npm run node`>
   ```
4. The backend's ABI (`src/core/blockchain/propertyTitle.abi.ts`) already matches this contract; `npm run export-abi` produces the equivalent compiled ABI if you prefer to import it directly.

The backend then mints via `POST /api/v1/listings/:id/mint-title` and verifies via `GET /api/v1/listings/:id/title`.

## License

MIT
