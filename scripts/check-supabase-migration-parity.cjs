"use strict";

function findMigrationDrift(payload) {
  if (!payload || !Array.isArray(payload.migrations)) {
    throw new Error("Supabase migration output did not contain a migrations array.");
  }

  return payload.migrations.flatMap((migration) => {
    const local = typeof migration?.local === "string" ? migration.local : "";
    const remote = typeof migration?.remote === "string" ? migration.remote : "";
    return local === remote ? [] : [{ local, remote }];
  });
}

function formatVersion(version) {
  return version || "missing";
}

function checkMigrationParity(input) {
  const payload = JSON.parse(input);
  const drift = findMigrationDrift(payload);
  if (drift.length === 0) {
    process.stdout.write("Local and production Supabase migrations are in sync.\n");
    return;
  }

  for (const migration of drift) {
    process.stderr.write(
      `Migration drift: local=${formatVersion(migration.local)} remote=${formatVersion(migration.remote)}\n`,
    );
  }
  process.exitCode = 1;
}

if (require.main === module) {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    try {
      checkMigrationParity(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown migration parity error.";
      process.stderr.write(`Could not check migration parity: ${message}\n`);
      process.exitCode = 1;
    }
  });
}

module.exports = { findMigrationDrift };
