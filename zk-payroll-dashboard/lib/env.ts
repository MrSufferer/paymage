import { z } from "zod";
import { createLogger } from "./logger";

const log = createLogger("env");

const urlString = z
  .string()
  .refine((val) => { try { new URL(val); return true; } catch { return false; } },
    { message: "Invalid URL" }
  );

const publicEnvSchema = z.object({
  NEXT_PUBLIC_STELLAR_NETWORK: z.enum(["TESTNET", "PUBLIC"]),
  NEXT_PUBLIC_HORIZON_URL: urlString,
  NEXT_PUBLIC_SOROBAN_RPC_URL: urlString,
  NEXT_PUBLIC_PAYROLL_CONTRACT: z.string().min(1),
  NEXT_PUBLIC_VERIFIER_CONTRACT: z.string().min(1),
  NEXT_PUBLIC_WITHDRAW_VERIFIER_CONTRACT: z.string().min(1),
  NEXT_PUBLIC_PAYROLL_TOKEN: z.string().min(1),
});

const serverEnvSchema = publicEnvSchema.extend({
  SESSION_SECRET: z.string().min(32),
  ADMIN_PUBLIC_KEY: z.string().min(1),
});

const parsedPublicEnv = publicEnvSchema.safeParse({
  NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
  NEXT_PUBLIC_HORIZON_URL: process.env.NEXT_PUBLIC_HORIZON_URL,
  NEXT_PUBLIC_SOROBAN_RPC_URL: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL,
  NEXT_PUBLIC_PAYROLL_CONTRACT: process.env.NEXT_PUBLIC_PAYROLL_CONTRACT,
  NEXT_PUBLIC_VERIFIER_CONTRACT: process.env.NEXT_PUBLIC_VERIFIER_CONTRACT,
  NEXT_PUBLIC_WITHDRAW_VERIFIER_CONTRACT: process.env.NEXT_PUBLIC_WITHDRAW_VERIFIER_CONTRACT,
  NEXT_PUBLIC_PAYROLL_TOKEN: process.env.NEXT_PUBLIC_PAYROLL_TOKEN,
});

if (!parsedPublicEnv.success) {
  log.fatal("Invalid public environment variables", {
    errors: z.treeifyError(parsedPublicEnv.error),
  });
  throw new Error("Invalid public environment variables");
}

export const publicEnv = parsedPublicEnv.data;

export function getServerEnv() {
  const parsedServerEnv = serverEnvSchema.safeParse({
    ...publicEnv,
    SESSION_SECRET: process.env.SESSION_SECRET,
    ADMIN_PUBLIC_KEY: process.env.ADMIN_PUBLIC_KEY,
  });

  if (!parsedServerEnv.success) {
    log.fatal("Invalid server environment variables", {
      errors: z.treeifyError(parsedServerEnv.error),
    });
    throw new Error("Invalid server environment variables");
  }

  return parsedServerEnv.data;
}

export const env = publicEnv;
