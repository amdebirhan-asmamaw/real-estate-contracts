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

  it("reverts reading a non-existent token", async () => {
    const { contract } = await deploy();
    await expect(contract.documentHashOf(999)).to.be.reverted;
  });
});
