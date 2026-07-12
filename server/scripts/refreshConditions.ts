import { refreshConditions } from "../conditions";
import { pool } from "../db";

refreshConditions(pool, { force: process.argv.includes("--force") })
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (result.failed.length) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
