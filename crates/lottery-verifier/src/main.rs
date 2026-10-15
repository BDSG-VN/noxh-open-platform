use lottery_engine::{verify, Evidence};
use std::io::Read;
fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 1 {
        return Err("Usage: lottery-verifier public-evidence.json".into());
    }
    let file = std::fs::File::open(&args[0]).map_err(|_| "Cannot open evidence file")?;
    let mut bytes = Vec::new();
    file.take(2_000_001)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read evidence file")?;
    if bytes.len() > 2_000_000 {
        return Err("Evidence exceeds 2 MB".into());
    }
    let e: Evidence = serde_json::from_slice(&bytes)
        .map_err(|_| "Invalid evidence JSON or missing protocol fields")?;
    verify(&e).map_err(|e| e.to_string())?;
    println!("VERIFIED: canonical snapshot, commitment and deterministic ranking match. Synthetic scope only; no legal, signature or audit certification.");
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("NOT VERIFIED: {error}");
        std::process::exit(1);
    }
}
