use audit_verifier::{verify_bytes, AuditCursor, GENESIS};
use serde_json::{json, Value};
const GOLDEN: &[u8] = include_bytes!("fixtures/node-golden.json");
fn fixture() -> Value {
    serde_json::from_slice(GOLDEN).unwrap()
}
fn check(v: &Value) -> Result<audit_verifier::Verification, audit_verifier::VerificationError> {
    verify_bytes(&serde_json::to_vec(v).unwrap())
}
fn full() -> (Value, AuditCursor) {
    let mut v = fixture();
    v["anchor"] = json!(AuditCursor::genesis());
    let end = check(&v).unwrap().cursor.unwrap();
    (v, end)
}
#[test]
fn incremental_pages_equal_genesis_verification_and_bind_exact_end() {
    let (mut v, end) = full();
    v["events"].as_array_mut().unwrap().truncate(1);
    let first = check(&v).unwrap();
    assert_eq!(first.cursor.as_ref().unwrap().event_count, "1");
    assert_eq!(first.complete_to_expected, None);
    let mut second = fixture();
    second["events"].as_array_mut().unwrap().remove(0);
    second["anchor"] = json!(first.cursor.unwrap());
    second["expectedEnd"] = json!(end);
    let verified = check(&second).unwrap();
    assert_eq!(verified.complete_to_expected, Some(true));
    assert_eq!(verified.cursor.unwrap(), end);
}
#[test]
fn valid_prefix_is_rejected_when_a_signed_expected_end_is_required() {
    let (mut v, end) = full();
    v["expectedEnd"] = json!(end);
    v["events"].as_array_mut().unwrap().pop();
    assert_eq!(check(&v).unwrap_err().code, "EXPECTED_END_MISMATCH");
    v["events"] = json!([]);
    assert_eq!(check(&v).unwrap_err().code, "EXPECTED_END_MISMATCH");
}
#[test]
fn sequence_metadata_and_count_cannot_be_relabelled_under_a_checkpoint() {
    let (mut v, end) = full();
    v["expectedEnd"] = json!(end);
    // Sequence was deliberately not hashed in legacy audit-v1. The new
    // sequenceDigest authenticates its exact exported value, including gaps.
    v["events"][0]["sequence"] = json!("2");
    assert_eq!(check(&v).unwrap_err().code, "EXPECTED_END_MISMATCH");
    let (mut v, mut end) = full();
    end.event_count = "4".to_string();
    v["expectedEnd"] = json!(end);
    assert_eq!(check(&v).unwrap_err().code, "EXPECTED_END_MISMATCH");
}
#[test]
fn malformed_anchor_missing_sequence_and_wrong_end_are_fail_closed() {
    let (mut v, mut end) = full();
    v["anchor"]["sequence"] = json!("00");
    assert_eq!(check(&v).unwrap_err().code, "INVALID_ANCHOR");
    let mut v = fixture();
    v["anchor"] = json!(AuditCursor::genesis());
    v["events"][0].as_object_mut().unwrap().remove("sequence");
    assert_eq!(check(&v).unwrap_err().code, "MISSING_SEQUENCE");
    let (mut v, _) = full();
    end.head = GENESIS.to_string();
    v["expectedEnd"] = json!(end);
    assert_eq!(check(&v).unwrap_err().code, "EXPECTED_END_MISMATCH");
}
