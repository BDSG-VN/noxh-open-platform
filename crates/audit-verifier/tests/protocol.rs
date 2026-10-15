use audit_verifier::{
    audit_hash, verify, verify_bytes, AuditInput, GENESIS, MAX_EVENTS, MAX_INPUT_BYTES,
};
use serde_json::{json, Value};
use std::{
    io::Write,
    process::{Command, Stdio},
};

const GOLDEN: &[u8] = include_bytes!("fixtures/node-golden.json");
const GOLDEN_RESULT: &[u8] = include_bytes!("fixtures/node-golden-result.json");
fn fixture() -> Value {
    serde_json::from_slice(GOLDEN).unwrap()
}
fn check(input: &Value) -> Result<audit_verifier::Verification, audit_verifier::VerificationError> {
    verify_bytes(&serde_json::to_vec(input).unwrap())
}
fn rehash(input: &mut Value, index: usize) {
    let event = serde_json::from_value(input["events"][index].clone()).unwrap();
    input["events"][index]["event_hash"] = json!(audit_hash(&event));
}

#[test]
fn actual_application_node_golden_has_identical_hashes_and_result() {
    let result = verify_bytes(GOLDEN).unwrap();
    assert_eq!(
        serde_json::to_value(&result).unwrap(),
        serde_json::from_slice::<Value>(GOLDEN_RESULT).unwrap()
    );
    assert_eq!(
        result.head,
        "f2e361bf491cb0056e1f8dfab51bf8da7fc26ec0b0fafc81de57f3720d711ff8"
    );
    // Non-consecutive sequences and a wall-clock rollback are deliberate. The
    // database sequence and links, rather than timestamps, define append order.
    assert_eq!(result.checked, 3);
}

#[test]
fn live_node_json_stringify_and_sha256_match_rust_for_unicode_and_controls() {
    let script = r#"
const fs = require('node:fs'), {createHash} = require('node:crypto');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(input.events.map(r => createHash('sha256').update(JSON.stringify([
 'audit-v1',r.id,r.organization_id,r.actor_ref,r.action,r.resource_ref,r.occurred_at,r.prev_hash
]), 'utf8').digest('hex'))));
"#;
    let mut child = Command::new("node")
        .args(["-e", script])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Node.js is required for the cross-runtime protocol test");
    child.stdin.take().unwrap().write_all(GOLDEN).unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success(), "Node protocol reference failed");
    let node: Vec<String> = serde_json::from_slice(&output.stdout).unwrap();
    let input: AuditInput = serde_json::from_slice(GOLDEN).unwrap();
    assert_eq!(
        node,
        input.events.iter().map(audit_hash).collect::<Vec<_>>()
    );
    assert_eq!(
        node,
        input
            .events
            .iter()
            .map(|e| e.event_hash.clone())
            .collect::<Vec<_>>()
    );
}

#[test]
fn rejects_changed_content_and_rehashed_middle_with_unmodified_successor() {
    let mut input = fixture();
    input["events"][1]["action"] = json!("giả mạo");
    let error = check(&input).unwrap_err();
    assert_eq!((error.code, error.checked), ("HASH_MISMATCH", 1));
    rehash(&mut input, 1);
    let error = check(&input).unwrap_err();
    assert_eq!((error.code, error.checked), ("BROKEN_LINK", 2));
}

#[test]
fn rejects_wrong_organization_duplicates_missing_middle_and_reordering() {
    let mut input = fixture();
    input["expectedOrganizationId"] = json!("10000000-0000-4000-8000-000000000002");
    assert_eq!(check(&input).unwrap_err().code, "WRONG_ORGANIZATION");
    input = fixture();
    input["events"][2]["id"] = input["events"][0]["id"].clone();
    assert_eq!(check(&input).unwrap_err().code, "DUPLICATE_EVENT_ID");
    input = fixture();
    input["events"].as_array_mut().unwrap().remove(1);
    assert_eq!(check(&input).unwrap_err().code, "BROKEN_LINK");
    input = fixture();
    input["events"].as_array_mut().unwrap().swap(0, 1);
    assert_eq!(check(&input).unwrap_err().code, "BROKEN_LINK");
    input = fixture();
    input["events"].as_array_mut().unwrap().remove(0);
    assert_eq!(check(&input).unwrap_err().code, "BROKEN_LINK");
}

#[test]
fn requires_unambiguous_calendar_valid_utc_millisecond_timestamps() {
    for timestamp in [
        "2026-10-15T07:00:00Z",
        "2026-10-15T07:00:00.001+00:00",
        "2026-02-29T07:00:00.001Z",
        "2026-04-31T07:00:00.001Z",
        "2026-10-15T24:00:00.001Z",
        "2026-10-15T07:00:60.001Z",
        "2026-10-15 07:00:00.001Z",
    ] {
        let mut input = fixture();
        input["events"][0]["occurred_at"] = json!(timestamp);
        rehash(&mut input, 0);
        assert_eq!(
            check(&input).unwrap_err().code,
            "INVALID_TIMESTAMP",
            "{timestamp}"
        );
    }
    // A real leap day and identical timestamps remain valid when links/sequence
    // establish the order; no timestamp sorting or normalization is permitted.
    let mut input = fixture();
    input["events"].as_array_mut().unwrap().truncate(1);
    input["events"][0]["occurred_at"] = json!("2024-02-29T07:00:00.001Z");
    rehash(&mut input, 0);
    assert!(check(&input).is_ok());
}

#[test]
fn sequences_are_optional_as_a_set_and_preserve_bigint_exactness() {
    let mut input = fixture();
    for event in input["events"].as_array_mut().unwrap() {
        event.as_object_mut().unwrap().remove("sequence");
    }
    assert_eq!(
        check(&input).unwrap().head,
        verify_bytes(GOLDEN).unwrap().head
    );
    input["events"][0]["sequence"] = json!(1);
    assert_eq!(check(&input).unwrap_err().code, "MIXED_SEQUENCE");
    input = fixture();
    input["events"][1]["sequence"] = json!(1);
    assert_eq!(check(&input).unwrap_err().code, "INVALID_SEQUENCE");
    for sequence in [
        json!(0),
        json!(-1),
        json!(1.5),
        json!(true),
        json!(null),
        json!("01"),
        json!("+1"),
        json!("1.0"),
        json!(" 1"),
        json!("9223372036854775808"),
        json!(9_007_199_254_740_992u64),
    ] {
        input = fixture();
        input["events"][0]["sequence"] = sequence;
        assert_eq!(check(&input).unwrap_err().code, "MALFORMED_INPUT");
    }
    input = fixture();
    input["events"][2]["sequence"] = json!("9223372036854775807");
    assert!(check(&input).is_ok());
}

#[test]
fn rejects_missing_unknown_duplicate_keys_bad_digests_and_invalid_utf8() {
    let mut input = fixture();
    input["events"][0]
        .as_object_mut()
        .unwrap()
        .remove("actor_ref");
    assert_eq!(check(&input).unwrap_err().code, "MALFORMED_INPUT");
    input = fixture();
    input["arbitrary"] = json!(true);
    assert_eq!(check(&input).unwrap_err().code, "MALFORMED_INPUT");
    input = fixture();
    input["events"][0]["arbitrary"] = json!(true);
    assert_eq!(check(&input).unwrap_err().code, "MALFORMED_INPUT");
    let duplicate = br#"{"events":[],"events":[],"expectedOrganizationId":"10000000-0000-4000-8000-000000000001"}"#;
    assert_eq!(verify_bytes(duplicate).unwrap_err().code, "MALFORMED_INPUT");
    assert_eq!(
        verify_bytes(&[0xff, 0xfe]).unwrap_err().code,
        "MALFORMED_INPUT"
    );
    for field in ["prev_hash", "event_hash"] {
        input = fixture();
        input["events"][0][field] = json!("A".repeat(64));
        assert_eq!(check(&input).unwrap_err().code, "INVALID_EVENT");
    }
    input = fixture();
    input["events"][0]["id"] = json!("not-an-id\nSENSITIVE");
    let error = check(&input).unwrap_err();
    assert_eq!(error.code, "INVALID_EVENT");
    assert!(error.broken_at.is_none());
    assert!(!serde_json::to_string(&error).unwrap().contains("SENSITIVE"));
    let lone_surrogate = String::from_utf8(GOLDEN.to_vec()).unwrap().replacen(
        "DIỄN TẬP — người kiểm tra 👩🏽‍💻",
        "\\ud800",
        1,
    );
    assert_eq!(
        verify_bytes(lone_surrogate.as_bytes()).unwrap_err().code,
        "MALFORMED_INPUT"
    );
}

#[test]
fn bounds_input_bytes_event_count_and_reports_empty_chain_honestly() {
    assert_eq!(
        verify_bytes(&vec![b' '; MAX_INPUT_BYTES + 1])
            .unwrap_err()
            .code,
        "INPUT_TOO_LARGE"
    );
    let empty =
        json!({"events":[],"expectedOrganizationId":"10000000-0000-4000-8000-000000000001"});
    let mut bytes = serde_json::to_vec(&empty).unwrap();
    bytes.resize(MAX_INPUT_BYTES, b' ');
    assert_eq!(verify_bytes(&bytes).unwrap().head, GENESIS);
    let mut input: AuditInput = serde_json::from_slice(GOLDEN).unwrap();
    input.events = vec![input.events[0].clone(); MAX_EVENTS + 1];
    assert_eq!(verify(&input).unwrap_err().code, "TOO_MANY_EVENTS");
}

#[test]
fn valid_prefix_cannot_prove_completeness_without_trusted_external_head() {
    let full = verify_bytes(GOLDEN).unwrap();
    let mut prefix = fixture();
    prefix["events"].as_array_mut().unwrap().pop();
    let shortened = check(&prefix).unwrap();
    assert!(shortened.valid);
    assert_eq!(shortened.checked, 2);
    assert_ne!(full.head, shortened.head);
    // The verifier has no independently trusted checkpoint; callers must never
    // interpret `valid` as protection against tail truncation or chain rewrite.
}
