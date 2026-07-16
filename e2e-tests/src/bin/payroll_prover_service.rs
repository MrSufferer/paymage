use anyhow::{Context, Result, anyhow, bail};
use prover::prover::Prover;
use serde_json::{Value, json};
use std::{
    env, fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    time::Duration,
};
use witness::WitnessCalculator;

const DEFAULT_BIND: &str = "127.0.0.1:8787";

fn main() -> Result<()> {
    if env::args().any(|arg| arg == "--once") {
        let mut body = String::new();
        std::io::stdin().read_to_string(&mut body)?;
        let response = prove_from_request_body(&body)?;
        println!("{}", serde_json::to_string(&response)?);
        return Ok(());
    }

    let bind = env::var("PAYROLL_PROVER_BIND").unwrap_or_else(|_| DEFAULT_BIND.to_string());
    let listener = TcpListener::bind(&bind).with_context(|| format!("bind {bind}"))?;
    println!("payroll prover service listening on http://{bind}");

    for stream in listener.incoming() {
        match stream {
            Ok(mut stream) => {
                if let Err(error) = handle_stream(&mut stream) {
                    let _ = write_json_response(
                        &mut stream,
                        500,
                        &json!({ "error": error.to_string() }),
                    );
                }
            }
            Err(error) => eprintln!("connection error: {error}"),
        }
    }

    Ok(())
}

fn handle_stream(stream: &mut TcpStream) -> Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(30)))?;

    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    let bytes_read = stream.read(&mut chunk)?;
    if bytes_read == 0 {
        return Ok(());
    }
    buffer.extend_from_slice(&chunk[..bytes_read]);

    let header_end = loop {
        if let Some(index) = find_header_end(&buffer) {
            break index;
        }
        let bytes_read = stream.read(&mut chunk)?;
        if bytes_read == 0 {
            bail!("malformed HTTP request");
        }
        buffer.extend_from_slice(&chunk[..bytes_read]);
    };

    let headers = String::from_utf8(buffer[..header_end].to_vec())
        .context("request headers were not valid utf-8")?;
    let request_line = headers.lines().next().unwrap_or_default();

    if request_line.starts_with("GET ") {
        return write_json_response(stream, 200, &json!({ "status": "ok" }));
    }
    if request_line.starts_with("OPTIONS ") {
        return write_json_response(stream, 204, &json!({}));
    }
    if !request_line.starts_with("POST ") {
        return write_json_response(stream, 405, &json!({ "error": "method not allowed" }));
    }

    read_remaining_body(stream, &headers, header_end + 4, &mut buffer)?;
    let body_bytes = &buffer[header_end + 4..];
    let body = if is_chunked(&headers) {
        decode_chunked_body(body_bytes)?
    } else {
        body_bytes.to_vec()
    };
    let body = String::from_utf8(body).context("request body was not valid utf-8")?;
    let response = prove_from_request_body(&body)?;
    write_json_response(stream, 200, &response)
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn read_remaining_body(
    stream: &mut TcpStream,
    headers: &str,
    body_start: usize,
    buffer: &mut Vec<u8>,
) -> Result<()> {
    let mut chunk = [0u8; 8192];
    if let Some(length) = content_length(headers)? {
        while buffer.len().saturating_sub(body_start) < length {
            let bytes_read = stream.read(&mut chunk)?;
            if bytes_read == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..bytes_read]);
        }
    } else if is_chunked(headers) {
        while !buffer[body_start..].windows(5).any(|window| window == b"0\r\n\r\n") {
            let bytes_read = stream.read(&mut chunk)?;
            if bytes_read == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..bytes_read]);
        }
    }
    Ok(())
}

fn content_length(headers: &str) -> Result<Option<usize>> {
    for line in headers.lines().skip(1) {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("content-length") {
            return value
                .trim()
                .parse::<usize>()
                .map(Some)
                .context("invalid content-length header");
        }
    }
    Ok(None)
}

fn is_chunked(headers: &str) -> bool {
    headers.lines().skip(1).any(|line| {
        let Some((name, value)) = line.split_once(':') else {
            return false;
        };
        name.eq_ignore_ascii_case("transfer-encoding")
            && value.to_ascii_lowercase().contains("chunked")
    })
}

fn decode_chunked_body(body: &[u8]) -> Result<Vec<u8>> {
    let mut decoded = Vec::new();
    let mut offset = 0usize;

    loop {
        let line_end = body[offset..]
            .windows(2)
            .position(|window| window == b"\r\n")
            .ok_or_else(|| anyhow!("malformed chunked request body"))?
            + offset;
        let size_line = std::str::from_utf8(&body[offset..line_end])
            .context("chunk size was not utf-8")?;
        let size_hex = size_line.split(';').next().unwrap_or_default().trim();
        let size = usize::from_str_radix(size_hex, 16).context("invalid chunk size")?;
        offset = line_end + 2;

        if size == 0 {
            break;
        }
        if body.len() < offset + size + 2 {
            bail!("truncated chunked request body");
        }
        decoded.extend_from_slice(&body[offset..offset + size]);
        offset += size + 2;
    }

    Ok(decoded)
}

fn prove_from_request_body(body: &str) -> Result<Value> {
    let request: Value = serde_json::from_str(body).context("parse request JSON")?;
    let inputs_json = request
        .get("inputsJson")
        .or_else(|| request.get("inputs_json"))
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("inputsJson is required"))?;

    let result = generate_payroll_proof(inputs_json)?;
    Ok(json!({
        "proofHex": result.proof_hex,
        "publicInputsHex": result.public_inputs_hex,
        "proverVersion": env!("CARGO_PKG_VERSION"),
    }))
}

struct ProofResult {
    proof_hex: String,
    public_inputs_hex: Vec<String>,
}

fn generate_payroll_proof(inputs_json: &str) -> Result<ProofResult> {
    let pk = fs::read(workspace_root().join("testdata/payroll_10_10_proving_key.bin"))
        .context("read payroll proving key")?;
    let r1cs =
        fs::read(workspace_root().join("target/circuits-artifacts/debug/payroll_10_10.r1cs"))
            .context("read payroll r1cs")?;
    let wasm =
        fs::read(workspace_root().join("target/circuits-artifacts/debug/payroll_10_10.wasm"))
            .context("read payroll witness wasm")?;

    let mut witness_calc = WitnessCalculator::new(&wasm, &r1cs)?;
    let witness = witness_calc.compute_witness(inputs_json)?;

    let prover = Prover::new(&pk, &r1cs)?;
    let compressed = prover.prove_bytes(&witness)?;
    let uncompressed = prover.prove_bytes_uncompressed(&witness)?;
    if uncompressed.len() != 256 {
        bail!(
            "expected 256-byte uncompressed proof, got {}",
            uncompressed.len()
        );
    }

    let public_inputs = prover.extract_public_inputs(&witness)?;
    if public_inputs.len() != 96 {
        bail!(
            "expected 3 public inputs, got {} bytes",
            public_inputs.len()
        );
    }
    if !prover.verify(&compressed, &public_inputs)? {
        bail!("generated proof failed off-chain verification");
    }

    Ok(ProofResult {
        proof_hex: bytes_to_hex(&uncompressed),
        public_inputs_hex: public_inputs
            .chunks_exact(32)
            .map(witness_field_le_to_hex_be)
            .collect(),
    })
}

fn write_json_response(stream: &mut TcpStream, status: u16, body: &Value) -> Result<()> {
    let body = serde_json::to_vec(body)?;
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        405 => "Method Not Allowed",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let allowed_origin =
        env::var("PAYROLL_PROVER_ALLOWED_ORIGIN").unwrap_or_else(|_| "*".to_string());
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\ncontent-type: application/json\r\naccess-control-allow-origin: {allowed_origin}\r\naccess-control-allow-methods: GET, POST, OPTIONS\r\naccess-control-allow-headers: content-type, authorization\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        body.len(),
    )?;
    stream.write_all(&body)?;
    Ok(())
}

fn witness_field_le_to_hex_be(chunk: &[u8]) -> String {
    let mut be = chunk.to_vec();
    be.reverse();
    bytes_to_hex(&be)
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn workspace_root() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for candidate in manifest_dir.ancestors() {
        if candidate
            .join("testdata/payroll_10_10_proving_key.bin")
            .exists()
        {
            return candidate.to_path_buf();
        }
    }
    manifest_dir
        .parent()
        .expect("workspace root")
        .to_path_buf()
}
