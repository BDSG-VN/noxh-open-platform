use std::io::{self, Read, Write};

fn run() -> Result<(), &'static str> {
    const MAX_INPUT: u64 = 1_048_576;
    let mut bytes = Vec::new();
    io::stdin()
        .take(MAX_INPUT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Input read failed")?;
    if bytes.len() as u64 > MAX_INPUT {
        return Err("Input limit exceeded");
    }
    let input = serde_json::from_slice(&bytes).map_err(|_| "Invalid pricing input")?;
    let output = pricing_engine::calculate(input)?;
    let stdout = io::stdout();
    let mut writer = stdout.lock();
    serde_json::to_writer(&mut writer, &output).map_err(|_| "Output write failed")?;
    writer.write_all(b"\n").map_err(|_| "Output write failed")?;
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("pricing-engine: {error}");
        std::process::exit(1);
    }
}
