use audit_verifier::{verify_bytes, VerificationError, MAX_INPUT_BYTES};
use std::io::{Read, Write};

fn run() -> Result<audit_verifier::Verification, VerificationError> {
    if std::env::args_os().len() != 1 {
        return Err(VerificationError::input("INVALID_ARGUMENTS"));
    }
    let mut bytes = Vec::new();
    std::io::stdin()
        .lock()
        .take(MAX_INPUT_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| VerificationError::input("READ_ERROR"))?;
    verify_bytes(&bytes)
}
fn main() {
    let (output, status) = match run() {
        Ok(result) => (
            serde_json::to_vec(&result).expect("serializable verification"),
            0,
        ),
        Err(error) => (serde_json::to_vec(&error).expect("serializable error"), 1),
    };
    let mut stdout = std::io::stdout().lock();
    if stdout
        .write_all(&output)
        .and_then(|_| stdout.write_all(b"\n"))
        .is_err()
    {
        std::process::exit(1);
    }
    std::process::exit(status);
}
