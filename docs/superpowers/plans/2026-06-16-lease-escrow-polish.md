# LeaseEscrow Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply code-quality polish to LeaseEscrow.sol (NatSpec, storage-read cache) and expand the test suite with 3 new test groups (multi-escrow interleaving, allowance-revert, access-control).

**Architecture:** Two files change — `contracts/LeaseEscrow.sol` gets doc comments and a one-line refactor; `test/LeaseEscrow.test.ts` gets three new `describe` blocks appended. No new files created.

**Tech Stack:** Solidity 0.8.24, Hardhat, TypeScript, Chai, ethers v6, OpenZeppelin 5.

---

## File Map

| File | Change |
|------|--------|
| `contracts/LeaseEscrow.sol` | Add NatSpec `@dev` caveat on contract, add invariant comment on `_escrows` mapping, cache `_escrows[escrowId].state` in `escrowState` |
| `test/LeaseEscrow.test.ts` | Append describe blocks 7, 8, 9 (multi-escrow, allowance revert, access control) |

---

### Task 1: Add NatSpec caveat and invariant comment to LeaseEscrow.sol

**Files:**
- Modify: `contracts/LeaseEscrow.sol:9-33`

- [ ] **Step 1: Edit the contract-level NatSpec to add the token caveat**

In `contracts/LeaseEscrow.sol`, extend the `@notice` block (lines 9-16) to include a `@dev` warning:

```solidity
/// @title LeaseEscrow
/// @notice Holds a lease's first month's rent + security deposit in an ERC-20
///         stablecoin. First month is released to the landlord on activation;
///         the deposit is held and settled (to landlord or tenant) at lease end.
///         Custodial: only the platform owner moves funds, mirroring
///         PropertyTitle's trust model. The tenant pays the platform off-chain;
///         the owner funds the on-chain escrow.
/// @dev    `token` MUST be a standard, non-fee-on-transfer, non-rebasing ERC-20
///         stablecoin. The contract pays out the stored `rentAmount`/`depositAmount`
///         exactly; a fee-on-transfer token would under-fund the shared balance and
///         cause later transfers to revert.
```

- [ ] **Step 2: Add the pool-invariant comment on the `_escrows` mapping**

Below `uint256 private _nextEscrowId = 1;`, add a comment before the mapping:

```solidity
// Invariant: the contract's token balance must always cover the sum of all
//            outstanding (non-Closed) escrow obligations.
mapping(uint256 => Escrow) private _escrows;
```

- [ ] **Step 3: Cache the storage read in `escrowState`**

Replace the double-read in `escrowState` (lines 107-110):

```solidity
// Before (reads storage twice):
function escrowState(uint256 escrowId) external view returns (State) {
    require(_escrows[escrowId].state != State.None, "no escrow");
    return _escrows[escrowId].state;
}

// After (reads once):
function escrowState(uint256 escrowId) external view returns (State) {
    State s = _escrows[escrowId].state;
    require(s != State.None, "no escrow");
    return s;
}
```

- [ ] **Step 4: Compile to verify no Solidity errors**

Run: `npx hardhat compile`
Expected: `Compiled N Solidity files successfully` with no errors or warnings that were not there before.

---

### Task 2: Add multi-escrow interleaving test (describe block 7)

**Files:**
- Modify: `test/LeaseEscrow.test.ts` — append after the closing `});` of describe block 6

- [ ] **Step 1: Add the multi-escrow describe block**

Append inside the outer `describe("LeaseEscrow", ...)` block, after the `getEscrow / escrowState` describe:

```typescript
// ────────────────────────────────────────────────────────────
// 7. multi-escrow: id increment + interleaved settlement
// ────────────────────────────────────────────────────────────
describe("multi-escrow: id increment and interleaved settlement", () => {
  it("second escrow gets id 2 and settling in interleaved order moves correct amounts", async () => {
    const [owner, landlord1, tenant1, landlord2, tenant2] =
      await ethers.getSigners();

    const TokenFactory = await ethers.getContractFactory("MockERC20");
    const token = (await TokenFactory.deploy()) as MockERC20;
    await token.waitForDeployment();

    const EscrowFactory = await ethers.getContractFactory("LeaseEscrow");
    const escrow = (await EscrowFactory.deploy()) as LeaseEscrow;
    await escrow.waitForDeployment();
    const escrowAddr = await escrow.getAddress();
    const tokenAddr = await token.getAddress();

    // Fund owner with tokens for both escrows and approve
    await token.mint(owner.address, (RENT + DEPOSIT) * 2n);
    await token
      .connect(owner)
      .approve(escrowAddr, (RENT + DEPOSIT) * 2n);

    // Open escrow #1
    const tx1 = await escrow.openAndFund(
      "lease-1",
      landlord1.address,
      tenant1.address,
      tokenAddr,
      RENT,
      DEPOSIT,
      TERMS_HASH,
    );
    const receipt1 = await tx1.wait();
    // The EscrowFunded event carries the id; also just assert it's 1
    await expect(tx1)
      .to.emit(escrow, "EscrowFunded")
      .withArgs(1n, "lease-1", landlord1.address, tenant1.address, RENT, DEPOSIT);

    // Open escrow #2
    const tx2 = await escrow.openAndFund(
      "lease-2",
      landlord2.address,
      tenant2.address,
      tokenAddr,
      RENT,
      DEPOSIT,
      TERMS_HASH,
    );
    await expect(tx2)
      .to.emit(escrow, "EscrowFunded")
      .withArgs(2n, "lease-2", landlord2.address, tenant2.address, RENT, DEPOSIT);

    // Contract holds both pools
    expect(await token.balanceOf(escrowAddr)).to.equal((RENT + DEPOSIT) * 2n);

    // Interleaved: activate #1
    await escrow.activate(1n);
    expect(await token.balanceOf(landlord1.address)).to.equal(RENT);
    expect(await token.balanceOf(escrowAddr)).to.equal(
      RENT + DEPOSIT * 2n, // escrow1 deposit + escrow2 rent+deposit
    );

    // activate #2
    await escrow.activate(2n);
    expect(await token.balanceOf(landlord2.address)).to.equal(RENT);
    expect(await token.balanceOf(escrowAddr)).to.equal(DEPOSIT * 2n);

    // refundDeposit #1 → deposit goes to tenant1
    await escrow.refundDeposit(1n);
    expect(await token.balanceOf(tenant1.address)).to.equal(DEPOSIT);
    expect(await escrow.escrowState(1n)).to.equal(3); // Closed

    // releaseDeposit #2 → deposit goes to landlord2
    await escrow.releaseDeposit(2n);
    expect(await token.balanceOf(landlord2.address)).to.equal(RENT + DEPOSIT);
    expect(await escrow.escrowState(2n)).to.equal(3); // Closed

    // Contract is now empty
    expect(await token.balanceOf(escrowAddr)).to.equal(0n);
  });
});
```

- [ ] **Step 2: Run the new test to verify it passes**

Run: `npx hardhat test test/LeaseEscrow.test.ts --grep "multi-escrow"`
Expected: 1 passing

---

### Task 3: Add allowance-revert test (describe block 8)

**Files:**
- Modify: `test/LeaseEscrow.test.ts` — append after describe block 7

- [ ] **Step 1: Add the allowance-revert describe block**

```typescript
// ────────────────────────────────────────────────────────────
// 8. openAndFund reverts when allowance is insufficient
// ────────────────────────────────────────────────────────────
describe("openAndFund reverts on insufficient allowance", () => {
  it("reverts (ERC20InsufficientAllowance) and leaves no escrow row", async () => {
    const [owner, landlord, tenant] = await ethers.getSigners();

    const TokenFactory = await ethers.getContractFactory("MockERC20");
    const token = (await TokenFactory.deploy()) as MockERC20;
    await token.waitForDeployment();

    const EscrowFactory = await ethers.getContractFactory("LeaseEscrow");
    const escrow = (await EscrowFactory.deploy()) as LeaseEscrow;
    await escrow.waitForDeployment();

    // Mint tokens to owner but do NOT approve the escrow contract
    await token.mint(owner.address, RENT + DEPOSIT);
    // (no approve call)

    await expect(
      escrow.openAndFund(
        "lease-no-approve",
        landlord.address,
        tenant.address,
        await token.getAddress(),
        RENT,
        DEPOSIT,
        TERMS_HASH,
      ),
    ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");

    // No escrow row should have been persisted
    await expect(escrow.escrowState(1)).to.be.revertedWith("no escrow");
  });
});
```

- [ ] **Step 2: Run the new test**

Run: `npx hardhat test test/LeaseEscrow.test.ts --grep "insufficient allowance"`
Expected: 1 passing

---

### Task 4: Add access-control tests for cancel/releaseDeposit/refundDeposit (describe block 9)

**Files:**
- Modify: `test/LeaseEscrow.test.ts` — append after describe block 8

- [ ] **Step 1: Add the access-control describe block**

```typescript
// ────────────────────────────────────────────────────────────
// 9. non-owner access control: cancel, releaseDeposit, refundDeposit
// ────────────────────────────────────────────────────────────
describe("non-owner access control", () => {
  it("cancel reverts with OwnableUnauthorizedAccount for non-owner", async () => {
    const { escrow, token, landlord, tenant, other } = await deploy();
    const escrowId = await fundEscrow(escrow, token, landlord, tenant);
    await expect(
      escrow.connect(other).cancel(escrowId),
    ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
  });

  it("releaseDeposit reverts with OwnableUnauthorizedAccount for non-owner", async () => {
    const { escrow, token, landlord, tenant, other } = await deploy();
    const escrowId = await fundEscrow(escrow, token, landlord, tenant);
    await escrow.activate(escrowId); // must be Active for releaseDeposit to reach Ownable check
    await expect(
      escrow.connect(other).releaseDeposit(escrowId),
    ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
  });

  it("refundDeposit reverts with OwnableUnauthorizedAccount for non-owner", async () => {
    const { escrow, token, landlord, tenant, other } = await deploy();
    const escrowId = await fundEscrow(escrow, token, landlord, tenant);
    await escrow.activate(escrowId);
    await expect(
      escrow.connect(other).refundDeposit(escrowId),
    ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
  });
});
```

- [ ] **Step 2: Run the new tests**

Run: `npx hardhat test test/LeaseEscrow.test.ts --grep "non-owner access control"`
Expected: 3 passing

---

### Task 5: Full test run and commit

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: All tests pass (22+ tests)

- [ ] **Step 2: Commit**

```bash
git add contracts/LeaseEscrow.sol test/LeaseEscrow.test.ts
git commit -m "refactor(contracts): hardened LeaseEscrow and expanded tests

- documented the standard-ERC20 assumption and pool invariant
- cached the storage read in escrowState
- added multi-escrow, allowance-revert, and access-control tests"
```

---

## Self-Review

- All 3 spec items covered: NatSpec caveat (Task 1), storage cache (Task 1 Step 3), 3 new test groups (Tasks 2-4).
- No placeholders.
- Types consistent: `LeaseEscrow`, `MockERC20` from typechain-types, `bigint` literals `1n`/`2n`, State enum numeric values match contract.
- `fundEscrow` helper is reused from the outer scope in describe blocks 8 and 9 — those blocks share the outer `deploy()` fixture which is in scope.
- String require messages preserved (`"no escrow"`, `"not funded"`, `"not active"`).
