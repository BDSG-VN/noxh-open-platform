//! Offline verifier for the existing Node `audit-v1` hash-chain protocol.
//!
//! This verifies the supplied bytes and links, not signatures, authorship or
//! completeness. In particular, a valid prefix remains valid without an
//! independently trusted head/checkpoint. No network or database access occurs.
use serde::{de, Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fmt};

pub const MAX_INPUT_BYTES: usize = 2_000_000;
pub const MAX_EVENTS: usize = 10_000;
pub const GENESIS: &str = "0000000000000000000000000000000000000000000000000000000000000000";
const MAX_SAFE_JS_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_PG_BIGINT: u64 = i64::MAX as u64;
const MAX_TEXT_BYTES: usize = 16_384;

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuditEvent {
    pub id: String,
    pub organization_id: String,
    pub actor_ref: String,
    pub action: String,
    pub resource_ref: String,
    pub occurred_at: String,
    pub prev_hash: String,
    pub event_hash: String,
    // PostgreSQL BIGSERIAL is normally exported as a decimal string. JSON
    // integers are accepted only within JavaScript's exact-integer range.
    #[serde(default, deserialize_with = "deserialize_sequence")]
    pub sequence: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuditInput {
    pub events: Vec<AuditEvent>,
    pub expected_organization_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Verification {
    pub valid: bool,
    pub checked: usize,
    pub head: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationError {
    pub valid: bool,
    pub code: &'static str,
    pub checked: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub broken_at: Option<String>,
}
impl VerificationError {
    pub fn input(code: &'static str) -> Self {
        Self {
            valid: false,
            code,
            checked: 0,
            broken_at: None,
        }
    }
    fn event(code: &'static str, checked: usize, event: &AuditEvent) -> Self {
        // Do not reflect malformed input/control characters to an operator log.
        Self {
            valid: false,
            code,
            checked,
            broken_at: canonical_uuid(&event.id).then(|| event.id.clone()),
        }
    }
}
impl fmt::Display for VerificationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.code)
    }
}
impl std::error::Error for VerificationError {}

fn deserialize_sequence<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u64>, D::Error> {
    struct SequenceVisitor;
    impl<'de> de::Visitor<'de> for SequenceVisitor {
        type Value = u64;
        fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
            f.write_str(
                "a positive safe JSON integer or canonical PostgreSQL bigint decimal string",
            )
        }
        fn visit_u64<E: de::Error>(self, value: u64) -> Result<u64, E> {
            if value == 0 || value > MAX_SAFE_JS_INTEGER {
                return Err(E::custom("invalid numeric sequence"));
            }
            Ok(value)
        }
        fn visit_str<E: de::Error>(self, value: &str) -> Result<u64, E> {
            if value.is_empty()
                || value.len() > 19
                || value.starts_with('0')
                || !value.bytes().all(|c| c.is_ascii_digit())
            {
                return Err(E::custom("invalid decimal sequence"));
            }
            let sequence: u64 = value
                .parse()
                .map_err(|_| E::custom("invalid decimal sequence"))?;
            if sequence == 0 || sequence > MAX_PG_BIGINT {
                return Err(E::custom("sequence exceeds PostgreSQL bigint"));
            }
            Ok(sequence)
        }
    }
    d.deserialize_any(SequenceVisitor).map(Some)
}

fn canonical_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_digit() || (b'a'..=b'f').contains(&c)
            }
        })
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn canonical_timestamp(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() != 24
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
        || b[19] != b'.'
        || b[23] != b'Z'
    {
        return false;
    }
    if !b
        .iter()
        .enumerate()
        .all(|(i, c)| [4, 7, 10, 13, 16, 19, 23].contains(&i) || c.is_ascii_digit())
    {
        return false;
    }
    let number = |start: usize, end: usize| {
        b[start..end]
            .iter()
            .fold(0u32, |n, c| n * 10 + (c - b'0') as u32)
    };
    let (year, month, day) = (number(0, 4), number(5, 7), number(8, 10));
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&day) && number(11, 13) < 24 && number(14, 16) < 60 && number(17, 19) < 60
}

/// Exact SHA-256 of UTF-8 Node JSON.stringify(["audit-v1", ...field strings]).
/// JSON string escaping is deliberately not Unicode-normalized. `sequence`
/// and `event_hash` are not part of the existing Node digest protocol.
pub fn audit_hash(event: &AuditEvent) -> String {
    let canonical = serde_json::to_vec(&[
        "audit-v1",
        &event.id,
        &event.organization_id,
        &event.actor_ref,
        &event.action,
        &event.resource_ref,
        &event.occurred_at,
        &event.prev_hash,
    ])
    .expect("an array of strings always serializes");
    hex::encode(Sha256::digest(canonical))
}

pub fn verify_bytes(bytes: &[u8]) -> Result<Verification, VerificationError> {
    if bytes.len() > MAX_INPUT_BYTES {
        return Err(VerificationError::input("INPUT_TOO_LARGE"));
    }
    let input: AuditInput =
        serde_json::from_slice(bytes).map_err(|_| VerificationError::input("MALFORMED_INPUT"))?;
    verify(&input)
}

pub fn verify(input: &AuditInput) -> Result<Verification, VerificationError> {
    if !canonical_uuid(&input.expected_organization_id) {
        return Err(VerificationError::input("INVALID_ORGANIZATION"));
    }
    if input.events.len() > MAX_EVENTS {
        return Err(VerificationError::input("TOO_MANY_EVENTS"));
    }
    let use_sequence = input.events.first().and_then(|e| e.sequence).is_some();
    let mut ids = HashSet::with_capacity(input.events.len());
    let mut previous = GENESIS.to_string();
    let mut previous_sequence = 0;
    for (checked, event) in input.events.iter().enumerate() {
        let fail = |code| VerificationError::event(code, checked, event);
        if !canonical_uuid(&event.id)
            || !canonical_uuid(&event.organization_id)
            || !digest(&event.prev_hash)
            || !digest(&event.event_hash)
            || [&event.actor_ref, &event.action, &event.resource_ref]
                .iter()
                .any(|s| s.is_empty() || s.len() > MAX_TEXT_BYTES)
        {
            return Err(fail("INVALID_EVENT"));
        }
        if event.organization_id != input.expected_organization_id {
            return Err(fail("WRONG_ORGANIZATION"));
        }
        if !ids.insert(&event.id) {
            return Err(fail("DUPLICATE_EVENT_ID"));
        }
        if !canonical_timestamp(&event.occurred_at) {
            return Err(fail("INVALID_TIMESTAMP"));
        }
        if event.sequence.is_some() != use_sequence {
            return Err(fail("MIXED_SEQUENCE"));
        }
        if let Some(sequence) = event.sequence {
            if sequence <= previous_sequence || sequence > MAX_PG_BIGINT {
                return Err(fail("INVALID_SEQUENCE"));
            }
            previous_sequence = sequence;
        }
        if event.prev_hash != previous {
            return Err(fail("BROKEN_LINK"));
        }
        if audit_hash(event) != event.event_hash {
            return Err(fail("HASH_MISMATCH"));
        }
        previous.clone_from(&event.event_hash);
    }
    Ok(Verification {
        valid: true,
        checked: input.events.len(),
        head: previous,
    })
}
