//! Exact arithmetic for the platform's submitted price assumptions, not legal price approval.
//! Bounds: n <= 500, area <= 10^8 cm², weight <= 10^6, base < 10^11 VND/m².
//! Therefore sum(area) <= 5*10^10, sum(area*weight) <= 5*10^16,
//! coefficient numerator <= 5*10^16 and 2*raw + divisor < 1.01*10^36.
//! This is below u128::MAX (> 3.4*10^38); every operation remains checked.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Unit {
    pub code: String,
    pub building: String,
    pub floor: i64,
    pub position: u64,
    pub area_cm2: u64,
    #[serde(rename = "type")]
    pub unit_type: String,
    pub orientation: String,
    pub weight: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub units: Vec<Unit>,
    pub base_vnd_per_m2: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Quote {
    pub code: String,
    pub building: String,
    pub area_cm2: u64,
    pub coefficient_numerator: String,
    pub coefficient_denominator: String,
    pub total_vnd: String,
    pub unit_price_numerator: String,
    pub unit_price_denominator: String,
}

fn code_valid(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 24
        && value
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'-')
}
fn text_valid(value: &str) -> bool {
    let len = value.encode_utf16().count();
    (1..=60).contains(&len)
}
// ECMAScript String.trim whitespace, including BOM; Rust str::trim has a different Unicode set.
fn trim_js(value: &str) -> String {
    value
        .trim_matches(|c| {
            matches!(c, '\u{0009}'..='\u{000D}' | '\u{0020}' | '\u{00A0}' |
        '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' |
        '\u{205F}' | '\u{3000}' | '\u{FEFF}')
        })
        .to_owned()
}
fn add(a: u128, b: u128) -> Result<u128, &'static str> {
    a.checked_add(b).ok_or("Arithmetic overflow")
}
fn mul(a: u128, b: u128) -> Result<u128, &'static str> {
    a.checked_mul(b).ok_or("Arithmetic overflow")
}

/// Fractions are deliberately unreduced to preserve evidence compatibility with the TS reference.
pub fn calculate(mut input: Input) -> Result<Vec<Quote>, &'static str> {
    let bytes = input.base_vnd_per_m2.as_bytes();
    if bytes.is_empty()
        || bytes.len() > 11
        || bytes[0] == b'0'
        || !bytes.iter().all(u8::is_ascii_digit)
    {
        return Err("Invalid base price");
    }
    if input.units.is_empty() || input.units.len() > 500 {
        return Err("Invalid unit count");
    }
    let base: u128 = input
        .base_vnd_per_m2
        .parse()
        .map_err(|_| "Invalid base price")?;
    let mut codes = BTreeSet::new();
    let mut positions = BTreeSet::new();
    let mut totals: BTreeMap<String, (u128, u128)> = BTreeMap::new();
    for unit in &mut input.units {
        unit.code = trim_js(&unit.code);
        unit.building = trim_js(&unit.building);
        unit.unit_type = trim_js(&unit.unit_type);
        unit.orientation = trim_js(&unit.orientation);
        if !code_valid(&unit.code)
            || !code_valid(&unit.building)
            || !(-5..=200).contains(&unit.floor)
            || !(1..=500).contains(&unit.position)
            || !(10_000..=100_000_000).contains(&unit.area_cm2)
            || !(1..=1_000_000).contains(&unit.weight)
            || !text_valid(&unit.unit_type)
            || !text_valid(&unit.orientation)
        {
            return Err("Invalid unit");
        }
        if !codes.insert(unit.code.clone())
            || !positions.insert((unit.building.clone(), unit.floor, unit.position))
        {
            return Err("Duplicate unit code or position");
        }
        let total = totals.entry(unit.building.clone()).or_default();
        total.0 = add(total.0, u128::from(unit.area_cm2))?;
        total.1 = add(
            total.1,
            mul(u128::from(unit.area_cm2), u128::from(unit.weight))?,
        )?;
    }
    input.units.sort_by(|a, b| a.code.cmp(&b.code));
    input
        .units
        .into_iter()
        .map(|unit| {
            let (area, denominator) = totals.get(&unit.building).ok_or("Missing building")?;
            let numerator = mul(u128::from(unit.weight), *area)?;
            let unit_price_numerator = mul(base, numerator)?;
            let raw = mul(unit_price_numerator, u128::from(unit.area_cm2))?;
            let divisor = mul(10_000, *denominator)?;
            let rounded = add(mul(raw, 2)?, divisor)? / mul(divisor, 2)?;
            Ok(Quote {
                code: unit.code,
                building: unit.building,
                area_cm2: unit.area_cm2,
                coefficient_numerator: numerator.to_string(),
                coefficient_denominator: denominator.to_string(),
                total_vnd: rounded.to_string(),
                unit_price_numerator: unit_price_numerator.to_string(),
                unit_price_denominator: denominator.to_string(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn unit(code: &str, position: u64, area: u64, weight: u64) -> Unit {
        Unit {
            code: code.into(),
            building: "A".into(),
            floor: 1,
            position,
            area_cm2: area,
            unit_type: "2 phòng ngủ".into(),
            orientation: "Đông Nam".into(),
            weight,
        }
    }
    fn calc(units: Vec<Unit>, base: &str) -> Vec<Quote> {
        calculate(Input {
            units,
            base_vnd_per_m2: base.into(),
        })
        .unwrap()
    }
    #[test]
    fn exact_half_up_and_unreduced_evidence() {
        let q = calc(
            vec![unit("A2", 2, 10_000, 3), unit("A1", 1, 10_000, 1)],
            "101",
        );
        assert_eq!(
            q[0],
            Quote {
                code: "A1".into(),
                building: "A".into(),
                area_cm2: 10_000,
                coefficient_numerator: "20000".into(),
                coefficient_denominator: "40000".into(),
                total_vnd: "51".into(),
                unit_price_numerator: "2020000".into(),
                unit_price_denominator: "40000".into()
            }
        );
        assert_eq!(q[1].total_vnd, "152");
    }
    #[test]
    fn coefficients_depend_on_area_within_building_only() {
        let a = unit("A1", 1, 10_000, 1);
        let b = unit("A2", 2, 30_000, 3);
        let q = calc(vec![a.clone(), b.clone()], "100");
        assert_eq!(q[0].coefficient_numerator, "40000");
        assert_eq!(q[0].coefficient_denominator, "100000");
        assert_eq!(q[0].total_vnd, "40");
        let mut other = unit("B1", 1, 100_000_000, 1_000_000);
        other.building = "B".into();
        assert_eq!(calc(vec![a.clone(), b, other], "100")[..2], q);
        assert_ne!(calc(vec![a, unit("A2", 2, 10_000, 3)], "100")[0], q[0]);
    }
    #[test]
    fn maximum_bounds_preserve_amounts_above_javascript_safe_integer() {
        let units = (1..=500)
            .map(|i| {
                unit(
                    &format!("A{i:03}"),
                    i,
                    100_000_000,
                    if i == 1 { 1_000_000 } else { 1 },
                )
            })
            .collect();
        let q = calc(units, "99999999999");
        assert_eq!(q.len(), 500);
        assert!(q[0].total_vnd.parse::<u128>().unwrap() > 9_007_199_254_740_991);
        assert_eq!(q[0].coefficient_numerator, "50000000000000000");
        assert_eq!(q[0].coefficient_denominator, "100049900000000");
    }
    #[test]
    fn invalid_bounds_duplicates_and_overflow_are_rejected() {
        for base in [
            "0",
            "01",
            "1.5",
            "-1",
            "100000000000",
            "99999999999999999999999999999999999999999999",
        ] {
            assert!(calculate(Input {
                units: vec![unit("A", 1, 10_000, 1)],
                base_vnd_per_m2: base.into()
            })
            .is_err());
        }
        assert!(calculate(Input {
            units: vec![unit("A", 1, 10_000, 1), unit("A", 2, 10_000, 1)],
            base_vnd_per_m2: "1".into()
        })
        .is_err());
        assert!(calculate(Input {
            units: vec![unit("A", 1, 10_000, 1), unit("B", 1, 10_000, 1)],
            base_vnd_per_m2: "1".into()
        })
        .is_err());
        assert!(calculate(Input {
            units: vec![unit("A", 1, u64::MAX, u64::MAX)],
            base_vnd_per_m2: "1".into()
        })
        .is_err());
        assert!(mul(u128::MAX, 2).is_err());
        assert!(add(u128::MAX, 1).is_err());
    }
    #[test]
    fn ascii_sort_and_strict_json() {
        let q = calc(
            vec![
                unit("A2", 1, 10_000, 1),
                unit("A10", 2, 10_000, 1),
                unit("A-1", 3, 10_000, 1),
            ],
            "1",
        );
        assert_eq!(
            q.iter().map(|q| q.code.as_str()).collect::<Vec<_>>(),
            vec!["A-1", "A10", "A2"]
        );
        assert!(
            serde_json::from_str::<Input>(r#"{"units":[],"baseVndPerM2":"1","extra":true}"#)
                .is_err()
        );
    }
}
