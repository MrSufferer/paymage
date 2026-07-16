import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3210);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const useExternalServer = Boolean(process.env.PLAYWRIGHT_BASE_URL || process.env.PLAYWRIGHT_SKIP_WEBSERVER);
const vercelBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: {
    timeout: 20_000,
  },
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL,
    extraHTTPHeaders: vercelBypassSecret
      ? {
          "x-vercel-protection-bypass": vercelBypassSecret,
          "x-vercel-set-bypass-cookie": "true",
        }
      : undefined,
    trace: "retain-on-failure",
  },
  webServer: useExternalServer
    ? undefined
    : {
        command: [
          "NEXT_PUBLIC_STELLAR_NETWORK=TESTNET",
          "NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org",
          "NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org",
          "NEXT_PUBLIC_PAYROLL_CONTRACT=CDSODUB6ZYOB5VZ4GV6MD2NAZ3RA3KZ73RVOBNZMFVXOO7CLLYWTUXNF",
          "NEXT_PUBLIC_VERIFIER_CONTRACT=CC7AXUSF4HC6IIPI4VKESI5LTKBJRRZBQ2V6J2ETZ55ZD3PMUJKUKQP2",
          "NEXT_PUBLIC_WITHDRAW_VERIFIER_CONTRACT=CCARTGQLYGE2TCFFGPNC2B4IXUZJV4Y5QZWNHX4CXEREDLVIB3XYY5DH",
          "NEXT_PUBLIC_PAYROLL_TOKEN=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
          "NEXT_PUBLIC_ZK_ENGINE=server",
          "PAYROLL_PROVER_URL=http://127.0.0.1:8788/prove",
          "SESSION_SECRET=playwright-session-secret-at-least-32-characters",
          "ADMIN_PUBLIC_KEY=GBBTKIOKPCGILWKYJASL7LL3TSITQMOVTYOL3Q5KG3Y4L7KY4BIXXXJI",
          `PORT=${port}`,
          "npm run dev",
        ].join(" "),
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
