export type StellarNetwork = "TESTNET" | "PUBLIC";

export interface FreighterWalletInfo {
  publicKey: string;
  network: StellarNetwork;
}

// ScVal is a runtime XDR value for contract calls (xdr.ScVal from @stellar/stellar-sdk).
export type ScVal = any;

export interface SorobanContractCall {
  contractId: string;
  method: string;
  args: ScVal[];
}

export interface TransactionResponse {
  hash: string;
  status: "success" | "error" | "pending";
  ledger?: number;
  resultXdr?: string;
}
