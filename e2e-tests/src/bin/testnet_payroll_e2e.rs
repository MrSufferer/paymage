use anyhow::{Context, Result, anyhow, bail};
use num_bigint::{BigInt, Sign};
use prover::prover::Prover;
use serde_json::json;
use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};
use witness::WitnessCalculator;
use zkhash::{
    ark_ff::{BigInteger, PrimeField, Zero},
    fields::bn256::FpBN256 as Scalar,
    poseidon2::{
        poseidon2::Poseidon2,
        poseidon2_instance_bn256::{
            POSEIDON2_BN256_PARAMS_2, POSEIDON2_BN256_PARAMS_3, POSEIDON2_BN256_PARAMS_4,
        },
    },
};

const LEVELS: usize = 10;
const BATCH_SIZE: usize = 10;
const TOKEN_CONTRACT: &str = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const PAYROLL_CONTRACT: &str = "CBN3XSKSAN3TFA7HHLQY3MRVU2WXY5MRY4AKIUDTMGQ2LAVKJUXGAPXU";

struct MerkleTree {
    root: Scalar,
    proofs: Vec<(Vec<Scalar>, u64)>,
}

struct ProofOutput {
    proof_json: serde_json::Value,
    public_inputs_json: serde_json::Value,
}

fn main() -> Result<()> {
    let network = env::var("STELLAR_NETWORK").unwrap_or_else(|_| "testnet".to_string());
    let source = env::var("STELLAR_SOURCE").unwrap_or_else(|_| "payroll-admin".to_string());
    let recipient = env::var("STELLAR_RECIPIENT").unwrap_or_else(|_| source.clone());
    let payroll_contract =
        env::var("PAYROLL_CONTRACT").unwrap_or_else(|_| PAYROLL_CONTRACT.to_string());
    let token_contract = env::var("PAYROLL_TOKEN").unwrap_or_else(|_| TOKEN_CONTRACT.to_string());
    let out_dir = workspace_root().join("target/testnet-payroll-e2e");
    fs::create_dir_all(&out_dir)?;

    println!("==> Network: {network}");
    println!("==> Source: {source}");
    println!("==> Recipient: {recipient}");
    println!("==> Payroll contract: {payroll_contract}");
    println!("==> Token contract: {token_contract}");

    ensure_stellar_cli()?;

    let current_period = get_current_period(&network, &source, &payroll_contract)?;
    let payroll_period_id = current_period + 1;
    println!("==> Current period: {current_period}; proving period: {payroll_period_id}");

    let employee_id = Scalar::from(42u64);
    let salary_stroops = Scalar::from(5_000_000u64);
    let salt = Scalar::from(123_456_789u64 + payroll_period_id);
    let employees = [(employee_id, salary_stroops, salt)];
    let tree = build_merkle_tree(&employees);

    let commitment = salary_commitment(employee_id, salary_stroops, salt);
    let commitment_id = commitment_id(commitment);
    let nullifier = nullifier(commitment, salt);

    println!("==> Employee root: {}", scalar_to_decimal(&tree.root));
    println!("==> Commitment ID: {}", scalar_to_decimal(&commitment_id));
    println!("==> Nullifier: {}", scalar_to_decimal(&nullifier));

    let payroll_input =
        build_payroll_input_json(&tree, employee_id, salary_stroops, salt, payroll_period_id);
    let payroll_proof = generate_proof(
        "payroll_10_10",
        &payroll_pk_path(),
        &payroll_r1cs_path(),
        &payroll_wasm_path(),
        &payroll_input.to_string(),
        3,
    )?;

    let root_file = write_text(
        &out_dir,
        "employee_root.txt",
        &scalar_to_decimal(&tree.root),
    )?;
    let budget_file = write_text(&out_dir, "budget_cap.txt", "100000000000")?;
    let payroll_proof_file = write_json(&out_dir, "payroll_proof.json", &payroll_proof.proof_json)?;
    let payroll_public_inputs_file = write_json(
        &out_dir,
        "payroll_public_inputs.json",
        &payroll_proof.public_inputs_json,
    )?;
    let ipfs_cids_file = write_json(
        &out_dir,
        "ipfs_cids.json",
        &json!([[
            scalar_to_decimal(&commitment_id),
            ascii_hex("ipfs://demo-payroll-salary-42")
        ]]),
    )?;

    println!("==> Setting employee root on testnet...");
    run_stellar([
        "contract",
        "invoke",
        "--id",
        &payroll_contract,
        "--network",
        &network,
        "--source-account",
        &source,
        "--send",
        "yes",
        "--",
        "set_employee_root",
        "--root-file-path",
        path_str(&root_file)?,
    ])?;

    println!("==> Setting budget cap on testnet...");
    run_stellar([
        "contract",
        "invoke",
        "--id",
        &payroll_contract,
        "--network",
        &network,
        "--source-account",
        &source,
        "--send",
        "yes",
        "--",
        "set_budget_cap",
        "--cap-file-path",
        path_str(&budget_file)?,
    ])?;

    println!("==> Submitting real payroll proof to testnet...");
    run_stellar([
        "contract",
        "invoke",
        "--id",
        &payroll_contract,
        "--network",
        &network,
        "--source-account",
        &source,
        "--send",
        "yes",
        "--",
        "run_payroll",
        "--proof-file-path",
        path_str(&payroll_proof_file)?,
        "--public_inputs-file-path",
        path_str(&payroll_public_inputs_file)?,
        "--ipfs_cids-file-path",
        path_str(&ipfs_cids_file)?,
    ])?;

    let withdraw_input = build_withdraw_input_json(
        &tree,
        employee_id,
        salary_stroops,
        salt,
        commitment_id,
        nullifier,
    );
    let withdraw_proof = generate_proof(
        "payrollWithdraw_10",
        &withdraw_pk_path(),
        &withdraw_r1cs_path(),
        &withdraw_wasm_path(),
        &withdraw_input.to_string(),
        4,
    )?;

    let withdraw_proof_file =
        write_json(&out_dir, "withdraw_proof.json", &withdraw_proof.proof_json)?;
    let withdraw_public_inputs_file = write_json(
        &out_dir,
        "withdraw_public_inputs.json",
        &withdraw_proof.public_inputs_json,
    )?;

    println!("==> Submitting real withdraw proof to testnet...");
    run_stellar([
        "contract",
        "invoke",
        "--id",
        &payroll_contract,
        "--network",
        &network,
        "--source-account",
        &recipient,
        "--send",
        "yes",
        "--",
        "withdraw",
        "--proof-file-path",
        path_str(&withdraw_proof_file)?,
        "--public_inputs-file-path",
        path_str(&withdraw_public_inputs_file)?,
        "--recipient",
        &recipient,
    ])?;

    println!("==> Final current period:");
    run_stellar([
        "contract",
        "invoke",
        "--id",
        &payroll_contract,
        "--network",
        &network,
        "--source-account",
        &source,
        "--",
        "get_current_period",
    ])?;

    println!("✅ Real testnet payroll + withdraw e2e completed.");
    Ok(())
}

fn ensure_stellar_cli() -> Result<()> {
    let output = Command::new("stellar").arg("--version").output()?;
    if !output.status.success() {
        bail!("stellar CLI is not available");
    }
    Ok(())
}

fn get_current_period(network: &str, source: &str, payroll_contract: &str) -> Result<u64> {
    let output = Command::new("stellar")
        .args([
            "contract",
            "invoke",
            "--id",
            payroll_contract,
            "--network",
            network,
            "--source-account",
            source,
            "--",
            "get_current_period",
        ])
        .output()
        .context("query get_current_period")?;
    if !output.status.success() {
        bail!(
            "get_current_period failed:\nstdout={}\nstderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .rev()
        .find_map(|line| line.trim().trim_matches('"').parse::<u64>().ok())
        .ok_or_else(|| anyhow!("could not parse get_current_period output: {stdout}"))
}

fn run_stellar<I, S>(args: I) -> Result<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let output = Command::new("stellar").args(args).output()?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    print!("{stdout}");
    eprint!("{stderr}");
    if !output.status.success() {
        bail!("stellar command failed");
    }
    Ok(stdout)
}

fn generate_proof(
    label: &str,
    pk_path: &Path,
    r1cs_path: &Path,
    wasm_path: &Path,
    inputs_json: &str,
    expected_public_inputs: usize,
) -> Result<ProofOutput> {
    println!("==> Loading {label} artifacts...");
    let pk = fs::read(pk_path).with_context(|| format!("read {}", pk_path.display()))?;
    let r1cs = fs::read(r1cs_path).with_context(|| format!("read {}", r1cs_path.display()))?;
    let wasm = fs::read(wasm_path).with_context(|| format!("read {}", wasm_path.display()))?;

    println!("==> Computing {label} witness...");
    let mut witness_calc = WitnessCalculator::new(&wasm, &r1cs)?;
    let witness = witness_calc.compute_witness(inputs_json)?;

    println!("==> Generating {label} Groth16 proof...");
    let prover = Prover::new(&pk, &r1cs)?;
    let compressed = prover.prove_bytes(&witness)?;
    let uncompressed = prover.prove_bytes_uncompressed(&witness)?;
    if uncompressed.len() != 256 {
        bail!(
            "{label} proof must be 256 bytes, got {}",
            uncompressed.len()
        );
    }
    let public_inputs = prover.extract_public_inputs(&witness)?;
    if public_inputs.len() != expected_public_inputs * 32 {
        bail!(
            "{label} expected {} public inputs, got {} bytes",
            expected_public_inputs,
            public_inputs.len()
        );
    }
    if !prover.verify(&compressed, &public_inputs)? {
        bail!("{label} proof failed off-chain verification");
    }

    let proof_json = json!({
        "a": bytes_to_hex(&uncompressed[0..64]),
        "b": bytes_to_hex(&uncompressed[64..192]),
        "c": bytes_to_hex(&uncompressed[192..256]),
    });

    let public_inputs_json = json!(
        public_inputs
            .chunks_exact(32)
            .map(witness_field_le_to_decimal)
            .collect::<Vec<_>>()
    );

    Ok(ProofOutput {
        proof_json,
        public_inputs_json,
    })
}

fn build_payroll_input_json(
    tree: &MerkleTree,
    employee_id: Scalar,
    salary: Scalar,
    salt: Scalar,
    payroll_period_id: u64,
) -> serde_json::Value {
    let mut employee_ids = Vec::new();
    let mut salary_amounts = Vec::new();
    let mut salts = Vec::new();
    let mut path_elements = Vec::new();
    let mut path_indices = Vec::new();

    for i in 0..BATCH_SIZE {
        if i == 0 {
            employee_ids.push(scalar_to_decimal(&employee_id));
            salary_amounts.push(scalar_to_decimal(&salary));
            salts.push(scalar_to_decimal(&salt));
        } else {
            employee_ids.push("0".to_string());
            salary_amounts.push("0".to_string());
            salts.push("0".to_string());
        }
        let (pe, pi) = &tree.proofs[i];
        path_elements.push(pe.iter().map(scalar_to_decimal).collect::<Vec<_>>());
        path_indices.push(pi.to_string());
    }

    json!({
        "employeeRoot": scalar_to_decimal(&tree.root),
        "totalPayrollAmount": scalar_to_decimal(&salary),
        "payrollPeriodId": payroll_period_id.to_string(),
        "employeeId": employee_ids,
        "salaryAmount": salary_amounts,
        "salt": salts,
        "pathElements": path_elements,
        "pathIndices": path_indices,
    })
}

fn build_withdraw_input_json(
    tree: &MerkleTree,
    employee_id: Scalar,
    salary: Scalar,
    salt: Scalar,
    commitment_id: Scalar,
    nullifier: Scalar,
) -> serde_json::Value {
    let (path_elements, path_indices) = &tree.proofs[0];
    json!({
        "commitmentRoot": scalar_to_decimal(&tree.root),
        "commitmentId": scalar_to_decimal(&commitment_id),
        "nullifier": scalar_to_decimal(&nullifier),
        "salaryAmount": scalar_to_decimal(&salary),
        "employeeId": scalar_to_decimal(&employee_id),
        "salaryAmountPrivate": scalar_to_decimal(&salary),
        "salt": scalar_to_decimal(&salt),
        "pathElements": path_elements.iter().map(scalar_to_decimal).collect::<Vec<_>>(),
        "pathIndices": path_indices.to_string(),
    })
}

fn build_merkle_tree(employees: &[(Scalar, Scalar, Scalar)]) -> MerkleTree {
    let zero_commitment = salary_commitment(Scalar::zero(), Scalar::zero(), Scalar::zero());
    let mut zeros = vec![zero_commitment];
    for i in 1..=LEVELS {
        zeros.push(compress(zeros[i - 1], zeros[i - 1]));
    }

    let real_commitments = employees
        .iter()
        .map(|(emp, sal, salt)| salary_commitment(*emp, *sal, *salt))
        .collect::<Vec<_>>();

    let mut layers: Vec<HashMap<usize, Scalar>> = (0..=LEVELS).map(|_| HashMap::new()).collect();
    for (i, commitment) in real_commitments.iter().enumerate() {
        let mut node_index = i;
        let mut hash = *commitment;
        for k in 0..=LEVELS {
            if hash != zeros[k] {
                layers[k].insert(node_index, hash);
            }
            if k == LEVELS {
                break;
            }
            let sibling_index = node_index ^ 1;
            let sibling_hash = *layers[k].get(&sibling_index).unwrap_or(&zeros[k]);
            let (left, right) = if node_index % 2 == 0 {
                (hash, sibling_hash)
            } else {
                (sibling_hash, hash)
            };
            hash = compress(left, right);
            node_index >>= 1;
        }
    }

    let root = *layers[LEVELS].get(&0).unwrap_or(&zeros[LEVELS]);
    let mut proofs = Vec::with_capacity(BATCH_SIZE);
    for slot_idx in 0..BATCH_SIZE {
        let mut path_elements = Vec::with_capacity(LEVELS);
        let mut node_index = slot_idx;
        for k in 0..LEVELS {
            let sibling_index = node_index ^ 1;
            let sibling_hash = *layers[k].get(&sibling_index).unwrap_or(&zeros[k]);
            path_elements.push(sibling_hash);
            node_index >>= 1;
        }
        proofs.push((path_elements, slot_idx as u64));
    }

    MerkleTree { root, proofs }
}

fn salary_commitment(emp: Scalar, sal: Scalar, salt: Scalar) -> Scalar {
    Poseidon2::new(&POSEIDON2_BN256_PARAMS_4).permutation(&[emp, sal, salt, Scalar::from(1u64)])[0]
}

fn commitment_id(commitment: Scalar) -> Scalar {
    Poseidon2::new(&POSEIDON2_BN256_PARAMS_2).permutation(&[commitment, Scalar::from(2u64)])[0]
}

fn nullifier(commitment: Scalar, salt: Scalar) -> Scalar {
    Poseidon2::new(&POSEIDON2_BN256_PARAMS_3).permutation(&[commitment, salt, Scalar::from(3u64)])
        [0]
}

fn compress(l: Scalar, r: Scalar) -> Scalar {
    let out = Poseidon2::new(&POSEIDON2_BN256_PARAMS_2).permutation(&[l, r]);
    out[0] + l
}

fn scalar_to_decimal(s: &Scalar) -> String {
    BigInt::from_bytes_be(Sign::Plus, &scalar_to_bytes(s)).to_str_radix(10)
}

fn scalar_to_bytes(s: &Scalar) -> [u8; 32] {
    let bytes = s.into_bigint().to_bytes_be();
    let mut out = [0u8; 32];
    out[32 - bytes.len()..].copy_from_slice(&bytes);
    out
}

fn witness_field_le_to_decimal(chunk: &[u8]) -> String {
    let mut be = chunk.to_vec();
    be.reverse();
    BigInt::from_bytes_be(Sign::Plus, &be).to_str_radix(10)
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn ascii_hex(s: &str) -> String {
    bytes_to_hex(s.as_bytes())
}

fn write_json(out_dir: &Path, name: &str, value: &serde_json::Value) -> Result<PathBuf> {
    let path = out_dir.join(name);
    fs::write(&path, serde_json::to_vec_pretty(value)?)?;
    Ok(path)
}

fn write_text(out_dir: &Path, name: &str, value: &str) -> Result<PathBuf> {
    let path = out_dir.join(name);
    fs::write(&path, value)?;
    Ok(path)
}

fn path_str(path: &Path) -> Result<&str> {
    path.to_str()
        .ok_or_else(|| anyhow!("non-utf8 path: {}", path.display()))
}

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("workspace root")
        .to_path_buf()
}

fn payroll_pk_path() -> PathBuf {
    workspace_root().join("testdata/payroll_10_10_proving_key.bin")
}

fn payroll_r1cs_path() -> PathBuf {
    workspace_root().join("target/circuits-artifacts/debug/payroll_10_10.r1cs")
}

fn payroll_wasm_path() -> PathBuf {
    workspace_root().join("target/circuits-artifacts/debug/payroll_10_10.wasm")
}

fn withdraw_pk_path() -> PathBuf {
    workspace_root().join("testdata/payrollWithdraw_10_proving_key.bin")
}

fn withdraw_r1cs_path() -> PathBuf {
    workspace_root().join("target/circuits-artifacts/debug/payrollWithdraw_10.r1cs")
}

fn withdraw_wasm_path() -> PathBuf {
    workspace_root().join("target/circuits-artifacts/debug/payrollWithdraw_10.wasm")
}
