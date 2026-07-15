import { expect, test } from "@playwright/test";
import * as StellarSdk from "@stellar/stellar-sdk";

declare global {
  interface Window {
    freighter?: boolean;
    __e2eSignStellarXdr?: (xdr: string) => Promise<string>;
  }
}

const testEmployees = Array.from({ length: 10 }, (_, index) => {
  const id = `emp_${String(index + 1).padStart(3, "0")}`;
  return {
    id,
    address: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
    name: `Test Employee ${index + 1}`,
    email: `${id}@example.com`,
    department: index % 2 === 0 ? "Engineering" : "Finance",
    salary: 50_000,
    salaryCommitment: "0x",
    isActive: true,
    status: "active",
    startDate: "2026-01-01T00:00:00Z",
  };
});

function requiredE2eKeypair(): StellarSdk.Keypair {
  const secret = process.env.E2E_STELLAR_SECRET_KEY;
  if (!secret) {
    throw new Error(
      "E2E_STELLAR_SECRET_KEY is required for Playwright wallet login. " +
      "For local testnet runs, use: E2E_STELLAR_SECRET_KEY=$(stellar keys show payroll-admin)",
    );
  }
  return StellarSdk.Keypair.fromSecret(secret);
}

test.beforeEach(async ({ page }) => {
  const keypair = requiredE2eKeypair();
  const publicKey = keypair.publicKey();

  await page.exposeFunction("__e2eSignStellarXdr", (xdr: string) => {
    const transaction = StellarSdk.TransactionBuilder.fromXDR(
      xdr,
      StellarSdk.Networks.TESTNET,
    );
    transaction.sign(keypair);
    return transaction.toXDR();
  });

  await page.route("https://soroban-testnet.stellar.org/**", (route) => route.abort());

  await page.addInitScript(({ employees, publicKey }) => {
    type FreighterRequest = {
      source?: string;
      messageId?: string | number;
      type?: string;
      transactionXdr?: string;
    };

    window.freighter = true;
    window.addEventListener("message", async (event) => {
      if (event.source !== window) return;

      const request = event.data as FreighterRequest;
      if (request.source !== "FREIGHTER_EXTERNAL_MSG_REQUEST") return;

      const base = {
        source: "FREIGHTER_EXTERNAL_MSG_RESPONSE",
        messagedId: request.messageId,
      };

      let response: Record<string, unknown>;
      switch (request.type) {
        case "REQUEST_CONNECTION_STATUS":
          response = { ...base, isConnected: true };
          break;
        case "REQUEST_ALLOWED_STATUS":
        case "SET_ALLOWED_STATUS":
          response = { ...base, isAllowed: true };
          break;
        case "REQUEST_ACCESS":
        case "REQUEST_PUBLIC_KEY":
          response = { ...base, publicKey };
          break;
        case "REQUEST_NETWORK":
          response = {
            ...base,
            network: "TESTNET",
            networkPassphrase: "Test SDF Network ; September 2015",
          };
          break;
        case "REQUEST_NETWORK_DETAILS":
          response = {
            ...base,
            networkDetails: {
              network: "TESTNET",
              networkName: "Test SDF Network",
              networkUrl: "https://horizon-testnet.stellar.org",
              networkPassphrase: "Test SDF Network ; September 2015",
              sorobanRpcUrl: "https://soroban-testnet.stellar.org",
            },
          };
          break;
        case "SUBMIT_TRANSACTION": {
          const signedTransaction = await window.__e2eSignStellarXdr?.(
            request.transactionXdr ?? "",
          );
          response = { ...base, signedTransaction, signerAddress: publicKey };
          break;
        }
        default:
          response = {
            ...base,
            apiError: { code: -1, message: `Unhandled E2E Freighter request: ${request.type}` },
          };
      }

      window.postMessage(response, window.location.origin);
    });

    window.localStorage.setItem(
      "zk-payroll-employees",
      JSON.stringify({ state: { employees, isLoading: false }, version: 0 }),
    );
    window.localStorage.setItem(
      "zk-payroll-company",
      JSON.stringify({
        state: {
          company: {
            id: "company_e2e",
            name: "PayMage Testnet Co.",
            admin: "GBBTKIOKPCGILWKYJASL7LL3TSITQMOVTYOL3Q5KG3Y4L7KY4BIXXXJI",
            treasury: "GBBTKIOKPCGILWKYJASL7LL3TSITQMOVTYOL3Q5KG3Y4L7KY4BIXXXJI",
            employeeCount: employees.length,
            isActive: true,
          },
          isLoading: false,
        },
        version: 0,
      }),
    );
    window.localStorage.setItem(
      "stellar-wallet-storage",
      JSON.stringify({
        state: {
          publicKey,
          isConnected: true,
          network: "TESTNET",
          networkPassphrase: "Test SDF Network ; September 2015",
        },
        version: 0,
      }),
    );
  }, { employees: testEmployees, publicKey });
});

test("generates a real server-backed payroll proof from the dashboard", async ({ page }) => {
  await page.goto("/payroll/execute");

  await page.getByRole("button", { name: "Start Payroll Run" }).click();
  await expect(page.getByText("Total: $500,000")).toBeVisible();
  await page.getByRole("button", { name: /continue/i }).click();

  const proofResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/zk/payroll/prove") && response.request().method() === "POST",
  );

  await page.getByRole("button", { name: "Generate Proof" }).click();

  const proofResponse = await proofResponsePromise;
  expect(proofResponse.ok()).toBe(true);
  const payload = await proofResponse.json();

  expect(payload.success).toBe(true);
  expect(payload.data.proofHex).toMatch(/^[0-9a-f]{512}$/i);
  expect(payload.data.publicInputsHex).toHaveLength(3);
  for (const input of payload.data.publicInputsHex) {
    expect(input).toMatch(/^[0-9a-f]{64}$/i);
  }
  expect(BigInt(`0x${payload.data.publicInputsHex[1]}`)).toBe(BigInt("500000"));

  await expect(page.getByText("Proof verified successfully")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit Payroll" })).toBeVisible();
});
