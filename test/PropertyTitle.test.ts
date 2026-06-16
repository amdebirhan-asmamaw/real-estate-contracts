import { expect } from "chai";
import { ethers } from "hardhat";

describe("PropertyTitle", () => {
  async function deploy() {
    const [owner, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("PropertyTitle");
    const contract = await Factory.deploy();
    await contract.waitForDeployment();
    return { contract, owner, other };
  }

  it("mints a title anchoring the listing id and document hash", async () => {
    const { contract, other } = await deploy();
    const hash = ethers.id("ownership-document"); // 32-byte hash
    await (await contract.mintTitle(other.address, "listing-1", hash)).wait();

    expect(await contract.ownerOf(1)).to.equal(other.address);
    expect(await contract.documentHashOf(1)).to.equal(hash);
    expect(await contract.listingIdOf(1)).to.equal("listing-1");
    expect(await contract.tokenIdOfListing("listing-1")).to.equal(1);
    expect(await contract.titleStatusOf(1)).to.equal(1); // Active
  });

  it("increments token ids", async () => {
    const { contract, owner, other } = await deploy();
    const hash = ethers.id("x");
    await (await contract.mintTitle(owner.address, "a", hash)).wait();
    await (await contract.mintTitle(other.address, "b", hash)).wait();
    expect(await contract.ownerOf(1)).to.equal(owner.address);
    expect(await contract.ownerOf(2)).to.equal(other.address);
  });

  it("emits TitleMinted with the right args", async () => {
    const { contract, other } = await deploy();
    const hash = ethers.id("doc");
    await expect(contract.mintTitle(other.address, "L1", hash))
      .to.emit(contract, "TitleMinted")
      .withArgs(1, other.address, "L1", hash);
  });

  it("reverts when a non-owner tries to mint", async () => {
    const { contract, other } = await deploy();
    const hash = ethers.id("doc");
    await expect(
      contract.connect(other).mintTitle(other.address, "L1", hash),
    ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
  });

  it("reverts when minting a second title for the same listing", async () => {
    const { contract, other } = await deploy();
    const hash = ethers.id("doc");
    await contract.mintTitle(other.address, "L1", hash);

    await expect(
      contract.mintTitle(other.address, "L1", hash),
    ).to.be.revertedWithCustomError(contract, "ListingAlreadyMinted");
  });

  it("lets the owner mark, clear, and revoke title status", async () => {
    const { contract, other } = await deploy();
    const hash = ethers.id("doc");
    await contract.mintTitle(other.address, "L1", hash);

    await expect(contract.markDisputed(1, "court filing"))
      .to.emit(contract, "TitleStatusChanged")
      .withArgs(1, 2, "court filing");
    expect(await contract.titleStatusOf(1)).to.equal(2); // Disputed

    await expect(contract.clearDispute(1, "resolved"))
      .to.emit(contract, "TitleStatusChanged")
      .withArgs(1, 1, "resolved");
    expect(await contract.titleStatusOf(1)).to.equal(1); // Active

    await expect(contract.revokeTitle(1, "invalid title"))
      .to.emit(contract, "TitleStatusChanged")
      .withArgs(1, 3, "invalid title");
    expect(await contract.titleStatusOf(1)).to.equal(3); // Revoked
  });

  it("blocks invalid status transitions", async () => {
    const { contract, other } = await deploy();
    const hash = ethers.id("doc");
    await contract.mintTitle(other.address, "L1", hash);

    await expect(
      contract.clearDispute(1, "not disputed"),
    ).to.be.revertedWithCustomError(contract, "InvalidTitleStatus");
    await contract.revokeTitle(1, "invalid");
    await expect(
      contract.markDisputed(1, "too late"),
    ).to.be.revertedWithCustomError(contract, "InvalidTitleStatus");
  });

  it("reverts reading a non-existent token", async () => {
    const { contract } = await deploy();
    await expect(contract.documentHashOf(999)).to.be.reverted;
  });

  it("returns empty tokenURI by default", async () => {
    const { contract, other } = await deploy();
    const hash = ethers.id("doc");
    await contract.mintTitle(other.address, "L1", hash);
    expect(await contract.tokenURI(1)).to.equal("");
  });

  it("returns correct tokenURI after setBaseURI", async () => {
    const { contract, other } = await deploy();
    const hash = ethers.id("doc");
    await contract.mintTitle(other.address, "L1", hash);
    await contract.setBaseURI("https://api.example.com/titles/");
    expect(await contract.tokenURI(1)).to.equal("https://api.example.com/titles/1");
  });

  it("reverts when a non-owner tries to setBaseURI", async () => {
    const { contract, other } = await deploy();
    await expect(
      contract.connect(other).setBaseURI("https://evil.com/"),
    ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
  });
});
