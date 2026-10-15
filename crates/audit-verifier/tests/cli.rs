use audit_verifier::MAX_INPUT_BYTES;
use serde_json::Value;
use std::{
    io::Write,
    process::{Command, Output, Stdio},
};
fn run(input: &[u8], args: &[&str]) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_audit-verifier"))
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    // An argument error may exit before reading stdin; such a broken pipe does
    // not change the expected fail-closed CLI result.
    let _ = child.stdin.take().unwrap().write_all(input);
    child.wait_with_output().unwrap()
}
#[test]
fn cli_reads_stdin_emits_only_one_bounded_result_and_nonzero_on_invalid_input() {
    let output = run(include_bytes!("fixtures/node-golden.json"), &[]);
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["valid"], true);
    assert_eq!(result["checked"], 3);
    assert!(output.stdout.len() < 200);
    for input in [b"not-json".to_vec(), vec![b' '; MAX_INPUT_BYTES + 1]] {
        let output = run(&input, &[]);
        assert!(!output.status.success());
        assert!(output.stderr.is_empty());
        let result: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(result["valid"], false);
        assert!(output.stdout.len() < 200);
    }
    let output = run(b"", &["unexpected-file.json"]);
    assert!(!output.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap()["code"],
        "INVALID_ARGUMENTS"
    );
}
