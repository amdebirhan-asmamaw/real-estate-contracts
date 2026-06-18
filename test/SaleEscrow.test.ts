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
    await escrow.setTokenAllowed(await token.getAddress(), true);

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
      await escrow.setTokenAllowed(tokenAddr, true);

      await token.mint(owner.address, AMOUNT * 2n);
      await token.connect(owner).approve(escrowAddr, AMOUNT * 2n);

      const tx1 = await escrow.openAndFund("sale-1", buyer1.address, seller1.address, tokenAddr, AMOUNT, TERMS_HASH);
      await expect(tx1).to.emit(escrow, "EscrowFunded").withArgs(1n, "sale-1", buyer1.address, seller1.address, AMOUNT);

      const tx2 = await escrow.openAndFund("sale-2", buyer2.address, seller2.address, tokenAddr, AMOUNT, TERMS_HASH);
      await expect(tx2).to.emit(escrow, "EscrowFunded").withArgs(2n, "sale-2", buyer2.address, seller2.address, AMOUNT);

      expect(await token.balanceOf(escrowAddr)).to.equal(AMOUNT * 2n);
    });

    it("reverts AccessControlUnauthorizedAccount for non-operator", async () => {
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
      ).to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");
    });

    it("reverts ERC20InsufficientAllowance and leaves no escrow row", async () => {
      const [owner, buyer, seller] = await ethers.getSigners();

      const TokenFactory = await ethers.getContractFactory("MockERC20");
      const token = (await TokenFactory.deploy()) as MockERC20;
      await token.waitForDeployment();

      const EscrowFactory = await ethers.getContractFactory("SaleEscrow");
      const escrow = (await EscrowFactory.deploy()) as SaleEscrow;
      await escrow.waitForDeployment();
      await escrow.setTokenAllowed(await token.getAddress(), true);

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

    it("reverts when token is not allowlisted", async () => {
      const [owner, buyer, seller] = await ethers.getSigners();

      const TokenFactory = await ethers.getContractFactory("MockERC20");
      const token = (await TokenFactory.deploy()) as MockERC20;
      await token.waitForDeployment();

      const EscrowFactory = await ethers.getContractFactory("SaleEscrow");
      const escrow = (await EscrowFactory.deploy()) as SaleEscrow;
      await escrow.waitForDeployment();

      await token.mint(owner.address, AMOUNT);
      await token.connect(owner).approve(await escrow.getAddress(), AMOUNT);

      await expect(
        escrow.openAndFund(
          "sale-no-allowlist",
          buyer.address,
          seller.address,
          await token.getAddress(),
          AMOUNT,
          TERMS_HASH,
        ),
      ).to.be.revertedWith("token not allowed");
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

    it("reverts AccessControlUnauthorizedAccount for non-operator", async () => {
      const { escrow, token, buyer, seller, other } = await deploy();
      const escrowId = await fundEscrow(escrow, token, buyer, seller);
      await expect(
        escrow.connect(other).release(escrowId),
      ).to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");
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

    it("reverts AccessControlUnauthorizedAccount for non-operator", async () => {
      const { escrow, token, buyer, seller, other } = await deploy();
      const escrowId = await fundEscrow(escrow, token, buyer, seller);
      await expect(
        escrow.connect(other).refund(escrowId),
      ).to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");
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

  describe("operator and pause controls", () => {
    it("lets the owner delegate sale escrow operations", async () => {
      const { escrow, token, buyer, seller, other } = await deploy();
      const escrowAddr = await escrow.getAddress();
      await token.mint(other.address, AMOUNT);
      await token.connect(other).approve(escrowAddr, AMOUNT);

      await expect(escrow.setSaleEscrowOperator(other.address, true))
        .to.emit(escrow, "SaleEscrowOperatorUpdated")
        .withArgs(other.address, true);

      await escrow
        .connect(other)
        .openAndFund(
          "sale-operator",
          buyer.address,
          seller.address,
          await token.getAddress(),
          AMOUNT,
          TERMS_HASH,
        );

      expect(await escrow.escrowState(1)).to.equal(1);
    });

    it("blocks state-changing sale escrow operations while paused", async () => {
      const { escrow, token, buyer, seller } = await deploy();
      await escrow.pause();

      await expect(
        escrow.openAndFund(
          "sale-paused",
          buyer.address,
          seller.address,
          await token.getAddress(),
          AMOUNT,
          TERMS_HASH,
        ),
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");

      await escrow.unpause();
      await fundEscrow(escrow, token, buyer, seller);
      expect(await escrow.escrowState(1)).to.equal(1);
    });
  });
});
