import * as StellarSdk from "@stellar/stellar-sdk";
import { Server, Api as RpcApi } from "@stellar/stellar-sdk/rpc";
import { PAYMAGE_AUDITOR_DISCLOSURE_KEY_ID, PAYMAGE_TESTNET_EMPLOYEES } from "../lib/protocol/paymage";
import { buildMerkleTree, computeCommitment } from "../lib/zk/merkleTree";
import { buildPayrollSlots, buildZkProofPrivateInputs, computeCommitmentId } from "../lib/zk/payrollInputs";
import { buildPayrollCircuitInputFromProofRequest } from "../lib/zk/payrollCircuitInput";
import { deriveViewKey, encryptSalaryBlob, serializeEncryptedPayload } from "../lib/zk/encryption";
import { toSorobanScValsFromRealProof } from "../lib/zk/serialize";
import { submitAndConfirmSorobanTransaction } from "../lib/stellar/transactions";

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const PAYROLL_CONTRACT = process.env.NEXT_PUBLIC_PAYROLL_CONTRACT!;
const PROVER_URL = process.env.NEXT_PUBLIC_PAYROLL_PROVER_URL!;
const SECRET_KEY = process.env.E2E_STELLAR_SECRET_KEY!;
const DASHBOARD_ORIGIN = process.env.PAYMAGE_ORIGIN ?? "https://paymage.vercel.app";

if (!PAYROLL_CONTRACT || !PROVER_URL || !SECRET_KEY) {
  throw new Error("NEXT_PUBLIC_PAYROLL_CONTRACT, NEXT_PUBLIC_PAYROLL_PROVER_URL, and E2E_STELLAR_SECRET_KEY are required");
}

async function simulateContractCall(
  server: Server,
  source: StellarSdk.Account,
  method: string,
) {
  const contract = new StellarSdk.Contract(PAYROLL_CONTRACT);
  const tx = new StellarSdk.TransactionBuilder(source, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (RpcApi.isSimulationError(sim)) throw new Error(sim.error);
  return sim.result?.retval ? StellarSdk.scValToNative(sim.result.retval) : null;
}

async function uploadEncryptedPayload(data: Uint8Array) {
  const response = await fetch(`${DASHBOARD_ORIGIN}/api/ipfs/upload`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: Buffer.from(data),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`IPFS upload failed: ${JSON.stringify(body)}`);
  }
  return body.cid as string;
}

async function main() {
  const keypair = StellarSdk.Keypair.fromSecret(SECRET_KEY);
  const server = new Server(RPC_URL);
  const source = await server.getAccount(keypair.publicKey());
  const currentPeriod = Number(await simulateContractCall(server, source, "get_current_period"));
  const periodId = String(currentPeriod + 1);

  const employees = PAYMAGE_TESTNET_EMPLOYEES.filter((employee) => employee.isActive);
  const slots = await buildPayrollSlots(employees);
  const tree = await buildMerkleTree(slots, 10, 10);
  const totalAmount = String(employees.reduce((sum, employee) => sum + employee.salary, 0));

  const proofRequest = {
    privateInputs: buildZkProofPrivateInputs(slots),
    publicInputs: {
      merkleRoot: tree.root,
      totalPayrollAmount: totalAmount,
      payrollPeriodId: periodId,
    },
  };
  const inputsJson = await buildPayrollCircuitInputFromProofRequest(proofRequest);

  console.log(`requesting proof for period ${periodId}, root ${tree.root}`);
  const proofResponse = await fetch(PROVER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inputsJson, publicInputs: proofRequest.publicInputs }),
  });
  const proofPayload = await proofResponse.json();
  if (!proofResponse.ok) {
    throw new Error(`Prover failed: ${JSON.stringify(proofPayload)}`);
  }
  const proof = proofPayload.data ?? proofPayload;

  const viewKey = await deriveViewKey(PAYMAGE_AUDITOR_DISCLOSURE_KEY_ID);
  const ipfsCids = [];
  for (const slot of slots) {
    const encrypted = await encryptSalaryBlob(slot.sourceEmployeeId, slot.salaryAmount, slot.salt, viewKey);
    const commitment = await computeCommitment(slot.employeeId, slot.salaryAmount, slot.salt);
    const commitmentId = await computeCommitmentId(commitment);
    const ipfsCid = await uploadEncryptedPayload(serializeEncryptedPayload(encrypted));
    ipfsCids.push({ commitmentId, ipfsCid });
  }

  console.log(`uploaded ${ipfsCids.length} encrypted blobs`);
  const args = toSorobanScValsFromRealProof(proof, ipfsCids);
  const contract = new StellarSdk.Contract(PAYROLL_CONTRACT);
  const tx = new StellarSdk.TransactionBuilder(await server.getAccount(keypair.publicKey()), {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("run_payroll", ...args))
    .setTimeout(180)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (RpcApi.isSimulationError(sim)) throw new Error(`Simulation failed: ${sim.error}`);
  const prepared = StellarSdk.rpc.assembleTransaction(tx, sim).build();
  prepared.sign(keypair);
  const result = await submitAndConfirmSorobanTransaction(server, prepared, {
    maxAttempts: 60,
    pollMs: 1000,
  });
  console.log(JSON.stringify({ txHash: result.hash, periodId, ipfsCids }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
