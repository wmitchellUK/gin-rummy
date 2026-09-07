import { describe, expect, it } from "vitest";

import { findMigrationDrift } from "../../../scripts/check-supabase-migration-parity.cjs";

describe("Supabase migration parity check", () => {
  it("accepts matching local and remote histories", () => {
    expect(findMigrationDrift({
      migrations: [
        { local: "0014", remote: "0014", time: "0014" },
        { local: "0015", remote: "0015", time: "0015" },
      ],
    })).toEqual([]);
  });

  it("reports a local migration missing from production", () => {
    expect(findMigrationDrift({
      migrations: [{ local: "0014", remote: "", time: "0014" }],
    })).toEqual([{ local: "0014", remote: "" }]);
  });

  it("reports a production migration missing locally", () => {
    expect(findMigrationDrift({
      migrations: [{ local: "", remote: "0014", time: "0014" }],
    })).toEqual([{ local: "", remote: "0014" }]);
  });

  it("rejects malformed Supabase output", () => {
    expect(() => findMigrationDrift({ message: "Finished" })).toThrow(
      "Supabase migration output did not contain a migrations array.",
    );
  });
});
