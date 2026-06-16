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

  // A mock stablecoin is only useful off mainnet, for local/testnet demos.
  if (network.name !== "mainnet") {
    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy();
    await token.waitForDeployment();
    record.mockToken = await token.getAddress();
    console.log(`MockERC20 deployed to ${record.mockToken} on "${network.name}"`);
  }

  const Escrow = await ethers.getContractFactory("LeaseEscrow");
  const escrow = await Escrow.deploy();
  await escrow.waitForDeployment();
  record.leaseEscrow = await escrow.getAddress();
  console.log(`LeaseEscrow deployed to ${record.leaseEscrow} on "${network.name}"`);

  const escrowToken = process.env.ESCROW_TOKEN_ADDRESS || record.mockToken;
  if (escrowToken) {
    await (await escrow.setTokenAllowed(escrowToken, true)).wait();
    record.escrowToken = escrowToken;
    console.log(`LeaseEscrow allowlisted token ${escrowToken}`);
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
