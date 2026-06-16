# Lease Escrow & Lease Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-chain ERC-20 escrow that holds a lease's security deposit + first month's rent, plus a backend-owned lease lifecycle that drives it (fund → activate → settle), with admin-decided dispute resolution.

**Architecture:** A new `LeaseEscrow` Solidity contract (custodial, `onlyOwner`, mirroring `PropertyTitle`'s trust model) holds an ERC-20 stablecoin. First month's rent is released to the landlord on activation; the deposit is held and settled (to landlord or tenant) at lease end. The backend gains a `leases` module that owns the lease state machine and calls a new `leaseEscrow.service.ts` to move funds. A `MockERC20` enables local/Sepolia/test funding.

**Tech Stack:** Solidity 0.8.24 (Cancun), OpenZeppelin 5 (`Ownable`, `SafeERC20`, `ReentrancyGuard`), Hardhat + ethers v6 + Chai (contracts); Express + Mongoose + ethers v6 + Jest (backend).

**Design doc:** `docs/plans/2026-06-16-lease-escrow-design.md` (in the contracts repo).

**Two phases:** Phase 1 (Tasks 1–6) lives in `real-estate-contracts` and is independently testable. Phase 2 (Tasks 7–14) lives in `real-estate-backend` and depends on the deployed address + exported ABI from Phase 1.

---

## PHASE 1 — Contracts (`d:\PROJECTS\real-estate-contracts`)

### Task 1: MockERC20 test token

**Files:**
- Create: `contracts/mocks/MockERC20.sol`

- [ ] **Step 1: Write the contract**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20
/// @notice Minimal mintable stablecoin stand-in for local/testnet/test runs.
///         Never deploy to mainnet. Public `mint` is intentional (faucet).
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock USD", "mUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

- [ ] **Step 2: Compile to verify it builds**

Run: `npm run compile`
Expected: "Compiled N Solidity files successfully" (no errors).

- [ ] **Step 3: Commit**

```bash
git add contracts/mocks/MockERC20.sol
git commit -m "feat(contracts): add MockERC20 faucet token for escrow tests"
```

---

### Task 2: LeaseEscrow — funding (write failing test first)

**Files:**
- Create: `contracts/LeaseEscrow.sol`
- Test: `test/LeaseEscrow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/LeaseEscrow.test.ts`:

```typescript
import { expect } from "chai";
import { ethers } from "hardhat";

const RENT = ethers.parseUnits("1000", 18);
const DEPOSIT = ethers.parseUnits("1500", 18);
const TERMS_HASH =
  "0x" + "ab".repeat(32); // 32-byte sha256 placeholder

async function deploy() {
  const [owner, landlord, tenant, stranger] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("MockERC20");
  const token = await Token.deploy();
  await token.waitForDeployment();

  const Escrow = await ethers.getContractFactory("LeaseEscrow");
  const escrow = await Escrow.deploy();
  await escrow.waitForDeployment();

  // Fund the custodial owner and approve the escrow to pull the total.
  await token.mint(owner.address, RENT + DEPOSIT);
  await token.connect(owner).approve(await escrow.getAddress(), RENT + DEPOSIT);

  return { escrow, token, owner, landlord, tenant, stranger };
}

describe("LeaseEscrow", () => {
  it("funds an escrow, pulling rent + deposit and emitting EscrowFunded", async () => {
    const { escrow, token, owner, landlord, tenant } = await deploy();
    const escrowAddr = await escrow.getAddress();

    await expect(
      escrow
        .connect(owner)
        .openAndFund(
          "lease-1",
          landlord.address,
          tenant.address,
          await token.getAddress(),
          RENT,
          DEPOSIT,
          TERMS_HASH,
        ),
    )
      .to.emit(escrow, "EscrowFunded")
      .withArgs(1n, "lease-1", landlord.address, tenant.address, RENT, DEPOSIT);

    expect(await token.balanceOf(escrowAddr)).to.equal(RENT + DEPOSIT);

    const e = await escrow.getEscrow(1);
    expect(e.leaseId).to.equal("lease-1");
    expect(e.rentAmount).to.equal(RENT);
    expect(e.depositAmount).to.equal(DEPOSIT);
    expect(e.state).to.equal(1n); // Funded
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx hardhat test test/LeaseEscrow.test.ts`
Expected: FAIL — `HardhatError: ... artifact for contract "LeaseEscrow" ... not found` (contract not written yet).

- [ ] **Step 3: Write the minimal contract**

Create `contracts/LeaseEscrow.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title LeaseEscrow
/// @notice Holds a lease's first month's rent + security deposit in an ERC-20
///         stablecoin. First month is released to the landlord on activation;
///         the deposit is held and settled (to landlord or tenant) at lease end.
///         Custodial: only the platform owner moves funds, mirroring
///         PropertyTitle's trust model. The tenant pays the platform off-chain;
///         the owner funds the on-chain escrow.
contract LeaseEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        None,
        Funded,
        Active,
        Closed
    }

    struct Escrow {
        string leaseId;
        address landlord;
        address tenant;
        address token;
        uint256 rentAmount;
        uint256 depositAmount;
        bytes32 termsHash;
        State state;
    }

    uint256 private _nextEscrowId = 1;
    mapping(uint256 => Escrow) private _escrows;

    event EscrowFunded(
        uint256 indexed escrowId,
        string leaseId,
        address indexed landlord,
        address indexed tenant,
        uint256 rentAmount,
        uint256 depositAmount
    );
    event RentReleased(uint256 indexed escrowId, address indexed landlord, uint256 amount);
    event EscrowRefunded(uint256 indexed escrowId, address indexed tenant, uint256 amount);
    event DepositReleased(uint256 indexed escrowId, address indexed landlord, uint256 amount);
    event DepositRefunded(uint256 indexed escrowId, address indexed tenant, uint256 amount);

    constructor() Ownable(msg.sender) {}

    /// @notice Creates and funds an escrow, pulling rent + deposit from the owner.
    /// @dev Owner must have approved this contract for `rentAmount + depositAmount`.
    function openAndFund(
        string calldata leaseId,
        address landlord,
        address tenant,
        address token,
        uint256 rentAmount,
        uint256 depositAmount,
        bytes32 termsHash
    ) external onlyOwner nonReentrant returns (uint256 escrowId) {
        require(landlord != address(0) && tenant != address(0), "zero party");
        require(token != address(0), "zero token");

        escrowId = _nextEscrowId++;
        _escrows[escrowId] = Escrow({
            leaseId: leaseId,
            landlord: landlord,
            tenant: tenant,
            token: token,
            rentAmount: rentAmount,
            depositAmount: depositAmount,
            termsHash: termsHash,
            state: State.Funded
        });

        IERC20(token).safeTransferFrom(msg.sender, address(this), rentAmount + depositAmount);

        emit EscrowFunded(escrowId, leaseId, landlord, tenant, rentAmount, depositAmount);
    }

    function getEscrow(uint256 escrowId) external view returns (Escrow memory) {
        Escrow memory e = _escrows[escrowId];
        require(e.state != State.None, "no escrow");
        return e;
    }

    function escrowState(uint256 escrowId) external view returns (State) {
        require(_escrows[escrowId].state != State.None, "no escrow");
        return _escrows[escrowId].state;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx hardhat test test/LeaseEscrow.test.ts`
Expected: PASS (1 passing).

- [ ] **Step 5: Commit**

```bash
git add contracts/LeaseEscrow.sol test/LeaseEscrow.test.ts
git commit -m "feat(contracts): add LeaseEscrow with openAndFund"
```

---

### Task 3: LeaseEscrow — activate (release first month to landlord)

**Files:**
- Modify: `contracts/LeaseEscrow.sol`
- Test: `test/LeaseEscrow.test.ts`

- [ ] **Step 1: Write the failing test** (append inside the `describe` block)

```typescript
  it("activate releases first month's rent to the landlord and keeps the deposit", async () => {
    const { escrow, token, owner, landlord, tenant } = await deploy();
    const escrowAddr = await escrow.getAddress();
    await escrow
      .connect(owner)
      .openAndFund("lease-1", landlord.address, tenant.address, await token.getAddress(), RENT, DEPOSIT, TERMS_HASH);

    await expect(escrow.connect(owner).activate(1))
      .to.emit(escrow, "RentReleased")
      .withArgs(1n, landlord.address, RENT);

    expect(await token.balanceOf(landlord.address)).to.equal(RENT);
    expect(await token.balanceOf(escrowAddr)).to.equal(DEPOSIT);
    expect(await escrow.escrowState(1)).to.equal(2n); // Active
  });

  it("activate reverts unless state is Funded", async () => {
    const { escrow, token, owner, landlord, tenant } = await deploy();
    await escrow
      .connect(owner)
      .openAndFund("lease-1", landlord.address, tenant.address, await token.getAddress(), RENT, DEPOSIT, TERMS_HASH);
    await escrow.connect(owner).activate(1);
    await expect(escrow.connect(owner).activate(1)).to.be.revertedWith("not funded");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx hardhat test test/LeaseEscrow.test.ts`
Expected: FAIL — `escrow.activate is not a function`.

- [ ] **Step 3: Add `activate` to the contract** (insert after `openAndFund`)

```solidity
    /// @notice Releases the first month's rent to the landlord; deposit stays held.
    function activate(uint256 escrowId) external onlyOwner nonReentrant {
        Escrow storage e = _escrows[escrowId];
        require(e.state == State.Funded, "not funded");
        e.state = State.Active;
        IERC20(e.token).safeTransfer(e.landlord, e.rentAmount);
        emit RentReleased(escrowId, e.landlord, e.rentAmount);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx hardhat test test/LeaseEscrow.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add contracts/LeaseEscrow.sol test/LeaseEscrow.test.ts
git commit -m "feat(contracts): release first month rent on activate"
```

---

### Task 4: LeaseEscrow — cancel (pre-activation full refund)

**Files:**
- Modify: `contracts/LeaseEscrow.sol`
- Test: `test/LeaseEscrow.test.ts`

- [ ] **Step 1: Write the failing test** (append inside the `describe` block)

```typescript
  it("cancel refunds rent + deposit to the tenant before activation", async () => {
    const { escrow, token, owner, landlord, tenant } = await deploy();
    const escrowAddr = await escrow.getAddress();
    await escrow
      .connect(owner)
      .openAndFund("lease-1", landlord.address, tenant.address, await token.getAddress(), RENT, DEPOSIT, TERMS_HASH);

    await expect(escrow.connect(owner).cancel(1))
      .to.emit(escrow, "EscrowRefunded")
      .withArgs(1n, tenant.address, RENT + DEPOSIT);

    expect(await token.balanceOf(tenant.address)).to.equal(RENT + DEPOSIT);
    expect(await token.balanceOf(escrowAddr)).to.equal(0n);
    expect(await escrow.escrowState(1)).to.equal(3n); // Closed
  });

  it("cancel reverts after activation", async () => {
    const { escrow, token, owner, landlord, tenant } = await deploy();
    await escrow
      .connect(owner)
      .openAndFund("lease-1", landlord.address, tenant.address, await token.getAddress(), RENT, DEPOSIT, TERMS_HASH);
    await escrow.connect(owner).activate(1);
    await expect(escrow.connect(owner).cancel(1)).to.be.revertedWith("not funded");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx hardhat test test/LeaseEscrow.test.ts`
Expected: FAIL — `escrow.cancel is not a function`.

- [ ] **Step 3: Add `cancel` to the contract** (insert after `activate`)

```solidity
    /// @notice Pre-activation cancellation: refunds rent + deposit to the tenant.
    function cancel(uint256 escrowId) external onlyOwner nonReentrant {
        Escrow storage e = _escrows[escrowId];
        require(e.state == State.Funded, "not funded");
        e.state = State.Closed;
        IERC20(e.token).safeTransfer(e.tenant, e.rentAmount + e.depositAmount);
        emit EscrowRefunded(escrowId, e.tenant, e.rentAmount + e.depositAmount);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx hardhat test test/LeaseEscrow.test.ts`
Expected: PASS (5 passing).

- [ ] **Step 5: Commit**

```bash
git add contracts/LeaseEscrow.sol test/LeaseEscrow.test.ts
git commit -m "feat(contracts): pre-activation cancel refunds tenant"
```

---

### Task 5: LeaseEscrow — deposit settlement + access control + unknown-id

**Files:**
- Modify: `contracts/LeaseEscrow.sol`
- Test: `test/LeaseEscrow.test.ts`

- [ ] **Step 1: Write the failing tests** (append inside the `describe` block)

```typescript
  it("releaseDeposit sends the held deposit to the landlord (Active -> Closed)", async () => {
    const { escrow, token, owner, landlord, tenant } = await deploy();
    await escrow
      .connect(owner)
      .openAndFund("lease-1", landlord.address, tenant.address, await token.getAddress(), RENT, DEPOSIT, TERMS_HASH);
    await escrow.connect(owner).activate(1);

    await expect(escrow.connect(owner).releaseDeposit(1))
      .to.emit(escrow, "DepositReleased")
      .withArgs(1n, landlord.address, DEPOSIT);

    expect(await token.balanceOf(landlord.address)).to.equal(RENT + DEPOSIT);
    expect(await escrow.escrowState(1)).to.equal(3n); // Closed
  });

  it("refundDeposit returns the held deposit to the tenant (Active -> Closed)", async () => {
    const { escrow, token, owner, landlord, tenant } = await deploy();
    await escrow
      .connect(owner)
      .openAndFund("lease-1", landlord.address, tenant.address, await token.getAddress(), RENT, DEPOSIT, TERMS_HASH);
    await escrow.connect(owner).activate(1);

    await expect(escrow.connect(owner).refundDeposit(1))
      .to.emit(escrow, "DepositRefunded")
      .withArgs(1n, tenant.address, DEPOSIT);

    expect(await token.balanceOf(tenant.address)).to.equal(DEPOSIT);
    expect(await token.balanceOf(landlord.address)).to.equal(RENT);
  });

  it("deposit settlement reverts unless state is Active", async () => {
    const { escrow, token, owner, landlord, tenant } = await deploy();
    await escrow
      .connect(owner)
      .openAndFund("lease-1", landlord.address, tenant.address, await token.getAddress(), RENT, DEPOSIT, TERMS_HASH);
    await expect(escrow.connect(owner).releaseDeposit(1)).to.be.revertedWith("not active");
    await expect(escrow.connect(owner).refundDeposit(1)).to.be.revertedWith("not active");
  });

  it("reverts when a non-owner calls any state-changing function", async () => {
    const { escrow, token, owner, landlord, tenant, stranger } = await deploy();
    await escrow
      .connect(owner)
      .openAndFund("lease-1", landlord.address, tenant.address, await token.getAddress(), RENT, DEPOSIT, TERMS_HASH);
    await expect(
      escrow
        .connect(stranger)
        .openAndFund("x", landlord.address, tenant.address, await token.getAddress(), RENT, DEPOSIT, TERMS_HASH),
    ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    await expect(escrow.connect(stranger).activate(1)).to.be.revertedWithCustomError(
      escrow,
      "OwnableUnauthorizedAccount",
    );
  });

  it("reverts reading an unknown escrow id", async () => {
    const { escrow } = await deploy();
    await expect(escrow.getEscrow(99)).to.be.revertedWith("no escrow");
    await expect(escrow.escrowState(99)).to.be.revertedWith("no escrow");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx hardhat test test/LeaseEscrow.test.ts`
Expected: FAIL — `escrow.releaseDeposit is not a function`.

- [ ] **Step 3: Add settlement functions** (insert after `cancel`)

```solidity
    /// @notice Settles the held deposit to the landlord (e.g. damages/forfeit).
    function releaseDeposit(uint256 escrowId) external onlyOwner nonReentrant {
        Escrow storage e = _escrows[escrowId];
        require(e.state == State.Active, "not active");
        e.state = State.Closed;
        IERC20(e.token).safeTransfer(e.landlord, e.depositAmount);
        emit DepositReleased(escrowId, e.landlord, e.depositAmount);
    }

    /// @notice Settles the held deposit back to the tenant (clean exit).
    function refundDeposit(uint256 escrowId) external onlyOwner nonReentrant {
        Escrow storage e = _escrows[escrowId];
        require(e.state == State.Active, "not active");
        e.state = State.Closed;
        IERC20(e.token).safeTransfer(e.tenant, e.depositAmount);
        emit DepositRefunded(escrowId, e.tenant, e.depositAmount);
    }
```

- [ ] **Step 4: Run the full contract test suite**

Run: `npm test`
Expected: PASS — all PropertyTitle tests plus 10 LeaseEscrow tests passing.

- [ ] **Step 5: Commit**

```bash
git add contracts/LeaseEscrow.sol test/LeaseEscrow.test.ts
git commit -m "feat(contracts): deposit settlement, access control, unknown-id guards"
```

---

### Task 6: Deploy script + ABI export + docs

**Files:**
- Modify: `scripts/deploy.ts`
- Modify: `scripts/export-abi.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Extend `scripts/deploy.ts`** (replace the whole `main` body)

```typescript
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main(): Promise<void> {
  const record: Record<string, string> = { network: network.name };

  const Title = await ethers.getContractFactory("PropertyTitle");
  const title = await Title.deploy();
  await title.waitForDeployment();
  record.address = await title.getAddress(); // back-compat: PropertyTitle address
  record.propertyTitle = record.address;
  console.log(`PropertyTitle deployed to ${record.address} on "${network.name}"`);

  const Escrow = await ethers.getContractFactory("LeaseEscrow");
  const escrow = await Escrow.deploy();
  await escrow.waitForDeployment();
  record.leaseEscrow = await escrow.getAddress();
  console.log(`LeaseEscrow deployed to ${record.leaseEscrow} on "${network.name}"`);

  // A mock stablecoin is only useful off mainnet, for local/testnet demos.
  if (network.name !== "mainnet") {
    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy();
    await token.waitForDeployment();
    record.mockToken = await token.getAddress();
    console.log(`MockERC20 deployed to ${record.mockToken} on "${network.name}"`);
  }

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${network.name}.json`),
    JSON.stringify(record, null, 2),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Extend `scripts/export-abi.ts`** (replace whole file)

```typescript
import * as fs from "fs";
import * as path from "path";

// Copies compiled ABIs out of artifacts/ into abi/ so the backend (or any
// consumer) can import clean ABIs without the full artifact.
const targets = [
  { sol: "PropertyTitle.sol", name: "PropertyTitle" },
  { sol: "LeaseEscrow.sol", name: "LeaseEscrow" },
  { sol: "mocks/MockERC20.sol", name: "MockERC20" },
];

const outDir = path.join(__dirname, "..", "abi");
fs.mkdirSync(outDir, { recursive: true });

for (const t of targets) {
  const artifactPath = path.join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    t.sol,
    `${t.name}.json`,
  );
  if (!fs.existsSync(artifactPath)) {
    console.error(`Artifact not found for ${t.name} — run \`npm run compile\` first.`);
    process.exit(1);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  fs.writeFileSync(
    path.join(outDir, `${t.name}.json`),
    JSON.stringify(artifact.abi, null, 2),
  );
  console.log(`ABI exported to abi/${t.name}.json`);
}
```

- [ ] **Step 3: Run deploy to a local in-process run + export ABI**

Run: `npm run compile && npx hardhat run scripts/deploy.ts && npm run export-abi`
Expected: console prints all three addresses; `abi/LeaseEscrow.json` and `abi/MockERC20.json` now exist.

- [ ] **Step 4: Document in `CLAUDE.md`**

Add a subsection under "Architecture" describing `LeaseEscrow.sol` (ERC-20 escrow, `onlyOwner`, states Funded→Active→Closed, first-month-on-activate / deposit-held-until-end), the new env vars the backend needs (`ESCROW_CONTRACT_ADDRESS`, `ESCROW_TOKEN_ADDRESS`), and that `deployments/<network>.json` now also carries `leaseEscrow` and `mockToken`.

- [ ] **Step 5: Commit**

```bash
git add scripts/deploy.ts scripts/export-abi.ts abi/ CLAUDE.md
git commit -m "feat(contracts): deploy + export-abi for LeaseEscrow & MockERC20"
```

> **End of Phase 1.** Note the deployed `leaseEscrow` and `mockToken` addresses from `deployments/<network>.json` — Phase 2 needs them.

---

## PHASE 2 — Backend (`d:\PROJECTS\real-estate-backend`)

> All backend commands run from `d:\PROJECTS\real-estate-backend`. The repo uses `npm test` (Jest). Run a single suite with `npx jest <path>`.

### Task 7: Escrow env vars + ABI

**Files:**
- Modify: `src/core/config/env.ts`
- Create: `src/core/blockchain/leaseEscrow.abi.ts`

- [ ] **Step 1: Add env vars to the Joi schema** in `src/core/config/env.ts`

After the `MINTER_PRIVATE_KEY` line (line 51), add inside `envSchema`:

```typescript
  // Lease escrow (ERC-20). Optional so the app/tests boot without a chain.
  ESCROW_CONTRACT_ADDRESS: Joi.string().allow("").default(""),
  ESCROW_TOKEN_ADDRESS: Joi.string().allow("").default(""),
```

- [ ] **Step 2: Add them to the `Env` interface** (after `MINTER_PRIVATE_KEY: string;`)

```typescript
  ESCROW_CONTRACT_ADDRESS: string;
  ESCROW_TOKEN_ADDRESS: string;
```

- [ ] **Step 3: Create the ABI** `src/core/blockchain/leaseEscrow.abi.ts`

```typescript
// ABI for the LeaseEscrow contract (lives in the real-estate-contracts repo).
// Parity-matched with that repo's abi/LeaseEscrow.json (`npm run export-abi`).
export const LEASE_ESCROW_ABI = [
  "function openAndFund(string leaseId, address landlord, address tenant, address token, uint256 rentAmount, uint256 depositAmount, bytes32 termsHash) returns (uint256)",
  "function activate(uint256 escrowId)",
  "function cancel(uint256 escrowId)",
  "function releaseDeposit(uint256 escrowId)",
  "function refundDeposit(uint256 escrowId)",
  "function escrowState(uint256 escrowId) view returns (uint8)",
  "function getEscrow(uint256 escrowId) view returns (tuple(string leaseId, address landlord, address tenant, address token, uint256 rentAmount, uint256 depositAmount, bytes32 termsHash, uint8 state))",
  "event EscrowFunded(uint256 indexed escrowId, string leaseId, address indexed landlord, address indexed tenant, uint256 rentAmount, uint256 depositAmount)",
  "event RentReleased(uint256 indexed escrowId, address indexed landlord, uint256 amount)",
  "event EscrowRefunded(uint256 indexed escrowId, address indexed tenant, uint256 amount)",
  "event DepositReleased(uint256 indexed escrowId, address indexed landlord, uint256 amount)",
  "event DepositRefunded(uint256 indexed escrowId, address indexed tenant, uint256 amount)",
] as const;
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/config/env.ts src/core/blockchain/leaseEscrow.abi.ts
git commit -m "feat(backend): escrow env vars + LeaseEscrow ABI"
```

---

### Task 8: leaseEscrow service

**Files:**
- Create: `src/core/blockchain/leaseEscrow.service.ts`

- [ ] **Step 1: Write the service** (mirrors `propertyTitle.service.ts`)

```typescript
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { StatusCodes } from "http-status-codes";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";
import { LEASE_ESCROW_ABI } from "./leaseEscrow.abi";

export const isConfigured = (): boolean =>
  Boolean(
    env.BLOCKCHAIN_RPC_URL &&
      env.ESCROW_CONTRACT_ADDRESS &&
      env.ESCROW_TOKEN_ADDRESS &&
      env.MINTER_PRIVATE_KEY,
  );

let cached: { contract: Contract; owner: Wallet } | null = null;

const getContract = (): { contract: Contract; owner: Wallet } => {
  if (!isConfigured()) {
    throw new AppError(
      "Lease escrow integration is not configured",
      StatusCodes.SERVICE_UNAVAILABLE,
    );
  }
  if (!cached) {
    const provider = new JsonRpcProvider(env.BLOCKCHAIN_RPC_URL);
    const owner = new Wallet(env.MINTER_PRIVATE_KEY, provider);
    const contract = new Contract(
      env.ESCROW_CONTRACT_ADDRESS,
      LEASE_ESCROW_ABI as unknown as string[],
      owner,
    );
    cached = { contract, owner };
  }
  return cached;
};

const toBytes32 = (hexHash: string): string =>
  hexHash.startsWith("0x") ? hexHash : `0x${hexHash}`;

export interface OpenEscrowInput {
  leaseId: string;
  landlord: string; // landlord payout address
  tenant: string; // tenant refund address
  rentAmount: bigint; // base units
  depositAmount: bigint; // base units
  termsHash: string; // sha256 hex of the terms snapshot
}

export interface EscrowTx {
  txHash: string;
}

export interface OpenEscrowResult extends EscrowTx {
  escrowId: string;
}

export const openAndFundEscrow = async (
  input: OpenEscrowInput,
): Promise<OpenEscrowResult> => {
  const { contract } = getContract();
  const tx = await contract.openAndFund(
    input.leaseId,
    input.landlord,
    input.tenant,
    env.ESCROW_TOKEN_ADDRESS,
    input.rentAmount,
    input.depositAmount,
    toBytes32(input.termsHash),
  );
  const receipt = await tx.wait();

  let escrowId: string | undefined;
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "EscrowFunded") {
        escrowId = parsed.args.escrowId.toString();
        break;
      }
    } catch {
      // not from this contract
    }
  }
  if (!escrowId) {
    throw new AppError(
      "Escrow funded but no EscrowFunded event was found",
      StatusCodes.BAD_GATEWAY,
    );
  }
  return { escrowId, txHash: receipt.hash };
};

const call = async (
  method: "activate" | "cancel" | "releaseDeposit" | "refundDeposit",
  escrowId: string,
): Promise<EscrowTx> => {
  const { contract } = getContract();
  const tx = await contract[method](escrowId);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
};

export const activateEscrow = (id: string): Promise<EscrowTx> => call("activate", id);
export const cancelEscrow = (id: string): Promise<EscrowTx> => call("cancel", id);
export const releaseDeposit = (id: string): Promise<EscrowTx> => call("releaseDeposit", id);
export const refundDeposit = (id: string): Promise<EscrowTx> => call("refundDeposit", id);

const STATE_LABELS = ["none", "funded", "active", "closed"] as const;

export interface OnChainEscrow {
  state: (typeof STATE_LABELS)[number];
  landlord: string;
  tenant: string;
  rentAmount: string;
  depositAmount: string;
  termsHash: string; // hex, no 0x
}

export const getEscrow = async (escrowId: string): Promise<OnChainEscrow> => {
  const { contract } = getContract();
  const e = await contract.getEscrow(escrowId);
  return {
    state: STATE_LABELS[Number(e.state)] ?? "none",
    landlord: e.landlord as string,
    tenant: e.tenant as string,
    rentAmount: e.rentAmount.toString(),
    depositAmount: e.depositAmount.toString(),
    termsHash: (e.termsHash as string).replace(/^0x/, ""),
  };
};

// Test seam: reset the memoized contract between tests if needed.
export const _resetCache = (): void => {
  cached = null;
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/blockchain/leaseEscrow.service.ts
git commit -m "feat(backend): leaseEscrow chain service"
```

---

### Task 9: Audit actions for leases

**Files:**
- Modify: `src/modules/audit/audit.model.ts`

- [ ] **Step 1: Add lease actions + lease target type**

In `src/modules/audit/audit.model.ts`, append to the `AUDIT_ACTIONS` array (before the closing `] as const;`):

```typescript
  "lease.created",
  "lease.proposed",
  "lease.escrow_funded",
  "lease.activated",
  "lease.cancelled",
  "lease.completed",
  "lease.terminated",
  "lease.disputed",
  "lease.dispute_resolved",
```

And widen the target type:

```typescript
export type AuditTargetType = "listing" | "user" | "lease";
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/audit/audit.model.ts
git commit -m "feat(backend): add lease audit actions"
```

---

### Task 10: Lease model

**Files:**
- Create: `src/modules/leases/lease.model.ts`

- [ ] **Step 1: Write the model** (mirrors `listing.model.ts` conventions)

```typescript
import { Schema, model, Document, Types } from "mongoose";

export type LeaseStatus =
  | "draft"
  | "proposed"
  | "active"
  | "completed"
  | "terminated"
  | "cancelled"
  | "disputed";

export type EscrowState = "none" | "funded" | "active" | "closed";

export interface ILeaseEscrow {
  escrowId?: string;
  contractAddress?: string;
  token?: string;
  state: EscrowState;
  fundTxHash?: string;
  activateTxHash?: string;
  settleTxHash?: string;
  landlordWallet?: string;
  tenantWallet?: string;
}

export interface ILease extends Document {
  listing: Types.ObjectId;
  landlord: Types.ObjectId;
  tenant: Types.ObjectId;
  currency: string;
  monthlyRent: number;
  depositAmount: number;
  escrowAmount: number;
  startDate: Date;
  endDate: Date;
  terms?: string;
  termsHash?: string;
  status: LeaseStatus;
  escrow: ILeaseEscrow;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const escrowSchema = new Schema<ILeaseEscrow>(
  {
    escrowId: String,
    contractAddress: String,
    token: String,
    state: {
      type: String,
      enum: ["none", "funded", "active", "closed"],
      default: "none",
    },
    fundTxHash: String,
    activateTxHash: String,
    settleTxHash: String,
    landlordWallet: String,
    tenantWallet: String,
  },
  { _id: false },
);

const leaseSchema = new Schema<ILease>(
  {
    listing: { type: Schema.Types.ObjectId, ref: "Listing", required: true, index: true },
    landlord: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tenant: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    currency: { type: String, default: "USD", uppercase: true },
    monthlyRent: { type: Number, required: true, min: 0 },
    depositAmount: { type: Number, required: true, min: 0 },
    escrowAmount: { type: Number, required: true, min: 0 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    terms: String,
    termsHash: String,
    status: {
      type: String,
      enum: [
        "draft",
        "proposed",
        "active",
        "completed",
        "terminated",
        "cancelled",
        "disputed",
      ],
      default: "draft",
      index: true,
    },
    escrow: { type: escrowSchema, default: () => ({ state: "none" }) },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret._id;
        return ret;
      },
    },
  },
);

export const Lease = model<ILease>("Lease", leaseSchema);
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/leases/lease.model.ts
git commit -m "feat(backend): lease model"
```

---

### Task 11: Lease validation schemas

**Files:**
- Create: `src/modules/leases/lease.validation.ts`

- [ ] **Step 1: Write the schemas** (mirrors `listing.validation.ts` Joi style)

```typescript
import Joi from "joi";

export const createLeaseSchema = Joi.object({
  listingId: Joi.string().hex().length(24).required(),
  tenantId: Joi.string().hex().length(24).required(),
  monthlyRent: Joi.number().min(0).required(),
  depositAmount: Joi.number().min(0).required(),
  currency: Joi.string().uppercase().default("USD"),
  startDate: Joi.date().iso().required(),
  endDate: Joi.date().iso().greater(Joi.ref("startDate")).required(),
  terms: Joi.string().max(20000).allow("").optional(),
});

export const disputeResolveSchema = Joi.object({
  decision: Joi.string().valid("release_deposit", "refund_deposit", "cancel").required(),
  note: Joi.string().max(2000).allow("").optional(),
});

export type CreateLeaseInput = {
  listingId: string;
  tenantId: string;
  monthlyRent: number;
  depositAmount: number;
  currency: string;
  startDate: string;
  endDate: string;
  terms?: string;
};

export type DisputeResolveInput = {
  decision: "release_deposit" | "refund_deposit" | "cancel";
  note?: string;
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/leases/lease.validation.ts
git commit -m "feat(backend): lease validation schemas"
```

---

### Task 12: Lease service — state machine (test-first)

**Files:**
- Create: `src/modules/leases/lease.service.ts`
- Test: `tests/leases/lease.service.test.ts`

This task isolates the lease state machine from the chain by mocking `leaseEscrow.service`.

- [ ] **Step 1: Write the failing test**

Create `tests/leases/lease.service.test.ts`. (Match the DB-setup style of the existing listing service test — check `tests/` for the shared mongodb-memory-server helper and reuse it. The block below assumes the same `setupTestDb()` pattern; if the repo names it differently, use the existing helper.)

```typescript
import { jest } from "@jest/globals";
import mongoose from "mongoose";

// Mock the chain so the state machine is tested in isolation.
jest.mock("../../src/core/blockchain/leaseEscrow.service", () => ({
  openAndFundEscrow: jest.fn(async () => ({ escrowId: "1", txHash: "0xfund" })),
  activateEscrow: jest.fn(async () => ({ txHash: "0xact" })),
  cancelEscrow: jest.fn(async () => ({ txHash: "0xcancel" })),
  releaseDeposit: jest.fn(async () => ({ txHash: "0xrelease" })),
  refundDeposit: jest.fn(async () => ({ txHash: "0xrefund" })),
  getEscrow: jest.fn(async () => ({ state: "funded" })),
  isConfigured: () => true,
}));

import * as service from "../../src/modules/leases/lease.service";
import { Lease } from "../../src/modules/leases/lease.model";
import { Listing } from "../../src/modules/listings/listing.model";
import { User } from "../../src/modules/auth/auth.model";
// import { setupTestDb } from "../helpers/db"; // use the repo's existing helper

const oid = () => new mongoose.Types.ObjectId().toString();

async function seedRentListing() {
  const landlord = await User.create({
    name: "L", email: `l${Date.now()}@x.io`, password: "x".repeat(12), role: "property_owner", accountStatus: "active",
    walletAddress: "0x" + "1".repeat(40),
  });
  const tenant = await User.create({
    name: "T", email: `t${Date.now()}@x.io`, password: "x".repeat(12), role: "tenant", accountStatus: "active",
    walletAddress: "0x" + "2".repeat(40),
  });
  const listing = await Listing.create({
    title: "Flat", listingType: "rent", category: "residential", status: "published",
    monthlyRent: 1000, location: { type: "Point", coordinates: [38.7, 9.0] }, createdBy: landlord.id,
  });
  return { landlord, tenant, listing };
}

describe("lease.service state machine", () => {
  // beforeAll/afterAll/afterEach: wire the repo's existing in-memory mongo helper.

  it("creates a draft lease for a rent listing", async () => {
    const { landlord, tenant, listing } = await seedRentListing();
    const lease = await service.createLease(
      { listingId: listing.id, tenantId: tenant.id, monthlyRent: 1000, depositAmount: 1500, currency: "USD",
        startDate: "2026-07-01", endDate: "2027-07-01" },
      landlord.id, "property_owner",
    );
    expect(lease.status).toBe("draft");
    expect(lease.escrowAmount).toBe(2500);
    expect(lease.escrow.state).toBe("none");
  });

  it("propose -> fund -> activate moves to active and releases first month", async () => {
    const chain = require("../../src/core/blockchain/leaseEscrow.service");
    const { landlord, tenant, listing } = await seedRentListing();
    let lease = await service.createLease(
      { listingId: listing.id, tenantId: tenant.id, monthlyRent: 1000, depositAmount: 1500, currency: "USD",
        startDate: "2026-07-01", endDate: "2027-07-01" }, landlord.id, "property_owner");
    lease = await service.propose(lease.id, landlord.id, "property_owner");
    expect(lease.status).toBe("proposed");
    expect(lease.termsHash).toBeTruthy();

    lease = await service.fund(lease.id, oid(), "admin");
    expect(chain.openAndFundEscrow).toHaveBeenCalled();
    expect(lease.status).toBe("proposed");
    expect(lease.escrow.state).toBe("funded");
    expect(lease.escrow.escrowId).toBe("1");

    lease = await service.activate(lease.id, oid(), "admin");
    expect(chain.activateEscrow).toHaveBeenCalledWith("1");
    expect(lease.status).toBe("active");
    expect(lease.escrow.state).toBe("active");
  });

  it("complete refunds the deposit to the tenant", async () => {
    const chain = require("../../src/core/blockchain/leaseEscrow.service");
    const { landlord, tenant, listing } = await seedRentListing();
    let lease = await service.createLease(
      { listingId: listing.id, tenantId: tenant.id, monthlyRent: 1000, depositAmount: 1500, currency: "USD",
        startDate: "2026-07-01", endDate: "2027-07-01" }, landlord.id, "property_owner");
    lease = await service.propose(lease.id, landlord.id, "property_owner");
    lease = await service.fund(lease.id, oid(), "admin");
    lease = await service.activate(lease.id, oid(), "admin");
    lease = await service.complete(lease.id, oid(), "admin");
    expect(chain.refundDeposit).toHaveBeenCalledWith("1");
    expect(lease.status).toBe("completed");
    expect(lease.escrow.state).toBe("closed");
  });

  it("cancel before activation refunds everything", async () => {
    const chain = require("../../src/core/blockchain/leaseEscrow.service");
    const { landlord, tenant, listing } = await seedRentListing();
    let lease = await service.createLease(
      { listingId: listing.id, tenantId: tenant.id, monthlyRent: 1000, depositAmount: 1500, currency: "USD",
        startDate: "2026-07-01", endDate: "2027-07-01" }, landlord.id, "property_owner");
    lease = await service.propose(lease.id, landlord.id, "property_owner");
    lease = await service.fund(lease.id, oid(), "admin");
    lease = await service.cancel(lease.id, landlord.id, "property_owner");
    expect(chain.cancelEscrow).toHaveBeenCalledWith("1");
    expect(lease.status).toBe("cancelled");
  });

  it("rejects activate when not funded", async () => {
    const { landlord, tenant, listing } = await seedRentListing();
    let lease = await service.createLease(
      { listingId: listing.id, tenantId: tenant.id, monthlyRent: 1000, depositAmount: 1500, currency: "USD",
        startDate: "2026-07-01", endDate: "2027-07-01" }, landlord.id, "property_owner");
    lease = await service.propose(lease.id, landlord.id, "property_owner");
    await expect(service.activate(lease.id, oid(), "admin")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/leases/lease.service.test.ts`
Expected: FAIL — cannot find module `lease.service` / functions undefined.

- [ ] **Step 3: Write the service** `src/modules/leases/lease.service.ts`

```typescript
import { StatusCodes } from "http-status-codes";
import { parseUnits } from "ethers";
import { Lease, ILease, LeaseStatus } from "./lease.model";
import { Listing } from "../listings/listing.model";
import { User } from "../auth/auth.model";
import { AppError } from "../../core/utils/AppError";
import { sha256 } from "../../core/utils/hash";
import * as audit from "../audit/audit.service";
import * as escrow from "../../core/blockchain/leaseEscrow.service";
import type { CreateLeaseInput, DisputeResolveInput } from "./lease.validation";

const ADMIN_ROLES = ["admin", "super_admin"];
const isAdmin = (role: string | null): boolean =>
  role !== null && ADMIN_ROLES.includes(role);

// ERC-20 token decimals for the escrow stablecoin (MockERC20 / USDC-like).
const TOKEN_DECIMALS = 18;
const toBaseUnits = (amount: number): bigint =>
  parseUnits(amount.toString(), TOKEN_DECIMALS);

const findOr404 = async (id: string): Promise<ILease> => {
  const lease = await Lease.findById(id);
  if (!lease) throw new AppError("Lease not found", StatusCodes.NOT_FOUND);
  return lease;
};

const isParty = (lease: ILease, userId: string | null): boolean =>
  !!userId &&
  (lease.landlord.toString() === userId || lease.tenant.toString() === userId);

const ensureLandlordOrAdmin = (lease: ILease, userId: string, role: string): void => {
  if (!isAdmin(role) && lease.landlord.toString() !== userId) {
    throw new AppError("Only the landlord or an admin may do this", StatusCodes.FORBIDDEN);
  }
};

const ensureState = (lease: ILease, allowed: LeaseStatus[]): void => {
  if (!allowed.includes(lease.status)) {
    throw new AppError(
      `A lease in "${lease.status}" cannot do this`,
      StatusCodes.CONFLICT,
    );
  }
};

export const createLease = async (
  input: CreateLeaseInput,
  userId: string,
  actorRole: string,
): Promise<ILease> => {
  const listing = await Listing.findById(input.listingId);
  if (!listing) throw new AppError("Listing not found", StatusCodes.NOT_FOUND);
  if (listing.listingType !== "rent") {
    throw new AppError("Leases require a rent listing", StatusCodes.BAD_REQUEST);
  }
  if (!isAdmin(actorRole) && listing.createdBy.toString() !== userId) {
    throw new AppError("Only the listing owner may create a lease", StatusCodes.FORBIDDEN);
  }
  const tenant = await User.findById(input.tenantId);
  if (!tenant) throw new AppError("Tenant not found", StatusCodes.NOT_FOUND);

  const escrowAmount = input.monthlyRent + input.depositAmount;
  const lease = await Lease.create({
    listing: listing.id,
    landlord: listing.createdBy,
    tenant: tenant.id,
    currency: input.currency,
    monthlyRent: input.monthlyRent,
    depositAmount: input.depositAmount,
    escrowAmount,
    startDate: input.startDate,
    endDate: input.endDate,
    terms: input.terms,
    createdBy: userId,
  });
  await audit.record({
    actor: userId, actorRole, action: "lease.created",
    targetType: "lease", targetId: lease.id,
  });
  return lease;
};

export const propose = async (
  id: string, userId: string, role: string,
): Promise<ILease> => {
  const lease = await findOr404(id);
  ensureLandlordOrAdmin(lease, userId, role);
  ensureState(lease, ["draft"]);
  // Snapshot the agreed terms and anchor a hash (verifiable on-chain later).
  lease.termsHash = sha256(
    Buffer.from(
      JSON.stringify({
        listing: lease.listing.toString(),
        landlord: lease.landlord.toString(),
        tenant: lease.tenant.toString(),
        monthlyRent: lease.monthlyRent,
        depositAmount: lease.depositAmount,
        startDate: lease.startDate,
        endDate: lease.endDate,
        terms: lease.terms ?? "",
      }),
    ),
  );
  lease.status = "proposed";
  await lease.save();
  await audit.record({
    actor: userId, actorRole: role, action: "lease.proposed",
    targetType: "lease", targetId: lease.id,
  });
  return lease;
};

// Admin funds the on-chain escrow after confirming the tenant's off-chain payment.
export const fund = async (
  id: string, userId: string, role: string,
): Promise<ILease> => {
  if (!isAdmin(role)) throw new AppError("Admin only", StatusCodes.FORBIDDEN);
  const lease = await findOr404(id);
  ensureState(lease, ["proposed"]);
  if (lease.escrow.state !== "none") {
    throw new AppError("Escrow already funded", StatusCodes.CONFLICT);
  }
  const [landlord, tenant] = await Promise.all([
    User.findById(lease.landlord),
    User.findById(lease.tenant),
  ]);
  if (!landlord?.walletAddress || !tenant?.walletAddress) {
    throw new AppError(
      "Both landlord and tenant must have a linked wallet address",
      StatusCodes.BAD_REQUEST,
    );
  }
  if (!lease.termsHash) {
    throw new AppError("Lease has no terms hash; propose it first", StatusCodes.CONFLICT);
  }
  const result = await escrow.openAndFundEscrow({
    leaseId: lease.id,
    landlord: landlord.walletAddress,
    tenant: tenant.walletAddress,
    rentAmount: toBaseUnits(lease.monthlyRent),
    depositAmount: toBaseUnits(lease.depositAmount),
    termsHash: lease.termsHash,
  });
  lease.escrow.escrowId = result.escrowId;
  lease.escrow.contractAddress = process.env.ESCROW_CONTRACT_ADDRESS;
  lease.escrow.token = process.env.ESCROW_TOKEN_ADDRESS;
  lease.escrow.state = "funded";
  lease.escrow.fundTxHash = result.txHash;
  lease.escrow.landlordWallet = landlord.walletAddress;
  lease.escrow.tenantWallet = tenant.walletAddress;
  await lease.save();
  await audit.record({
    actor: userId, actorRole: role, action: "lease.escrow_funded",
    targetType: "lease", targetId: lease.id,
    metadata: { escrowId: result.escrowId, txHash: result.txHash },
  });
  return lease;
};

const requireFundedEscrow = (lease: ILease): string => {
  if (lease.escrow.state !== "funded" || !lease.escrow.escrowId) {
    throw new AppError("Escrow is not funded", StatusCodes.CONFLICT);
  }
  return lease.escrow.escrowId;
};

const requireActiveEscrow = (lease: ILease): string => {
  if (lease.escrow.state !== "active" || !lease.escrow.escrowId) {
    throw new AppError("Escrow is not active", StatusCodes.CONFLICT);
  }
  return lease.escrow.escrowId;
};

export const activate = async (
  id: string, userId: string, role: string,
): Promise<ILease> => {
  if (!isAdmin(role)) throw new AppError("Admin only", StatusCodes.FORBIDDEN);
  const lease = await findOr404(id);
  ensureState(lease, ["proposed"]);
  const escrowId = requireFundedEscrow(lease);
  const tx = await escrow.activateEscrow(escrowId);
  lease.status = "active";
  lease.escrow.state = "active";
  lease.escrow.activateTxHash = tx.txHash;
  await lease.save();
  await audit.record({
    actor: userId, actorRole: role, action: "lease.activated",
    targetType: "lease", targetId: lease.id, metadata: { txHash: tx.txHash },
  });
  return lease;
};

export const cancel = async (
  id: string, userId: string, role: string,
): Promise<ILease> => {
  const lease = await findOr404(id);
  if (!isAdmin(role) && !isParty(lease, userId)) {
    throw new AppError("Not allowed", StatusCodes.FORBIDDEN);
  }
  ensureState(lease, ["proposed"]);
  if (lease.escrow.state === "funded") {
    const tx = await escrow.cancelEscrow(requireFundedEscrow(lease));
    lease.escrow.state = "closed";
    lease.escrow.settleTxHash = tx.txHash;
  }
  lease.status = "cancelled";
  await lease.save();
  await audit.record({
    actor: userId, actorRole: role, action: "lease.cancelled",
    targetType: "lease", targetId: lease.id,
  });
  return lease;
};

export const complete = async (
  id: string, userId: string, role: string,
): Promise<ILease> => {
  if (!isAdmin(role)) throw new AppError("Admin only", StatusCodes.FORBIDDEN);
  const lease = await findOr404(id);
  ensureState(lease, ["active"]);
  const tx = await escrow.refundDeposit(requireActiveEscrow(lease));
  lease.status = "completed";
  lease.escrow.state = "closed";
  lease.escrow.settleTxHash = tx.txHash;
  await lease.save();
  await audit.record({
    actor: userId, actorRole: role, action: "lease.completed",
    targetType: "lease", targetId: lease.id, metadata: { txHash: tx.txHash },
  });
  return lease;
};

export const terminate = async (
  id: string, userId: string, role: string,
): Promise<ILease> => {
  if (!isAdmin(role)) throw new AppError("Admin only", StatusCodes.FORBIDDEN);
  const lease = await findOr404(id);
  ensureState(lease, ["active"]);
  const tx = await escrow.releaseDeposit(requireActiveEscrow(lease));
  lease.status = "terminated";
  lease.escrow.state = "closed";
  lease.escrow.settleTxHash = tx.txHash;
  await lease.save();
  await audit.record({
    actor: userId, actorRole: role, action: "lease.terminated",
    targetType: "lease", targetId: lease.id, metadata: { txHash: tx.txHash },
  });
  return lease;
};

export const dispute = async (
  id: string, userId: string, role: string,
): Promise<ILease> => {
  const lease = await findOr404(id);
  if (!isAdmin(role) && !isParty(lease, userId)) {
    throw new AppError("Not allowed", StatusCodes.FORBIDDEN);
  }
  ensureState(lease, ["proposed", "active"]);
  lease.status = "disputed";
  await lease.save();
  await audit.record({
    actor: userId, actorRole: role, action: "lease.disputed",
    targetType: "lease", targetId: lease.id,
  });
  return lease;
};

export const resolveDispute = async (
  id: string, input: DisputeResolveInput, userId: string, role: string,
): Promise<ILease> => {
  if (!isAdmin(role)) throw new AppError("Admin only", StatusCodes.FORBIDDEN);
  const lease = await findOr404(id);
  ensureState(lease, ["disputed"]);
  const escrowId = lease.escrow.escrowId;
  if (!escrowId) throw new AppError("No escrow to settle", StatusCodes.CONFLICT);

  let tx: { txHash: string };
  let finalStatus: LeaseStatus;
  if (input.decision === "cancel") {
    if (lease.escrow.state !== "funded") {
      throw new AppError("Can only cancel a funded (pre-activation) escrow", StatusCodes.CONFLICT);
    }
    tx = await escrow.cancelEscrow(escrowId);
    finalStatus = "cancelled";
  } else {
    if (lease.escrow.state !== "active") {
      throw new AppError("Deposit settlement requires an active escrow", StatusCodes.CONFLICT);
    }
    tx = input.decision === "release_deposit"
      ? await escrow.releaseDeposit(escrowId)
      : await escrow.refundDeposit(escrowId);
    finalStatus = input.decision === "release_deposit" ? "terminated" : "completed";
  }
  lease.status = finalStatus;
  lease.escrow.state = "closed";
  lease.escrow.settleTxHash = tx.txHash;
  await lease.save();
  await audit.record({
    actor: userId, actorRole: role, action: "lease.dispute_resolved",
    targetType: "lease", targetId: lease.id,
    metadata: { decision: input.decision, note: input.note, txHash: tx.txHash },
  });
  return lease;
};

export const listMine = async (userId: string): Promise<ILease[]> =>
  Lease.find({ $or: [{ landlord: userId }, { tenant: userId }] }).sort({ createdAt: -1 });

export const getLeaseById = async (
  id: string, userId: string | null, role: string | null,
): Promise<ILease> => {
  const lease = await findOr404(id);
  if (!isAdmin(role) && !isParty(lease, userId)) {
    throw new AppError("Lease not found", StatusCodes.NOT_FOUND);
  }
  return lease;
};

export const getEscrowInfo = async (
  id: string, userId: string | null, role: string | null,
): Promise<{ lease: ILease; onChain: Awaited<ReturnType<typeof escrow.getEscrow>> | null }> => {
  const lease = await getLeaseById(id, userId, role);
  const onChain = lease.escrow.escrowId
    ? await escrow.getEscrow(lease.escrow.escrowId)
    : null;
  return { lease, onChain };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/leases/lease.service.test.ts`
Expected: PASS (6 passing). If the DB helper wiring differs, fix the imports per the repo's existing test setup, then re-run.

- [ ] **Step 5: Commit**

```bash
git add src/modules/leases/lease.service.ts tests/leases/lease.service.test.ts
git commit -m "feat(backend): lease state machine service + tests"
```

---

### Task 13: Lease controller + routes + router wiring

**Files:**
- Create: `src/modules/leases/lease.controller.ts`
- Create: `src/modules/leases/lease.routes.ts`
- Modify: `src/index.routes.ts`

- [ ] **Step 1: Write the controller** (mirrors `listing.controller.ts`)

```typescript
import { Request, Response, NextFunction } from "express";
import * as service from "./lease.service";
import { sendSuccess, sendCreated } from "../../core/utils/response";
import type { CreateLeaseInput, DisputeResolveInput } from "./lease.validation";

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export const create: Handler = async (req, res, next) => {
  try {
    const lease = await service.createLease(
      req.body as CreateLeaseInput, req.user!.userId, req.user!.role);
    sendCreated(res, lease, "Lease created");
  } catch (e) { next(e); }
};

export const propose: Handler = async (req, res, next) => {
  try {
    const lease = await service.propose(req.params.id, req.user!.userId, req.user!.role);
    sendSuccess(res, lease, "Lease proposed");
  } catch (e) { next(e); }
};

export const fund: Handler = async (req, res, next) => {
  try {
    const lease = await service.fund(req.params.id, req.user!.userId, req.user!.role);
    sendSuccess(res, lease, "Escrow funded");
  } catch (e) { next(e); }
};

export const activate: Handler = async (req, res, next) => {
  try {
    const lease = await service.activate(req.params.id, req.user!.userId, req.user!.role);
    sendSuccess(res, lease, "Lease activated");
  } catch (e) { next(e); }
};

export const cancel: Handler = async (req, res, next) => {
  try {
    const lease = await service.cancel(req.params.id, req.user!.userId, req.user!.role);
    sendSuccess(res, lease, "Lease cancelled");
  } catch (e) { next(e); }
};

export const complete: Handler = async (req, res, next) => {
  try {
    const lease = await service.complete(req.params.id, req.user!.userId, req.user!.role);
    sendSuccess(res, lease, "Lease completed");
  } catch (e) { next(e); }
};

export const terminate: Handler = async (req, res, next) => {
  try {
    const lease = await service.terminate(req.params.id, req.user!.userId, req.user!.role);
    sendSuccess(res, lease, "Lease terminated");
  } catch (e) { next(e); }
};

export const dispute: Handler = async (req, res, next) => {
  try {
    const lease = await service.dispute(req.params.id, req.user!.userId, req.user!.role);
    sendSuccess(res, lease, "Lease disputed");
  } catch (e) { next(e); }
};

export const resolveDispute: Handler = async (req, res, next) => {
  try {
    const lease = await service.resolveDispute(
      req.params.id, req.body as DisputeResolveInput, req.user!.userId, req.user!.role);
    sendSuccess(res, lease, "Dispute resolved");
  } catch (e) { next(e); }
};

export const mine: Handler = async (req, res, next) => {
  try {
    const leases = await service.listMine(req.user!.userId);
    sendSuccess(res, leases, "Your leases");
  } catch (e) { next(e); }
};

export const getOne: Handler = async (req, res, next) => {
  try {
    const lease = await service.getLeaseById(
      req.params.id, req.user?.userId ?? null, req.user?.role ?? null);
    sendSuccess(res, lease, "Lease");
  } catch (e) { next(e); }
};

export const escrowInfo: Handler = async (req, res, next) => {
  try {
    const info = await service.getEscrowInfo(
      req.params.id, req.user?.userId ?? null, req.user?.role ?? null);
    sendSuccess(res, info, "On-chain escrow");
  } catch (e) { next(e); }
};
```

- [ ] **Step 2: Write the routes** `src/modules/leases/lease.routes.ts`

```typescript
import { Router } from "express";
import * as controller from "./lease.controller";
import { validate } from "../../core/middleware/validate.middleware";
import { authenticate, authorize } from "../../core/middleware/auth.middleware";
import { createLeaseSchema, disputeResolveSchema } from "./lease.validation";

export const leaseRouter = Router();

const landlords = authorize("property_owner", "admin", "super_admin");
const admins = authorize("admin", "super_admin");
const anyParty = authorize("property_owner", "tenant", "admin", "super_admin");

leaseRouter.get("/mine", authenticate, anyParty, controller.mine);
leaseRouter.get("/:id", authenticate, anyParty, controller.getOne);
leaseRouter.get("/:id/escrow", authenticate, anyParty, controller.escrowInfo);

leaseRouter.post("/", authenticate, landlords, validate(createLeaseSchema), controller.create);
leaseRouter.post("/:id/propose", authenticate, landlords, controller.propose);

// Money movement — admin only.
leaseRouter.post("/:id/fund", authenticate, admins, controller.fund);
leaseRouter.post("/:id/activate", authenticate, admins, controller.activate);
leaseRouter.post("/:id/complete", authenticate, admins, controller.complete);
leaseRouter.post("/:id/terminate", authenticate, admins, controller.terminate);
leaseRouter.post(
  "/:id/dispute/resolve",
  authenticate, admins, validate(disputeResolveSchema), controller.resolveDispute);

// Either party (or admin) may cancel pre-activation or flag a dispute.
leaseRouter.post("/:id/cancel", authenticate, anyParty, controller.cancel);
leaseRouter.post("/:id/dispute", authenticate, anyParty, controller.dispute);
```

- [ ] **Step 3: Wire the router** in `src/index.routes.ts`

Add the import near the other module imports:

```typescript
import { leaseRouter } from "./modules/leases/lease.routes";
```

And register it (next to `router.use("/listings", listingRouter);`):

```typescript
router.use("/leases", leaseRouter);
```

- [ ] **Step 4: Verify it compiles + full suite still green**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass (existing + new lease service tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/leases/lease.controller.ts src/modules/leases/lease.routes.ts src/index.routes.ts
git commit -m "feat(backend): lease controller, routes, router wiring"
```

---

### Task 14: OpenAPI docs + backend wiring docs

**Files:**
- Modify: `src/core/docs/openapi.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the `/leases` endpoints** in `src/core/docs/openapi.ts`

Follow the existing spec style in that file. Add path entries for: `POST /leases`, `POST /leases/{id}/propose`, `GET /leases/mine`, `GET /leases/{id}`, `POST /leases/{id}/fund`, `POST /leases/{id}/activate`, `POST /leases/{id}/cancel`, `POST /leases/{id}/complete`, `POST /leases/{id}/terminate`, `POST /leases/{id}/dispute`, `POST /leases/{id}/dispute/resolve`, `GET /leases/{id}/escrow`. Reuse the auth + error response components already defined in the file.

- [ ] **Step 2: Update `CLAUDE.md`** (backend) — add a "Lease escrow flow" subsection:
  1. Deploy contracts (`npm run deploy:local` in the contracts repo) → note `leaseEscrow` + `mockToken` addresses.
  2. Backend `.env`: `ESCROW_CONTRACT_ADDRESS=<leaseEscrow>`, `ESCROW_TOKEN_ADDRESS=<mockToken>` (reuses `BLOCKCHAIN_RPC_URL` + `MINTER_PRIVATE_KEY`).
  3. Operational precondition: the custodial wallet must hold the mock/stablecoin and approve the escrow before funding — for local demos, `MockERC20.mint(<minter>, amount)` then `approve(<escrow>, amount)`.
  4. Flow: `POST /leases` → `/propose` → (admin) `/fund` → `/activate` → `/complete` or `/terminate`; disputes via `/dispute` then `/dispute/resolve`.

- [ ] **Step 3: Verify the spec endpoint serves**

Run: `npm run dev` (or the repo's start script), then open `GET /api/docs` and confirm the `/leases` paths render. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/core/docs/openapi.ts CLAUDE.md
git commit -m "docs(backend): document lease escrow endpoints + wiring"
```

---

## Self-review notes (coverage check)

- **On-chain ERC-20 escrow** → Tasks 1–5 (`LeaseEscrow.sol` + `MockERC20`, full TDD).
- **Deposit + first month, split settlement** → `openAndFund` (Task 2), `activate` releases rent (Task 3), `releaseDeposit`/`refundDeposit` settle deposit (Task 5).
- **Custodial release authority** → every state-changing fn is `onlyOwner`; backend money-movement endpoints are admin-gated (Task 13).
- **Admin-decided disputes** → `resolveDispute` maps `cancel`/`release_deposit`/`refund_deposit` to the matching contract path (Task 12), admin-only route (Task 13).
- **Backend-owned lease lifecycle** → `lease.model.ts` + state machine in `lease.service.ts` (Tasks 10, 12), audit-logged (Task 9).
- **Deploy/ABI/wiring** → Task 6 (contracts) + Tasks 7, 14 (backend env + docs).
- **No new roles** → reuses `property_owner` (landlord), `tenant`, `admin`.

**Known integration assumptions to verify during execution:**
- The backend test suite's in-memory Mongo helper name/location (Task 12 Step 1) — reuse whatever the existing listing tests use.
- `User` model requires `walletAddress` on both parties before `fund` (enforced in service) — seed wallets in tests and document for demos.
- Token decimals fixed at 18 (`MockERC20`); if a real stablecoin with 6 decimals is used later, make `TOKEN_DECIMALS` an env var.
