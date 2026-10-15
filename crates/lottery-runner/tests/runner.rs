use serde_json::{json, Value};
use std::io::Write;
use std::process::{Command, Stdio};

fn fixture() -> Value {
    let e: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/lottery-vector.json")).unwrap();
    json!({"id":e["id"],"config":e["config"],"secret":e["result"]["secret"],"entropy":e["result"]["entropy"]})
}
fn run(input: &[u8]) -> std::process::Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_lottery-runner"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    // A rejected oversized request may close its pipe before all bytes are written.
    let _ = child.stdin.take().unwrap().write_all(input);
    child.wait_with_output().unwrap()
}
fn rejected(v: &Value) {
    let output = run(&serde_json::to_vec(v).unwrap());
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert_eq!(
        String::from_utf8(output.stderr).unwrap(),
        "Invalid lottery kernel request\n"
    );
}
#[test]
fn golden_exact_result() {
    let e: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/lottery-vector.json")).unwrap();
    let output = run(&serde_json::to_vec(&fixture()).unwrap());
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap(),
        e["result"]
    );
}
#[test]
fn malformed_and_unknown_fields_rejected() {
    assert!(!run(b"{malformed secret material").status.success());
    let mut v = fixture();
    v["unexpected"] = json!(true);
    rejected(&v);
    let mut v = fixture();
    v["config"]["unexpected"] = json!(true);
    rejected(&v);
    let mut v = fixture();
    v["secret"] = json!("sensitive-invalid-seed");
    rejected(&v);
    rejected(&json!({}));
}
#[test]
fn production_duplicate_and_oversized_inputs_rejected() {
    let mut v = fixture();
    v["config"]["synthetic"] = json!(false);
    rejected(&v);
    let mut v = fixture();
    v["config"]["entries"][1] = v["config"]["entries"][0].clone();
    rejected(&v);
    let output = run(&vec![b' '; 2 * 1024 * 1024 + 1]);
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
}
#[test]
fn tampered_configuration_changes_bound_proof() {
    let original = run(&serde_json::to_vec(&fixture()).unwrap());
    let original: Value = serde_json::from_slice(&original.stdout).unwrap();
    let mut changed = fixture();
    changed["config"]["title"] = json!("SYNTHETIC MODIFIED CONFIGURATION");
    let output = run(&serde_json::to_vec(&changed).unwrap());
    assert!(output.status.success());
    let output: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_ne!(original["snapshotHash"], output["snapshotHash"]);
    assert_ne!(original["commitment"], output["commitment"]);
}
