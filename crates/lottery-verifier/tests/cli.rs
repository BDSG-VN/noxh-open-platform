use std::{
    process::{Command, Output},
    sync::atomic::{AtomicU64, Ordering},
};
const VECTOR: &str = include_str!("../../../tests/fixtures/lottery-vector.json");
static COUNTER: AtomicU64 = AtomicU64::new(0);
fn invoke(bytes: &[u8]) -> Output {
    let path = std::env::temp_dir().join(format!(
        "noxh-verifier-test-{}-{}.json",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::write(&path, bytes).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_lottery-verifier"))
        .arg(&path)
        .output()
        .unwrap();
    std::fs::remove_file(path).unwrap();
    output
}
#[test]
fn missing_argument_fails_closed() {
    let output = Command::new(env!("CARGO_BIN_EXE_lottery-verifier"))
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
}
#[test]
fn verifies_cross_language_golden_vector() {
    let output = invoke(VECTOR.as_bytes());
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).starts_with("VERIFIED:"));
}
#[test]
fn tampered_ranking_fails_closed() {
    let mut v: serde_json::Value = serde_json::from_str(VECTOR).unwrap();
    v["result"]["ranking"][0]["rank"] = 999.into();
    let output = invoke(&serde_json::to_vec(&v).unwrap());
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("NOT VERIFIED:"));
}
#[test]
fn real_draw_scope_fails_closed() {
    let mut v: serde_json::Value = serde_json::from_str(VECTOR).unwrap();
    v["config"]["synthetic"] = false.into();
    assert_eq!(
        invoke(&serde_json::to_vec(&v).unwrap()).status.code(),
        Some(1)
    );
}
#[test]
fn malformed_or_oversized_json_fails_closed() {
    assert_eq!(invoke(b"{invalid}").status.code(), Some(1));
    assert_eq!(invoke(&vec![b' '; 2_000_001]).status.code(), Some(1));
}
