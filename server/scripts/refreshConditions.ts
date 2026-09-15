import { refreshConditions } from "../conditions";
import { evaluateAlerts } from "../push";
import { pool } from "../db";

async function main() {
  const result = await refreshConditions(pool, {
    force: process.argv.includes("--force"),
  });
  console.log(JSON.stringify(result, null, 2));

  // Proactive alerts ride the refresh job: same cadence, same failure
  // isolation. A dispatch error must not flip the refresh exit code, but it
  // is still surfaced for ops instead of being swallowed.
  try {
    const alerts = await evaluateAlerts(pool);
    console.log(
      `Alerts: ${alerts.dispatched} dispatched, ${alerts.duplicates} duplicates, ${alerts.suppressed} suppressed`,
    );
    for (const failure of alerts.errors) {
      console.error(`Alert ${failure.source} failed: ${failure.error}`);
    }
  } catch (error) {
    console.error(
      `Alert evaluation failed: ${
        error instanceof Error ? error.message : "alert_evaluator_error"
      }`,
    );
  }

  if (result.failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
