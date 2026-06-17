import * as fs from "fs";
import * as path from "path";

// Copies compiled ABIs out of artifacts/ into abi/ so the backend (or any
// consumer) can import clean ABIs without the full artifact.
const targets = [
  { sol: "PropertyTitle.sol", name: "PropertyTitle" },
  { sol: "LeaseEscrow.sol", name: "LeaseEscrow" },
  { sol: "mocks/MockERC20.sol", name: "MockERC20" },
  { sol: "SaleEscrow.sol", name: "SaleEscrow" },
];

const outDir = path.join(__dirname, "..", "abi");
fs.mkdirSync(outDir, { recursive: true });

for (const t of targets) {
  const artifactPath = path.join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    t.sol,
    `${t.name}.json`,
  );
  if (!fs.existsSync(artifactPath)) {
    console.error(`Artifact not found for ${t.name} — run \`npm run compile\` first.`);
    process.exit(1);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  fs.writeFileSync(
    path.join(outDir, `${t.name}.json`),
    JSON.stringify(artifact.abi, null, 2),
  );
  console.log(`ABI exported to abi/${t.name}.json`);
}
