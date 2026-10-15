//! Bounded one-request native kernel. Seed material is accepted only on stdin.
use lottery_engine::{draw, LotteryConfig};
use serde::Deserialize;
use std::io::{self, Read, Write};

const LIMIT: u64 = 2 * 1024 * 1024;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    id: String,
    config: LotteryConfig,
    secret: String,
    entropy: String,
}
fn run() -> Result<(), ()> {
    if std::env::args_os().len() != 1 {
        return Err(());
    }
    let mut bytes = Vec::new();
    io::stdin()
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ())?;
    if bytes.len() as u64 > LIMIT {
        return Err(());
    }
    let request: Request = serde_json::from_slice(&bytes).map_err(|_| ())?;
    let result = draw(
        &request.config,
        &request.id,
        &request.secret,
        &request.entropy,
    )
    .map_err(|_| ())?;
    let mut output = serde_json::to_vec(&result).map_err(|_| ())?;
    output.push(b'\n');
    if output.len() as u64 > LIMIT {
        return Err(());
    }
    io::stdout().lock().write_all(&output).map_err(|_| ())
}
fn main() {
    if run().is_err() {
        // Never echo input, seed material, parser fragments or internal diagnostics.
        eprintln!("Invalid lottery kernel request");
        std::process::exit(1);
    }
}
