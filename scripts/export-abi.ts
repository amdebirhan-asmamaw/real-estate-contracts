import * as fs from "fs";
import * as path from "path";

// Copies the compiled ABI out of artifacts/ into abi/PropertyTitle.json so the
// backend (or any consumer) can import a clean ABI without the full artifact.
const artifactPath = path.join(
  __dirname,
  "..",
  "artifacts",
  "contracts",
  "PropertyTitle.sol",
  "PropertyTitle.json",
);

if (!fs.existsSync(artifactPath)) {
  console.error("Artifact not found — run `npm run compile` first.");
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const outDir = path.join(__dirname, "..", "abi");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "PropertyTitle.json"),
  JSON.stringify(artifact.abi, null, 2),
);

console.log("ABI exported to abi/PropertyTitle.json");
