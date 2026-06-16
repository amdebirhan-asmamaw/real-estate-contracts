import { expect } from "chai";
import { ethers } from "hardhat";
import { LeaseEscrow, MockERC20 } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const RENT = ethers.parseUnits("1000", 18);
const DEPOSIT = ethers.parseUnits("1500", 18);
const TERMS_HASH = ("0x" + "ab".repeat(32)) as `0x${string}`;

describe("LeaseEscrow", () => {
  async function deploy(): Promise<{
    escrow: LeaseEscrow;
    token: MockERC20;
    owner: HardhatEthersSigner;
    landlord: HardhatEthersSigner;
    tenant: HardhatEthersSigner;
    other: HardhatEthersSigner;
  }> {
    const [owner, landlord, tenant, other] = await ethers.getSigners();

    const TokenFactory = await ethers.getContractFactory("MockERC20");
    const token = (await TokenFactory.deploy()) as MockERC20;
    await token.waitForDeployment();

    const EscrowFactory = await ethers.getContractFactory("LeaseEscrow");
    const escrow = (await EscrowFactory.deploy()) as LeaseEscrow;
    await escrow.waitForDeployment();
    await escrow.setTokenAllowed(await token.getAddress(), true);

    // Owner (platform wallet) gets RENT+DEPOSIT and approves the escrow
    await token.mint(owner.address, RENT + DEPOSIT);
    await token.connect(owner).approve(await escrow.getAddress(), RENT + DEPOSIT);

    return { escrow, token, owner, landlord, tenant, other };
  }

  // Helper: open+fund a lease-1 escrow and return its id (always 1 on a fresh deploy)
  async function fundEscrow(
    escrow: LeaseEscrow,
    token: MockERC20,
    landlord: HardhatEthersSigner,
    tenant: HardhatEthersSigner,
  ): Promise<bigint> {
    const tx = await escrow.openAndFund(
      "lease-1",
      landlord.address,
      tenant.address,
      await token.getAddress(),
      RENT,
      DEPOSIT,
      TERMS_HASH,
    );
    await tx.wait();
    return 1n;
  }

  // ────────────────────────────────────────────────────────────
  // 1. openAndFund
  // ────────────────────────────────────────────────────────────
  describe("openAndFund", () => {
    it("pulls rent+deposit into escrow and emits EscrowFunded", async () => {
      const { escrow, token, owner, landlord, tenant } = await deploy();
      const escrowAddr = await escrow.getAddress();

      await expect(
        escrow.openAndFund(
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
    });

    it("stores correct escrow fields and state == Funded (1)", async () => {
      const { escrow, token, landlord, tenant } = await deploy();
      const escrowId = await fundEscrow(escrow, token, landlord, tenant);

      const e = await escrow.getEscrow(escrowId);
      expect(e.leaseId).to.equal("lease-1");
      expect(e.landlord).to.equal(landlord.address);
      expect(e.tenant).to.equal(tenant.address);
      expect(e.token).to.equal(await token.getAddress());
      expect(e.rentAmount).to.equal(RENT);
      expect(e.depositAmount).to.equal(DEPOSIT);
      expect(e.termsHash).to.equal(TERMS_HASH);
      expect(e.state).to.equal(1); // State.Funded
    });

    it("reverts when non-owner calls openAndFund", async () => {
      const { escrow, token, landlord, tenant, other } = await deploy();
      await expect(
        escrow
          .connect(other)
          .openAndFund(
            "lease-1",
            landlord.address,
            tenant.address,
            await token.getAddress(),
            RENT,
            DEPOSIT,
            TERMS_HASH,
          ),
      ).to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");
    });

    it("reverts when the token has not been allowlisted", async () => {
      const [owner, landlord, tenant] = await ethers.getSigners();
      const TokenFactory = await ethers.getContractFactory("MockERC20");
      const token = (await TokenFactory.deploy()) as MockERC20;
      await token.waitForDeployment();

      const EscrowFactory = await ethers.getContractFactory("LeaseEscrow");
      const escrow = (await EscrowFactory.deploy()) as LeaseEscrow;
      await escrow.waitForDeployment();
      await token.mint(owner.address, RENT + DEPOSIT);
      await token.approve(await escrow.getAddress(), RENT + DEPOSIT);

      await expect(
        escrow.openAndFund(
          "lease-1",
          landlord.address,
          tenant.address,
          await token.getAddress(),
          RENT,
          DEPOSIT,
          TERMS_HASH,
        ),
      ).to.be.revertedWith("token not allowed");
    });
  });

  // ────────────────────────────────────────────────────────────
  // 2. activate
  // ────────────────────────────────────────────────────────────
  describe("activate", () => {
    it("releases RENT to landlord, emits RentReleased, escrow balance == DEPOSIT, state == Active (2)", async () => {
      const { escrow, token, landlord, tenant } = await deploy();
      const escrowId = await fundEscrow(escrow, token, landlord, tenant);
      const escrowAddr = await escrow.getAddress();

      await expect(escrow.activate(escrowId))
        .to.emit(escrow, "RentReleased")
        .withArgs(escrowId, landlord.address, RENT);

      expect(await token.balanceOf(escrowAddr)).to.equal(DEPOSIT);
      expect(await token.balanceOf(landlord.address)).to.equal(RENT);
      expect(await escrow.escrowState(escrowId)).to.equal(2); // State.Active
    });

    it("reverts 'not funded' when called twice", async () => {
      const { escrow, token, landlord, tenant } = await deploy();
      const escrowId = await fundEscrow(escrow, token, landlord, tenant);
      await escrow.activate(escrowId);

      await expect(escrow.activate(escrowId)).to.be.revertedWith("not funded");
    });

    it("reverts when non-owner calls activate", async () => {
      const { escrow, token, landlord, tenant, other } = await deploy();
      const escrowId = await fundEscrow(escrow, token, landlord, tenant);
      await expect(
        escrow.connect(other).activate(escrowId),
      ).to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");
    });
  });

  // ────────────────────────────────────────────────────────────
  // 3. cancel
  // ────────────────────────────────────────────────────────────
  describe("cancel", () => {
    it("refunds RENT+DEPOSIT to tenant before activation, emits EscrowRefunded, balance 0, state Closed (3)", async () => {
      const { escrow, token, landlord, tenant } = await deploy();
      const escrowId = await fundEscrow(escrow, token, landlord, tenant);
      const escrowAddr = await escrow.getAddress();

      await expect(escrow.cancel(escrowId))
        .to.emit(escrow, "EscrowRefunded")
        .withArgs(escrowId, tenant.address, RENT + DEPOSIT);

      expect(await token.balanceOf(escrowAddr)).to.equal(0n);
      expect(await token.balanceOf(tenant.address)).to.equal(RENT + DEPOSIT);
      expect(await escrow.escrowState(escrowId)).to.equal(3); // State.Closed
    });

    it("reverts 'not funded' after activation", async () => {
      const { escrow, token, landlord, tenant } = await deploy();
      const escrowId = await fundEscrow(escrow, token, landlord, tenant);
      await escrow.activate(escrowId);

      await expect(escrow.cancel(escrowId)).to.be.revertedWith("not funded");
    });
  });

  // ────────────────────────────────────────────────────────────
  // 4. releaseDeposit
  // ────────────────────────────────────────────────────────────
  describe("releaseDeposit", () => {
    it("sends DEPOSIT to landlord after activation, state Closed; landlord total == RENT+DEPOSIT", async () => {
      const { escrow, token, landlord, tenant } = await deploy();
      const escrowId = await fundEscrow(escrow, token, landlord, tenant);
      await escrow.activate(escrowId); // landlord gets RENT here

      await expect(escrow.releaseDeposit(escrowId))
        .to.emit(escrow, "DepositReleased")
        .withArgs(escrowId, landlord.address, DEPOSIT);

      expect(await token.balanceOf(landlord.address)).to.equal(RENT + DEPOSIT);
      expect(await escrow.escrowState(escrowId)).to.equal(3); // State.Closed
    });

    it("reverts 'not active' when state is only Funded (not yet activated)", async () => {
      const { escrow, token, landlord, tenant } = await deploy();
      const escrowId = await fundEscrow(escrow, token, landlord, tenant);

      await expect(escrow.releaseDeposit(escrowId)).to.be.revertedWith("not active");
    });
  });

  // ────────────────────────────────────────────────────────────
  // 5. refundDeposit
  // ────────────────────────────────────────────────────────────
  describe("refundDeposit", () => {
    it("sends DEPOSIT to tenant after activation; landlord has RENT, tenant has DEPOSIT", async () => {
      const { escrow, token, landlord, tenant } = await deploy();
      const escrowId = await fundEscrow(escrow, token, landlord, tenant);
      await escrow.activate(escrowId); // landlord gets RENT

      await expect(escrow.refundDeposit(escrowId))
        .to.emit(escrow, "DepositRefunded")
        .withArgs(escrowId, tenant.address, DEPOSIT);

      expect(await token.balanceOf(landlord.address)).to.equal(RENT);
      expect(await token.balanceOf(tenant.address)).to.equal(DEPOSIT);
    });

    it("reverts 'not active' when state is only Funded (not yet activated)", async () => {
      const { escrow, token, landlord, tenant } = await deploy();
      const escrowId = await fundEscrow(escrow, token, landlord, tenant);

      await expect(escrow.refundDeposit(escrowId)).to.be.revertedWith("not active");
    });
  });

  // ────────────────────────────────────────────────────────────
  // 6. view helpers on missing escrow
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
      await escrow.setTokenAllowed(tokenAddr, true);

      // Fund owner with tokens for both escrows and approve
      await token.mint(owner.address, (RENT + DEPOSIT) * 2n);
      await token
        .connect(owner)
        .approve(escrowAddr, (RENT + DEPOSIT) * 2n);

      // Open escrow #1 — expect id 1
      const tx1 = await escrow.openAndFund(
        "lease-1",
        landlord1.address,
        tenant1.address,
        tokenAddr,
        RENT,
        DEPOSIT,
        TERMS_HASH,
      );
      await expect(tx1)
        .to.emit(escrow, "EscrowFunded")
        .withArgs(1n, "lease-1", landlord1.address, tenant1.address, RENT, DEPOSIT);

      // Open escrow #2 — expect id 2
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

      // Interleaved: activate #1 → landlord1 gets RENT
      await escrow.activate(1n);
      expect(await token.balanceOf(landlord1.address)).to.equal(RENT);
      // remaining in contract: escrow1.deposit + escrow2.(rent+deposit)
      expect(await token.balanceOf(escrowAddr)).to.equal(DEPOSIT + RENT + DEPOSIT);

      // activate #2 → landlord2 gets RENT
      await escrow.activate(2n);
      expect(await token.balanceOf(landlord2.address)).to.equal(RENT);
      // remaining: only the two deposits
      expect(await token.balanceOf(escrowAddr)).to.equal(DEPOSIT * 2n);

      // refundDeposit #1 → deposit goes to tenant1
      await escrow.refundDeposit(1n);
      expect(await token.balanceOf(tenant1.address)).to.equal(DEPOSIT);
      expect(await escrow.escrowState(1n)).to.equal(3); // State.Closed

      // releaseDeposit #2 → deposit goes to landlord2
      await escrow.releaseDeposit(2n);
      expect(await token.balanceOf(landlord2.address)).to.equal(RENT + DEPOSIT);
      expect(await escrow.escrowState(2n)).to.equal(3); // State.Closed

      // Contract is now empty
      expect(await token.balanceOf(escrowAddr)).to.equal(0n);
    });
  });

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
      await escrow.setTokenAllowed(await token.getAddress(), true);

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

      // No escrow row should have been persisted — the state write happens before
      // the token transfer, but the revert rolls back the entire transaction
      await expect(escrow.escrowState(1)).to.be.revertedWith("no escrow");
    });
  });

  // ────────────────────────────────────────────────────────────
  // 9. non-operator access control: cancel, releaseDeposit, refundDeposit
  // ────────────────────────────────────────────────────────────
  describe("non-owner access control", () => {
    it("cancel reverts with AccessControlUnauthorizedAccount for non-operator", async () => {
      const { escrow, token, landlord, tenant, other } = await deploy();
      const escrowId = await fundEscrow(escrow, token, landlord, tenant);
      await expect(
        escrow.connect(other).cancel(escrowId),
      ).to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");
    });

    it("releaseDeposit reverts with AccessControlUnauthorizedAccount for non-operator", async () => {
      const { escrow, token, landlord, tenant, other } = await deploy();
      const escrowId = await fundEscrow(escrow, token, landlord, tenant);
      await escrow.activate(escrowId); // must be Active for releaseDeposit to be meaningful
      await expect(
        escrow.connect(other).releaseDeposit(escrowId),
      ).to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");
    });

    it("refundDeposit reverts with AccessControlUnauthorizedAccount for non-operator", async () => {
      const { escrow, token, landlord, tenant, other } = await deploy();
      const escrowId = await fundEscrow(escrow, token, landlord, tenant);
      await escrow.activate(escrowId);
      await expect(
        escrow.connect(other).refundDeposit(escrowId),
      ).to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");
    });
  });

  describe("operator and pause controls", () => {
    it("lets the owner delegate escrow operations", async () => {
      const { escrow, token, landlord, tenant, other } = await deploy();
      const escrowAddr = await escrow.getAddress();
      await token.mint(other.address, RENT + DEPOSIT);
      await token.connect(other).approve(escrowAddr, RENT + DEPOSIT);

      await expect(escrow.setEscrowOperator(other.address, true))
        .to.emit(escrow, "EscrowOperatorUpdated")
        .withArgs(other.address, true);

      await escrow
        .connect(other)
        .openAndFund(
          "lease-operator",
          landlord.address,
          tenant.address,
          await token.getAddress(),
          RENT,
          DEPOSIT,
          TERMS_HASH,
        );

      expect(await escrow.escrowState(1)).to.equal(1);
    });

    it("blocks state-changing escrow operations while paused", async () => {
      const { escrow, token, landlord, tenant } = await deploy();
      await escrow.pause();

      await expect(
        escrow.openAndFund(
          "lease-paused",
          landlord.address,
          tenant.address,
          await token.getAddress(),
          RENT,
          DEPOSIT,
          TERMS_HASH,
        ),
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");

      await escrow.unpause();
      await fundEscrow(escrow, token, landlord, tenant);
      expect(await escrow.escrowState(1)).to.equal(1);
    });
  });
});
