//! Deterministic synthetic lottery protocol. Mathematical verification is separate
//! from legal eligibility, signatures, trusted entropy and independent audit.
//! Real-world draws are disabled.
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fmt};
pub const ALGORITHM: &str = "noxh-hkdf-hmac-fisher-yates-v1";
type HmacSha256 = Hmac<Sha256>;
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LotteryError {
    ProductionDisabled,
    InvalidConfiguration,
    InvalidSeed,
    StreamExhausted,
    SnapshotMismatch,
    CommitmentMismatch,
    RankingMismatch,
}
impl fmt::Display for LotteryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}",
            match self {
                Self::ProductionDisabled => "Only synthetic demonstrations are supported",
                Self::InvalidConfiguration => "Invalid or unsupported configuration",
                Self::InvalidSeed => "Invalid seed, entropy or digest",
                Self::StreamExhausted => "Random stream exhausted",
                Self::SnapshotMismatch => "Canonical snapshot mismatch",
                Self::CommitmentMismatch => "Seed commitment mismatch",
                Self::RankingMismatch => "Deterministic ranking mismatch",
            }
        )
    }
}
impl std::error::Error for LotteryError {}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LotteryConfig {
    #[serde(default)]
    pub cohort_id: Option<String>,
    pub project_id: String,
    pub title: String,
    pub kind: String,
    pub seats: usize,
    pub entries: Vec<String>,
    pub units: Vec<String>,
    pub rules: String,
    pub legal_basis: String,
    pub priority_resolution: String,
    pub eligibility_evidence_hash: String,
    pub scheduled_at: String,
    pub entropy_source: String,
    pub synthetic: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RankingEntry {
    pub code: String,
    pub rank: usize,
    pub selected: bool,
    pub unit: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LotteryResult {
    pub ranking: Vec<RankingEntry>,
    pub algorithm: String,
    pub snapshot_hash: String,
    pub commitment: String,
    pub secret: String,
    pub entropy: String,
}
/// Additional public UI metadata is accepted; mandatory protocol fields are strict.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub id: String,
    pub config: LotteryConfig,
    pub result: LotteryResult,
    pub snapshot_hash: String,
    pub commitment: String,
    pub synthetic: Option<bool>,
    pub production_enabled: Option<bool>,
}
fn uuid(s: &str) -> bool {
    s.len() == 36
        && s.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}
fn text(s: &str, min: usize, max: usize) -> bool {
    s.trim() == s && (min..=max).contains(&s.encode_utf16().count())
}
fn digest_bytes(s: &str) -> Result<Vec<u8>, LotteryError> {
    if s.len() != 64
        || !s
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err(LotteryError::InvalidSeed);
    }
    hex::decode(s).map_err(|_| LotteryError::InvalidSeed)
}
fn timestamp(s: &str) -> bool {
    if s.len() < 20
        || !s.is_ascii()
        || &s[4..5] != "-"
        || &s[7..8] != "-"
        || &s[10..11] != "T"
        || &s[13..14] != ":"
        || &s[16..17] != ":"
        || !s.ends_with('Z')
    {
        return false;
    }
    let number = |r: std::ops::Range<usize>| s[r].parse::<u32>().ok();
    let (Some(y), Some(m), Some(d), Some(h), Some(min), Some(sec)) = (
        number(0..4),
        number(5..7),
        number(8..10),
        number(11..13),
        number(14..16),
        number(17..19),
    ) else {
        return false;
    };
    let days = match m {
        2 => {
            if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => return false,
    };
    let tail = &s[19..s.len() - 1];
    d >= 1
        && d <= days
        && h < 24
        && min < 60
        && sec < 60
        && (tail.is_empty()
            || (tail.starts_with('.')
                && tail.len() > 1
                && tail[1..].bytes().all(|c| c.is_ascii_digit())))
}
pub fn validate(c: &LotteryConfig, id: &str) -> Result<(), LotteryError> {
    if !c.synthetic {
        return Err(LotteryError::ProductionDisabled);
    }
    let code = |v: &String| {
        v.strip_prefix("DEMO-").is_some_and(|s| {
            (4..=32).contains(&s.len())
                && s.bytes()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'-')
        })
    };
    let unit = |s: &String| {
        (1..=24).contains(&s.len())
            && s.bytes()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'-')
    };
    if !uuid(id)
        || !uuid(&c.project_id)
        || !text(&c.title, 5, 150)
        || !(1..=500).contains(&c.seats)
        || !(1..=500).contains(&c.entries.len())
        || c.units.len() > 500
        || !c.entries.iter().all(code)
        || !c.units.iter().all(unit)
        || c.entries.iter().collect::<HashSet<_>>().len() != c.entries.len()
        || c.units.iter().collect::<HashSet<_>>().len() != c.units.len()
        || !text(&c.rules, 30, 4000)
        || !text(&c.legal_basis, 10, 1000)
        || !text(&c.priority_resolution, 20, 2000)
        || !text(&c.entropy_source, 10, 500)
        || !timestamp(&c.scheduled_at)
        || digest_bytes(&c.eligibility_evidence_hash).is_err()
    {
        return Err(LotteryError::InvalidConfiguration);
    }
    match c.kind.as_str() {
        "allocation" if c.units.len() == c.entries.len() && c.seats == c.entries.len() => Ok(()),
        "selection" | "priority-overflow" if c.entries.len() > c.seats && c.units.is_empty() => {
            Ok(())
        }
        _ => Err(LotteryError::InvalidConfiguration),
    }
}
pub fn snapshot(c: &LotteryConfig, id: &str) -> Result<String, LotteryError> {
    validate(c, id)?;
    let mut entries = c.entries.clone();
    entries.sort();
    let mut units = c.units.clone();
    units.sort();
    Ok(serde_json::json!([
        ALGORITHM,
        id,
        c.project_id,
        c.title,
        c.synthetic,
        c.kind,
        c.seats,
        entries,
        units,
        c.rules,
        c.legal_basis,
        c.priority_resolution,
        c.eligibility_evidence_hash,
        c.scheduled_at,
        c.entropy_source
    ])
    .to_string())
}
pub fn snapshot_hash(c: &LotteryConfig, id: &str) -> Result<String, LotteryError> {
    Ok(hex::encode(Sha256::digest(snapshot(c, id)?.as_bytes())))
}
pub fn commitment(secret: &str, snapshot_hash: &str) -> Result<String, LotteryError> {
    let mut data = b"noxh-commit-v1\0".to_vec();
    data.extend(digest_bytes(secret)?);
    data.extend(digest_bytes(snapshot_hash)?);
    Ok(hex::encode(Sha256::digest(data)))
}
/// Rejection sampling avoids modulo bias. Never replace it with an unconditional modulo.
pub fn bounded_index(
    mut next: impl FnMut() -> Result<u32, LotteryError>,
    bound: usize,
) -> Result<usize, LotteryError> {
    if bound == 0 || bound > u32::MAX as usize {
        return Err(LotteryError::InvalidConfiguration);
    }
    let range = 1_u64 << 32;
    let limit = range - range % bound as u64;
    for _ in 0..10000 {
        let word = next()? as u64;
        if word < limit {
            return Ok((word % bound as u64) as usize);
        }
    }
    Err(LotteryError::StreamExhausted)
}
struct Words {
    key: [u8; 32],
    counter: u64,
    offset: usize,
    block: [u8; 32],
}
impl Words {
    fn next(&mut self) -> Result<u32, LotteryError> {
        if self.offset == 32 {
            let counter = u32::try_from(self.counter).map_err(|_| LotteryError::StreamExhausted)?;
            let mut mac =
                HmacSha256::new_from_slice(&self.key).map_err(|_| LotteryError::InvalidSeed)?;
            mac.update(&counter.to_be_bytes());
            self.block.copy_from_slice(&mac.finalize().into_bytes());
            self.counter += 1;
            self.offset = 0;
        }
        let value = u32::from_be_bytes(
            self.block[self.offset..self.offset + 4]
                .try_into()
                .map_err(|_| LotteryError::StreamExhausted)?,
        );
        self.offset += 4;
        Ok(value)
    }
}
pub fn draw(
    c: &LotteryConfig,
    id: &str,
    secret: &str,
    entropy: &str,
) -> Result<LotteryResult, LotteryError> {
    let digest = snapshot_hash(c, id)?;
    let secret_bytes = digest_bytes(secret)?;
    let entropy_bytes = digest_bytes(entropy)?;
    let hkdf = Hkdf::<Sha256>::new(Some(&entropy_bytes), &secret_bytes);
    let mut key = [0; 32];
    hkdf.expand(format!("noxh-draw-v1:{digest}").as_bytes(), &mut key)
        .map_err(|_| LotteryError::InvalidSeed)?;
    let mut words = Words {
        key,
        counter: 0,
        offset: 32,
        block: [0; 32],
    };
    let mut codes = c.entries.clone();
    codes.sort();
    for i in (1..codes.len()).rev() {
        let j = bounded_index(|| words.next(), i + 1)?;
        codes.swap(i, j);
    }
    let mut units = c.units.clone();
    units.sort();
    let ranking = codes
        .into_iter()
        .enumerate()
        .map(|(i, code)| RankingEntry {
            code,
            rank: i + 1,
            selected: i < c.seats,
            unit: if c.kind == "allocation" {
                Some(units[i].clone())
            } else {
                None
            },
        })
        .collect();
    Ok(LotteryResult {
        ranking,
        algorithm: ALGORITHM.into(),
        snapshot_hash: digest.clone(),
        commitment: commitment(secret, &digest)?,
        secret: secret.into(),
        entropy: entropy.into(),
    })
}
pub fn verify(e: &Evidence) -> Result<(), LotteryError> {
    if e.synthetic == Some(false) || e.production_enabled == Some(true) {
        return Err(LotteryError::ProductionDisabled);
    }
    let r = draw(&e.config, &e.id, &e.result.secret, &e.result.entropy)?;
    if e.result.algorithm != ALGORITHM
        || r.snapshot_hash != e.snapshot_hash
        || r.snapshot_hash != e.result.snapshot_hash
    {
        return Err(LotteryError::SnapshotMismatch);
    }
    if r.commitment != e.commitment || r.commitment != e.result.commitment {
        return Err(LotteryError::CommitmentMismatch);
    }
    if r.ranking != e.result.ranking {
        return Err(LotteryError::RankingMismatch);
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> LotteryConfig {
        LotteryConfig {
            cohort_id: None,
            project_id: "20000000-0000-4000-8000-000000000001".into(),
            title: "PHIÊN GIẢ LẬP CÔNG KHAI".into(),
            kind: "selection".into(),
            seats: 2,
            entries: vec!["DEMO-0001".into(), "DEMO-0003".into(), "DEMO-0002".into()],
            units: vec![],
            rules: "Thể lệ giả lập dùng kiểm thử toán học, không tổ chức bốc thăm thật.".into(),
            legal_basis: "CĂN CỨ GIẢ LẬP KIỂM THỬ".into(),
            priority_resolution: "ĐÃ GIẢ LẬP RÀ SOÁT NHÓM ƯU TIÊN".into(),
            eligibility_evidence_hash: "a".repeat(64),
            scheduled_at: "2026-10-16T08:00:00.000Z".into(),
            entropy_source: "NGUỒN ENTROPY GIẢ LẬP KIỂM THỬ".into(),
            synthetic: true,
        }
    }
    const ID: &str = "80000000-0000-4000-8000-000000000001";
    #[test]
    fn real_draw_disabled() {
        let mut c = config();
        c.synthetic = false;
        assert_eq!(
            draw(&c, ID, &"a".repeat(64), &"b".repeat(64)),
            Err(LotteryError::ProductionDisabled)
        );
    }
    #[test]
    fn shuffled_input_is_canonical() {
        let c = config();
        let mut changed = c.clone();
        changed.entries.reverse();
        assert_eq!(
            draw(&c, ID, &"a".repeat(64), &"b".repeat(64)),
            draw(&changed, ID, &"a".repeat(64), &"b".repeat(64))
        );
    }
    #[test]
    fn rejection_avoids_modulo_bias() {
        let mut words = vec![5, u32::MAX].into_iter().rev();
        assert_eq!(bounded_index(|| Ok(words.next().unwrap()), 3), Ok(2));
        assert_eq!(
            bounded_index(|| Ok(u32::MAX), 3),
            Err(LotteryError::StreamExhausted)
        );
        assert_eq!(
            bounded_index(|| Ok(1), 0),
            Err(LotteryError::InvalidConfiguration)
        );
    }
    #[test]
    fn no_duplicates_or_unneeded_draw() {
        let mut c = config();
        c.entries[1] = c.entries[0].clone();
        assert_eq!(validate(&c, ID), Err(LotteryError::InvalidConfiguration));
        let mut c = config();
        c.seats = 3;
        assert_eq!(validate(&c, ID), Err(LotteryError::InvalidConfiguration));
    }
    #[test]
    fn allocation_assigns_unique_units() {
        let mut c = config();
        c.kind = "allocation".into();
        c.seats = 3;
        c.units = vec!["A-03".into(), "A-01".into(), "A-02".into()];
        let r = draw(&c, ID, &"a".repeat(64), &"b".repeat(64)).unwrap();
        assert!(r.ranking.iter().all(|e| e.selected));
        assert_eq!(r.ranking[0].unit, Some("A-01".into()));
    }
    #[test]
    fn tamper_and_production_flag_rejected() {
        let c = config();
        let r = draw(&c, ID, &"a".repeat(64), &"b".repeat(64)).unwrap();
        let mut e = Evidence {
            id: ID.into(),
            config: c,
            result: r.clone(),
            snapshot_hash: r.snapshot_hash,
            commitment: r.commitment,
            synthetic: Some(true),
            production_enabled: Some(false),
        };
        assert!(verify(&e).is_ok());
        e.result.ranking[0].rank = 999;
        assert_eq!(verify(&e), Err(LotteryError::RankingMismatch));
        e.production_enabled = Some(true);
        assert_eq!(verify(&e), Err(LotteryError::ProductionDisabled));
    }
    #[test]
    fn node_golden_vector() {
        let raw = include_str!("../../../tests/fixtures/lottery-vector.json");
        let e: Evidence = serde_json::from_str(raw).unwrap();
        assert!(verify(&e).is_ok());
    }
}
