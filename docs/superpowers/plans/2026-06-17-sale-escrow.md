# SaleEscrow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `SaleEscrow` contract for property purchase transactions, mirroring the LeaseEscrow pattern with a simpler single-amount lifecycle.

**Architecture:** OZ5 `Ownable` + `SafeERC20` + `ReentrancyGuard`, no `AccessControl`/`Pausable` (the spec only requires `onlyOwner`). The owner (platform wallet) custodially funds, releases, or refunds each escrow. Tests use ethers v6 + Chai following the `LeaseEscrow.test.ts` style.

**Tech Stack:** Solidity ^0.8.24, Hardhat + TypeChain, OpenZeppelin 5, ethers v6, Chai, TypeScript.

## Global Constraints

- Solidity `^0.8.24`, `evmVersion: "cancun"` — do not downgrade
- OpenZeppelin 5 imports (`@openzeppelin/contracts/...`)
- ethers v6 BigInt literals (`1n`, `parseUnits`)
- `AMOUNT = ethers.parseUnits("50000", 18)`, `TERMS_HASH = "0x" + "cd".repeat(32)`
- `checks-effects-interactions`: set state BEFORE token transfer in every fund-moving function
- No fee-on-transfer or rebasing tokens — document in NatSpec

---

### Task 1: SaleEscrow contract + test (TDD)

**Files:**
- Create: `contracts/SaleEscrow.sol`
- Create: `test/SaleEscrow.test.ts`

**Interfaces:**
- Produces: `SaleEscrow` contract with `openAndFund`, `release`, `refund`, `getEscrow`, `escrowState`

- [ ] **Step 1: Write failing tests in `test/SaleEscrow.test.ts`**

```typescript
import { expect } from "chai";
import { ethers } from "hardhat";
import { SaleEscrow, MockERC20 } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const AMOUNT = ethers.parseUnits("50000", 18);
const TERMS_HASH = ("0x" + "cd".repeat(32)) as `0x${string}`;

describe("SaleEscrow", () => {
  async function deploy(): Promise<{
    escrow: SaleEscrow;
    token: MockERC20;
    owner: HardhatEthersSigner;
    buyer: HardhatEthersSigner;
    seller: HardhatEthersSigner;
    other: HardhatEthersSigner;
  }> {
    const [owner, buyer, seller, other] = await ethers.getSigners();

    const TokenFactory = await ethers.getContractFactory("MockERC20");
    const token = (await TokenFactory.deploy()) as MockERC20;
    await token.waitForDeployment();

    const EscrowFactory = await ethers.getContractFactory("SaleEscrow");
    const escrow = (await EscrowFactory.deploy()) as SaleEscrow;
    await escrow.waitForDeployment();

    // Owner (platform wallet) gets AMOUNT and approves the escrow
    await token.mint(owner.address, AMOUNT);
    await token.connect(owner).approve(await escrow.getAddress(), AMOUNT);

    return { escrow, token, owner, buyer, seller, other };
  }

  async function fundEscrow(
    escrow: SaleEscrow,
    token: MockERC20,
    buyer: HardhatEthersSigner,
    seller: HardhatEthersSigner,
  ): Promise<bigint> {
    const tx = await escrow.openAndFund(
      "sale-1",
      buyer.address,
      seller.address,
      await token.getAddress(),
      AMOUNT,
      TERMS_HASH,
    );
    await tx.wait();
    return 1n;
  }

  // ────────────────────────────────────────────────────────────
  // 1. openAndFund
  // ────────────────────────────────────────────────────────────
  describe("openAndFund", () => {
    it("pulls AMOUNT into escrow and emits EscrowFunded", async () => {
      const { escrow, token, buyer, seller } = await deploy();
      const escrowAddr = await escrow.getAddress();

      await expect(
        escrow.openAndFund(
          "sale-1",
          buyer.address,
          seller.address,
          await token.getAddress(),
          AMOUNT,
          TERMS_HASH,
        ),
      )
        .to.emit(escrow, "EscrowFunded")
        .withArgs(1n, "sale-1", buyer.address, seller.address, AMOUNT);

      expect(await token.balanceOf(escrowAddr)).to.equal(AMOUNT);
    });

    it("stores correct escrow fields and state == Funded (1)", async () => {
      const { escrow, token, buyer, seller } = await deploy();
      const escrowId = await fundEscrow(escrow, token, buyer, seller);

      const e = await escrow.getEscrow(escrowId);
      expect(e.saleId).to.equal("sale-1");
      expect(e.buyer).to.equal(buyer.address);
      expect(e.seller).to.equal(seller.address);
      expect(e.token).to.equal(await token.getAddress());
      expect(e.amount).to.equal(AMOUNT);
      expect(e.termsHash).to.equal(TERMS_HASH);
      expect(e.state).to.equal(1); // State.Funded
    });

    it("second escrow gets id 2", async () => {
      const [owner, buyer1, seller1, buyer2, seller2] = await ethers.getSigners();

      const TokenFactory = await ethers.getContractFactory("MockERC20");
      const token = (await TokenFactory.deploy()) as MockERC20;
      await token.waitForDeployment();

      const EscrowFactory = await ethers.getContractFactory("SaleEscrow");
      const escrow = (await EscrowFactory.deploy()) as SaleEscrow;
      await escrow.waitForDeployment();
      const escrowAddr = await escrow.getAddress();
      const tokenAddr = await token.getAddress();

      await token.mint(owner.address, AMOUNT * 2n);
      await token.connect(owner).approve(escrowAddr, AMOUNT * 2n);

      const tx1 = await escrow.openAndFund("sale-1", buyer1.address, seller1.address, tokenAddr, AMOUNT, TERMS_HASH);
      await expect(tx1).to.emit(escrow, "EscrowFunded").withArgs(1n, "sale-1", buyer1.address, seller1.address, AMOUNT);

      const tx2 = await escrow.openAndFund("sale-2", buyer2.address, seller2.address, tokenAddr, AMOUNT, TERMS_HASH);
      await expect(tx2).to.emit(escrow, "EscrowFunded").withArgs(2n, "sale-2", buyer2.address, seller2.address, AMOUNT);

      expect(await token.balanceOf(escrowAddr)).to.equal(AMOUNT * 2n);
    });

    it("reverts OwnableUnauthorizedAccount for non-owner", async () => {
      const { escrow, token, buyer, seller, other } = await deploy();
      await expect(
        escrow
          .connect(other)
          .openAndFund(
            "sale-1",
            buyer.address,
            seller.address,
            await token.getAddress(),
            AMOUNT,
            TERMS_HASH,
          ),
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("reverts ERC20InsufficientAllowance and leaves no escrow row", async () => {
      const [owner, buyer, seller] = await ethers.getSigners();

      const TokenFactory = await ethers.getContractFactory("MockERC20");
      const token = (await TokenFactory.deploy()) as MockERC20;
      await token.waitForDeployment();

      const EscrowFactory = await ethers.getContractFactory("SaleEscrow");
      const escrow = (await EscrowFactory.deploy()) as SaleEscrow;
      await escrow.waitForDeployment();

      await token.mint(owner.address, AMOUNT);
      // no approve

      await expect(
        escrow.openAndFund(
          "sale-no-approve",
          buyer.address,
          seller.address,
          await token.getAddress(),
          AMOUNT,
          TERMS_HASH,
        ),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");

      await expect(escrow.escrowState(1)).to.be.revertedWith("no escrow");
    });
  });

  // ────────────────────────────────────────────────────────────
  // 2. release
  // ────────────────────────────────────────────────────────────
  describe("release", () => {
    it("sends AMOUNT to seller, emits EscrowReleased, state Released (2)", async () => {
      const { escrow, token, buyer, seller } = await deploy();
      const escrowId = await fundEscrow(escrow, token, buyer, seller);
      const escrowAddr = await escrow.getAddress();

      await expect(escrow.release(escrowId))
        .to.emit(escrow, "EscrowReleased")
        .withArgs(escrowId, seller.address, AMOUNT);

      expect(await token.balanceOf(escrowAddr)).to.equal(0n);
      expect(await token.balanceOf(seller.address)).to.equal(AMOUNT);
      expect(await escrow.escrowState(escrowId)).to.equal(2); // State.Released
    });

    it("reverts 'not funded' when called again after release", async () => {
      const { escrow, token, buyer, seller } = await deploy();
      const escrowId = await fundEscrow(escrow, token, buyer, seller);
      await escrow.release(escrowId);
      await expect(escrow.release(escrowId)).to.be.revertedWith("not funded");
    });

    it("reverts 'not funded' after refund", async () => {
      const { escrow, token, buyer, seller } = await deploy();
      const escrowId = await fundEscrow(escrow, token, buyer, seller);
      await escrow.refund(escrowId);
      await expect(escrow.release(escrowId)).to.be.revertedWith("not funded");
    });

    it("reverts OwnableUnauthorizedAccount for non-owner", async () => {
      const { escrow, token, buyer, seller, other } = await deploy();
      const escrowId = await fundEscrow(escrow, token, buyer, seller);
      await expect(
        escrow.connect(other).release(escrowId),
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });
  });

  // ────────────────────────────────────────────────────────────
  // 3. refund
  // ────────────────────────────────────────────────────────────
  describe("refund", () => {
    it("sends AMOUNT to buyer, emits EscrowRefunded, state Refunded (3)", async () => {
      const { escrow, token, buyer, seller } = await deploy();
      const escrowId = await fundEscrow(escrow, token, buyer, seller);
      const escrowAddr = await escrow.getAddress();

      await expect(escrow.refund(escrowId))
        .to.emit(escrow, "EscrowRefunded")
        .withArgs(escrowId, buyer.address, AMOUNT);

      expect(await token.balanceOf(escrowAddr)).to.equal(0n);
      expect(await token.balanceOf(buyer.address)).to.equal(AMOUNT);
      expect(await escrow.escrowState(escrowId)).to.equal(3); // State.Refunded
    });

    it("reverts 'not funded' when called again after refund", async () => {
      const { escrow, token, buyer, seller } = await deploy();
      const escrowId = await fundEscrow(escrow, token, buyer, seller);
      await escrow.refund(escrowId);
      await expect(escrow.refund(escrowId)).to.be.revertedWith("not funded");
    });

    it("reverts 'not funded' after release", async () => {
      const { escrow, token, buyer, seller } = await deploy();
      const escrowId = await fundEscrow(escrow, token, buyer, seller);
      await escrow.release(escrowId);
      await expect(escrow.refund(escrowId)).to.be.revertedWith("not funded");
    });

    it("reverts OwnableUnauthorizedAccount for non-owner", async () => {
      const { escrow, token, buyer, seller, other } = await deploy();
      const escrowId = await fundEscrow(escrow, token, buyer, seller);
      await expect(
        escrow.connect(other).refund(escrowId),
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });
  });

  // ────────────────────────────────────────────────────────────
  // 4. view helpers on missing escrow
  // ────────────────────────────────────────────────────────────
  describe("getEscrow / escrowState on non-existent id", () => {
    it("getEscrow(99) reverts 'no escrow'", async () => {
      const { escrow } = await deploy();
      await expect(escrow.getEscrow(99)).to.be.revertedWith("no escrow");
    });

    it("escrowState(99) reverts 'no escrow'", async () => {
      const { escrow } = await deploy();
      await expect(escrow.escrowState(99)).to.be.revertedWith("no escrow");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails (contract not found)**

Run: `npx hardhat test test/SaleEscrow.test.ts`
Expected: FAIL — `NomicLabsHardhatPluginError: Contract SaleEscrow not found`

- [ ] **Step 3: Write `contracts/SaleEscrow.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SaleEscrow
/// @notice Holds a property sale payment in an ERC-20 stablecoin until the
///         platform owner releases it to the seller or refunds it to the buyer.
///         Custodial: only the platform owner moves funds, mirroring
///         LeaseEscrow's trust model. The buyer pays the platform off-chain;
///         the owner funds the on-chain escrow.
/// @dev    `token` MUST be a standard, non-fee-on-transfer, non-rebasing ERC-20
///         stablecoin. The contract pays out the stored `amount` exactly; a
///         fee-on-transfer token would under-fund the shared balance and cause
///         later transfers to revert.
contract SaleEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State { None, Funded, Released, Refunded }

    struct Escrow {
        string saleId;
        address buyer;
        address seller;
        address token;
        uint256 amount;
        bytes32 termsHash;
        State state;
    }

    uint256 private _nextEscrowId = 1;
    // Invariant: the contract's token balance must always cover the sum of all
    //            outstanding (non-terminal) escrow obligations.
    mapping(uint256 => Escrow) private _escrows;

    event EscrowFunded(uint256 indexed escrowId, string saleId, address indexed buyer, address indexed seller, uint256 amount);
    event EscrowReleased(uint256 indexed escrowId, address indexed seller, uint256 amount);
    event EscrowRefunded(uint256 indexed escrowId, address indexed buyer, uint256 amount);

    constructor() Ownable(msg.sender) {}

    /// @notice Open a new sale escrow and pull `amount` tokens from the caller.
    /// @dev    Caller (owner) must have pre-approved at least `amount` to this contract.
    ///         `token` must be a standard non-fee-on-transfer ERC-20.
    function openAndFund(
        string calldata saleId,
        address buyer,
        address seller,
        address token,
        uint256 amount,
        bytes32 termsHash
    ) external onlyOwner nonReentrant returns (uint256 escrowId) {
        require(buyer != address(0) && seller != address(0), "zero party");
        require(token != address(0), "zero token");
        escrowId = _nextEscrowId++;
        _escrows[escrowId] = Escrow({
            saleId: saleId,
            buyer: buyer,
            seller: seller,
            token: token,
            amount: amount,
            termsHash: termsHash,
            state: State.Funded
        });
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit EscrowFunded(escrowId, saleId, buyer, seller, amount);
    }

    /// @notice Release the escrowed funds to the seller (sale completed).
    function release(uint256 escrowId) external onlyOwner nonReentrant {
        Escrow storage e = _escrows[escrowId];
        require(e.state == State.Funded, "not funded");
        e.state = State.Released;
        IERC20(e.token).safeTransfer(e.seller, e.amount);
        emit EscrowReleased(escrowId, e.seller, e.amount);
    }

    /// @notice Refund the escrowed funds to the buyer (sale cancelled).
    function refund(uint256 escrowId) external onlyOwner nonReentrant {
        Escrow storage e = _escrows[escrowId];
        require(e.state == State.Funded, "not funded");
        e.state = State.Refunded;
        IERC20(e.token).safeTransfer(e.buyer, e.amount);
        emit EscrowRefunded(escrowId, e.buyer, e.amount);
    }

    /// @notice Return the full escrow record. Reverts for non-existent ids.
    function getEscrow(uint256 escrowId) external view returns (Escrow memory) {
        Escrow memory e = _escrows[escrowId];
        require(e.state != State.None, "no escrow");
        return e;
    }

    /// @notice Return the current state. Reverts for non-existent ids.
    function escrowState(uint256 escrowId) external view returns (State) {
        State s = _escrows[escrowId].state;
        require(s != State.None, "no escrow");
        return s;
    }
}
```

- [ ] **Step 4: Compile to generate TypeChain types**

Run: `npm run compile`
Expected: `Compiled N Solidity file(s) successfully` (no errors)

- [ ] **Step 5: Run SaleEscrow tests to verify they pass**

Run: `npx hardhat test test/SaleEscrow.test.ts`
Expected: All tests PASS (green)

- [ ] **Step 6: Run full test suite to confirm no regressions**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 7: Commit contract + tests**

```bash
git add contracts/SaleEscrow.sol test/SaleEscrow.test.ts
git commit -m "feat(contracts): added SaleEscrow for purchase transactions"
```

---

### Task 2: Update deploy script + ABI export + verify

**Files:**
- Modify: `scripts/deploy.ts`
- Modify: `scripts/export-abi.ts`

**Interfaces:**
- Consumes: `SaleEscrow` contract from Task 1
- Produces: `deployments/<network>.json` with `saleEscrow` key; `abi/SaleEscrow.json`

- [ ] **Step 1: Update `scripts/deploy.ts` to deploy SaleEscrow**

After the LeaseEscrow block (line 35), add:

```typescript
  const SaleEscrowFactory = await ethers.getContractFactory("SaleEscrow");
  const saleEscrow = await SaleEscrowFactory.deploy();
  await saleEscrow.waitForDeployment();
  record.saleEscrow = await saleEscrow.getAddress();
  console.log(`SaleEscrow deployed to ${record.saleEscrow} on "${network.name}"`);
```

- [ ] **Step 2: Update `scripts/export-abi.ts` to include SaleEscrow**

Add to the `targets` array:

```typescript
  { sol: "SaleEscrow.sol", name: "SaleEscrow" },
```

- [ ] **Step 3: Deploy locally to verify deploy script works**

Run: `npx hardhat run scripts/deploy.ts`
Expected: console shows `SaleEscrow deployed to 0x...` and `deployments/hardhat.json` contains `saleEscrow`.

- [ ] **Step 4: Export ABIs**

Run: `npm run export-abi`
Expected: `ABI exported to abi/SaleEscrow.json` in console output; file exists.

- [ ] **Step 5: Commit deploy + ABI changes**

```bash
git add scripts/deploy.ts scripts/export-abi.ts
git commit -m "feat(deploy): wired SaleEscrow into deploy script and ABI export"
```
