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
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
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
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
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
});
