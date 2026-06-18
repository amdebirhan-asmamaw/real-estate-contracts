import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main(): Promise<void> {
  // Guard: mainnet requires a real stablecoin address to allowlist on the
  // escrow contracts. Deploying without one leaves them permanently broken
  // (openAndFund always reverts "token not allowed").
  if (network.name === "mainnet" && !process.env.ESCROW_TOKEN_ADDRESS) {
    throw new Error(
      "ESCROW_TOKEN_ADDRESS must be set when deploying to mainnet. " +
        "Provide the address of the ERC-20 stablecoin to allowlist on LeaseEscrow and SaleEscrow.",
    );
  }

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

  const SaleEscrowFactory = await ethers.getContractFactory("SaleEscrow");
  const saleEscrow = await SaleEscrowFactory.deploy();
  await saleEscrow.waitForDeployment();
  record.saleEscrow = await saleEscrow.getAddress();
  console.log(`SaleEscrow deployed to ${record.saleEscrow} on "${network.name}"`);

  if (escrowToken) {
    await (await saleEscrow.setTokenAllowed(escrowToken, true)).wait();
    console.log(`SaleEscrow allowlisted token ${escrowToken}`);
  }

  // Optional: delegate operator role on all three contracts to a separate wallet.
  // Set OPERATOR_ADDRESS in .env to split the admin (owner) and day-to-day
  // operator roles after deploy.
  const operatorAddress = process.env.OPERATOR_ADDRESS;
  if (operatorAddress) {
    await (await title.setTitleOperator(operatorAddress, true)).wait();
    console.log(`PropertyTitle: granted TITLE_OPERATOR_ROLE to ${operatorAddress}`);

    await (await escrow.setEscrowOperator(operatorAddress, true)).wait();
    console.log(`LeaseEscrow: granted ESCROW_OPERATOR_ROLE to ${operatorAddress}`);

    await (await saleEscrow.setSaleEscrowOperator(operatorAddress, true)).wait();
    console.log(`SaleEscrow: granted SALE_ESCROW_OPERATOR_ROLE to ${operatorAddress}`);

    record.operatorAddress = operatorAddress;
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
