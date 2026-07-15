type SorobanSendResult = {
  status: string;
  hash?: string;
  errorResult?: unknown;
};

type SorobanGetResult = {
  status: string;
  returnValue?: unknown;
  resultXdr?: unknown;
};

type SorobanConfirmationServer = {
  getTransaction(hash: string): Promise<SorobanGetResult>;
};

type SorobanTransactionServer<TTransaction> = SorobanConfirmationServer & {
  sendTransaction(transaction: TTransaction): Promise<SorobanSendResult>;
};

type ConfirmOptions = {
  maxAttempts?: number;
  pollMs?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForSorobanTransaction(
  server: SorobanConfirmationServer,
  hash: string,
  { maxAttempts = 30, pollMs = 1000 }: ConfirmOptions = {},
): Promise<SorobanGetResult> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await server.getTransaction(hash);

    if (result.status === "SUCCESS") {
      return result;
    }

    if (result.status !== "NOT_FOUND") {
      throw new Error(`Transaction ${hash} failed with status ${result.status}`);
    }

    if (attempt < maxAttempts - 1) {
      await sleep(pollMs);
    }
  }

  throw new Error(`Transaction ${hash} was not confirmed after ${maxAttempts} attempts`);
}

export async function submitAndConfirmSorobanTransaction<TTransaction>(
  server: SorobanTransactionServer<TTransaction>,
  transaction: TTransaction,
  options?: ConfirmOptions,
): Promise<{ hash: string; result: SorobanGetResult }> {
  const submitResult = await server.sendTransaction(transaction);

  if (submitResult.status === "ERROR") {
    throw new Error(`Transaction submission failed: ${String(submitResult.errorResult ?? "unknown error")}`);
  }

  if (!submitResult.hash) {
    throw new Error(`Transaction submission returned no hash; status=${submitResult.status}`);
  }

  const result = await waitForSorobanTransaction(server, submitResult.hash, options);
  return { hash: submitResult.hash, result };
}
