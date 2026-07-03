import { afterEach, describe, expect, it, vi } from "vitest";

const PUBLIC_ENV = {
  NEXT_PUBLIC_STELLAR_NETWORK: "TESTNET",
  NEXT_PUBLIC_HORIZON_URL: "https://horizon-testnet.stellar.org",
  NEXT_PUBLIC_SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
  NEXT_PUBLIC_PAYROLL_CONTRACT: "CCG5ELGLQ3DO6K3ZYTLYFOTS6SIZSBCKD5I6ASUROPM7MXVBN3ST3TLO",
  NEXT_PUBLIC_VERIFIER_CONTRACT: "CB6FUEHW5LXF3NV3A5BVX6NLTQHCGLHAYDC6SUGROS7A6HBKKRM5ED4H",
  NEXT_PUBLIC_WITHDRAW_VERIFIER_CONTRACT: "CCJQ4SZNN5DV7NN4KSFC4M6MFNBGPOXC6FBV6BHSJPUWIFGW4M6OQ73C",
  NEXT_PUBLIC_PAYROLL_TOKEN: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
};

describe("environment config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("loads client public env without server-only secrets", async () => {
    for (const [key, value] of Object.entries(PUBLIC_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("ADMIN_PUBLIC_KEY", "");

    const { publicEnv } = await import("@/lib/env");

    expect(publicEnv.NEXT_PUBLIC_PAYROLL_CONTRACT).toBe(
      PUBLIC_ENV.NEXT_PUBLIC_PAYROLL_CONTRACT,
    );
  });

  it("keeps server env validation strict for server-only secrets", async () => {
    for (const [key, value] of Object.entries(PUBLIC_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("ADMIN_PUBLIC_KEY", "");

    const { getServerEnv } = await import("@/lib/env");

    expect(() => getServerEnv()).toThrow("Invalid server environment variables");
  });
});
