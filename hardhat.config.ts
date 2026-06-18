import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // OpenZeppelin 5.x uses the `mcopy` opcode, which requires the Cancun EVM.
      evmVersion: "cancun",
    },
  },
  networks: {
    // `hardhat` is the in-process network used by `npm test`.
    localhost: { url: "http://127.0.0.1:8545" },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
    },
  },
  // hardhat-verify is bundled with hardhat-toolbox (already imported above).
  // Set ETHERSCAN_API_KEY in .env, then run:
  //   npx hardhat verify --network sepolia <CONTRACT_ADDRESS> [constructor args]
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
};

export default config;
