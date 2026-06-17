# Smart Contract Deployment Guide

Complete step-by-step guide to deploy the Real Estate smart contracts (`PropertyTitle`, `LeaseEscrow`, `MockERC20`) to local, testnet, and mainnet environments.

---

## Contracts Overview

| Contract | Type | Purpose |
|---|---|---|
| **PropertyTitle** | ERC-721 + AccessControl + Pausable | Digital title certificates for verified properties |
| **LeaseEscrow** | AccessControl + Pausable + ReentrancyGuard | Holds lease deposits in ERC-20 stablecoins |
| **MockERC20** | ERC-20 (test only) | Fake stablecoin for local/testnet escrow testing |

---

## Prerequisites

### Tools Required

```bash
node --version   # >= 20.x
npm --version    # >= 9.x
```

### Install Dependencies

```bash
cd d:\PROJECTS\real-estate-contracts
npm install
```

### Compile Contracts

```bash
npm run compile
```

This generates:
- `artifacts/` — full build artifacts
- `typechain-types/` — TypeScript bindings

---

## Option A: Local Deployment (Hardhat Node)

Best for development and testing. No real ETH needed.

### Step 1 — Start the Local Blockchain

Open a **dedicated terminal** and keep it running:

```bash
npm run node
```

This starts a local Hardhat node at `http://127.0.0.1:8545` with 20 pre-funded accounts.

> The first account (`0xf39Fd6...`) is used as the deployer by default.

### Step 2 — Deploy

In a **second terminal**:

```bash
npm run deploy:local
```

Expected output:

```
PropertyTitle deployed to 0x5FbDB2315678afecb367f032d93F642f64180aa3 on "localhost"
MockERC20 deployed to 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0 on "localhost"
LeaseEscrow deployed to 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 on "localhost"
LeaseEscrow allowlisted token 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
```

### Step 3 — Export ABIs

```bash
npm run export-abi
```

This creates clean ABI files in `abi/`:
- `abi/PropertyTitle.json`
- `abi/LeaseEscrow.json`
- `abi/MockERC20.json`

### Step 4 — Record Addresses

Deployment addresses are auto-saved to:

```
deployments/localhost.json
```

```json
{
  "network": "localhost",
  "propertyTitle": "0x5FbDB...",
  "leaseEscrow": "0xe7f17...",
  "mockToken": "0x9fE46...",
  "escrowToken": "0x9fE46..."
}
```

### Step 5 — Configure the Backend

Update `real-estate-backend/.env` with the deployed addresses:

```env
BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
TITLE_CONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
MINTER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ESCROW_CONTRACT_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
ESCROW_TOKEN_ADDRESS=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
```

> The `MINTER_PRIVATE_KEY` above is Hardhat's default Account #0. **Never use this key on mainnet.**

---

## Option B: Sepolia Testnet Deployment

Real blockchain, test ETH. Good for staging and integration testing.

### Step 1 — Get a Sepolia RPC URL

Sign up for a free account at one of these providers:

| Provider | URL |
|---|---|
| [Alchemy](https://www.alchemy.com/) | `https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY` |
| [Infura](https://www.infura.io/) | `https://sepolia.infura.io/v3/YOUR_KEY` |
| [QuickNode](https://www.quicknode.com/) | Custom endpoint |

### Step 2 — Create a Deployer Wallet

1. Install [MetaMask](https://metamask.io/) or use any Ethereum wallet
2. Create a **new wallet** dedicated for deployment (do NOT use your personal wallet)
3. Export the private key

> **Security**: This wallet will become the contract **owner** and **default admin**. Keep its private key secure.

### Step 3 — Fund the Wallet with Sepolia ETH

Get free testnet ETH from a faucet:

| Faucet | URL |
|---|---|
| Alchemy Sepolia | https://sepoliafaucet.com/ |
| Google Cloud Sepolia | https://cloud.google.com/application/web3/faucet/ethereum/sepolia |

You need approximately **0.05 ETH** for all three contract deployments.

### Step 4 — Configure Environment

Create or update `.env` in the contracts project:

```env
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
DEPLOYER_PRIVATE_KEY=0xYOUR_DEPLOYER_PRIVATE_KEY_HERE
```

> **Never commit `.env` to git.** It's already in `.gitignore`.

### Step 5 — Deploy

```bash
npm run deploy:sepolia
```

Expected output:

```
PropertyTitle deployed to 0x1234...abcd on "sepolia"
MockERC20 deployed to 0x5678...efgh on "sepolia"
LeaseEscrow deployed to 0x9abc...ijkl on "sepolia"
LeaseEscrow allowlisted token 0x5678...efgh
```

Deployment record saved to `deployments/sepolia.json`.

### Step 6 — Verify on Etherscan (Optional but Recommended)

```bash
npx hardhat verify --network sepolia <PROPERTY_TITLE_ADDRESS>
npx hardhat verify --network sepolia <LEASE_ESCROW_ADDRESS>
```

This publishes the source code on [Sepolia Etherscan](https://sepolia.etherscan.io/) for transparency.

### Step 7 — Configure the Backend

Update `real-estate-backend/.env`:

```env
BLOCKCHAIN_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
TITLE_CONTRACT_ADDRESS=<PropertyTitle address from Step 5>
MINTER_PRIVATE_KEY=<Same deployer private key>
ESCROW_CONTRACT_ADDRESS=<LeaseEscrow address from Step 5>
ESCROW_TOKEN_ADDRESS=<MockERC20 address from Step 5>
```

---

## Post-Deployment: Grant Roles

The deployer wallet is automatically assigned `DEFAULT_ADMIN_ROLE` and `TITLE_OPERATOR_ROLE` on `PropertyTitle`, and `ESCROW_OPERATOR_ROLE` on `LeaseEscrow`.

If the backend uses a **different** wallet (recommended for production), grant it the operator role:

### Using Hardhat Console

```bash
npx hardhat console --network <network>
```

```js
const title = await ethers.getContractAt("PropertyTitle", "<TITLE_CONTRACT_ADDRESS>");
const OPERATOR_ROLE = await title.TITLE_OPERATOR_ROLE();
await title.grantRole(OPERATOR_ROLE, "<BACKEND_WALLET_ADDRESS>");

const escrow = await ethers.getContractAt("LeaseEscrow", "<ESCROW_CONTRACT_ADDRESS>");
const ESCROW_ROLE = await escrow.ESCROW_OPERATOR_ROLE();
await escrow.grantRole(ESCROW_ROLE, "<BACKEND_WALLET_ADDRESS>");
```

---

## Backend Environment Variable Reference

| Variable | Description | Example |
|---|---|---|
| `BLOCKCHAIN_RPC_URL` | JSON-RPC endpoint for the target chain | `http://127.0.0.1:8545` |
| `TITLE_CONTRACT_ADDRESS` | Deployed PropertyTitle contract address | `0x5FbDB...` |
| `MINTER_PRIVATE_KEY` | Private key of the wallet with `TITLE_OPERATOR_ROLE` | `0xac097...` |
| `ESCROW_CONTRACT_ADDRESS` | Deployed LeaseEscrow contract address | `0xe7f17...` |
| `ESCROW_TOKEN_ADDRESS` | ERC-20 token approved for escrow payments | `0x9fE46...` |

---

## Quick Reference Commands

| Command | Description |
|---|---|
| `npm run compile` | Compile all Solidity contracts |
| `npm test` | Run contract test suite |
| `npm run node` | Start local Hardhat blockchain |
| `npm run deploy:local` | Deploy to local Hardhat node |
| `npm run deploy:sepolia` | Deploy to Sepolia testnet |
| `npm run export-abi` | Export clean ABIs to `abi/` directory |

---

## Troubleshooting

### "ProviderError: insufficient funds"
→ Your deployer wallet doesn't have enough ETH. Fund it from a faucet (testnet) or transfer ETH (mainnet).

### "Error: missing revert data in call"
→ Contract constructor failed. Ensure Solidity version and EVM version (`cancun`) are compatible with the target network.

### "Nonce too high"
→ Reset MetaMask nonce: Settings → Advanced → Clear activity tab data. Or use `--reset` flag.

### Local node resets on restart
→ The Hardhat node is ephemeral. You must redeploy every time you restart `npm run node`. Addresses will be the same if no other transactions were made.

### Backend can't connect to local node
→ Ensure `npm run node` is running in a separate terminal and `BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545` is set.
