//! Sprint 0 placeholder. No random draw or eligibility logic exists.
#[derive(Debug, PartialEq)]
pub enum LotteryError { NotImplemented, ProductionDisabled }
pub fn execute(production_requested: bool) -> Result<(), LotteryError> {
    if production_requested { Err(LotteryError::ProductionDisabled) }
    else { Err(LotteryError::NotImplemented) }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn real_draw_disabled() { assert_eq!(execute(true), Err(LotteryError::ProductionDisabled)); }
    #[test] fn no_fake_draw() { assert_eq!(execute(false), Err(LotteryError::NotImplemented)); }
}
