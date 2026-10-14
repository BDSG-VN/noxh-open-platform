#[test]
fn unimplemented_verifier_never_reports_success() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_lottery-verifier")).output().unwrap();
    assert_eq!(output.status.code(), Some(2));
}
