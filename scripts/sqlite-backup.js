import { config } from "../src/config.js";
import { createPersistence } from "../src/domain/persistence.js";

async function main() {
  if (!config.databaseEnabled) {
    throw new Error("Database persistence is disabled.");
  }

  if (config.databaseProvider !== "sqlite") {
    throw new Error(`Manual backup is only supported for sqlite. Current provider: ${config.databaseProvider}`);
  }

  const persistence = createPersistence({ config });
  await persistence.init();
  const status = await persistence.backupNow({ reason: "manual_script" });
  console.log(JSON.stringify(status, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
