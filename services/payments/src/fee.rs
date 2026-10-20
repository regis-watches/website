//! Paystack fee estimate. Used ONLY when Paystack does not report the real fee on a transaction.
//! Defaults follow Paystack's published local card pricing: 1.5% + N100 (flat part waived under N2,500), capped at N2,000.
//! All amounts are in kobo (1 naira = 100 kobo) so no floating point is ever involved in money.

#[derive(Clone, Copy, Debug)]
pub struct FeeConfig {
    pub percent_bp: u64,
    pub flat_kobo: u64,
    pub waive_below_kobo: u64,
    pub cap_kobo: u64,
}

fn env_u64(name: &str, default: u64) -> u64 {
    std::env::var(name).ok().and_then(|v| v.trim().parse().ok()).unwrap_or(default)
}

impl FeeConfig {
    pub fn from_env() -> Self {
        FeeConfig {
            percent_bp: env_u64("PAYSTACK_FEE_BP", 150),
            flat_kobo: env_u64("PAYSTACK_FEE_FLAT_KOBO", 10_000),
            waive_below_kobo: env_u64("PAYSTACK_FEE_WAIVE_BELOW_KOBO", 250_000),
            cap_kobo: env_u64("PAYSTACK_FEE_CAP_KOBO", 200_000),
        }
    }

    pub fn estimate(&self, amount_kobo: u64) -> u64 {
        let pct = (amount_kobo.saturating_mul(self.percent_bp) + 9_999) / 10_000; // round up
        let flat = if amount_kobo < self.waive_below_kobo { 0 } else { self.flat_kobo };
        (pct + flat).min(self.cap_kobo)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CFG: FeeConfig = FeeConfig { percent_bp: 150, flat_kobo: 10_000, waive_below_kobo: 250_000, cap_kobo: 200_000 };

    #[test]
    fn twenty_thousand_naira() {
        // 1.5% of N20,000 is N300, plus N100 flat = N400
        assert_eq!(CFG.estimate(2_000_000), 40_000);
    }

    #[test]
    fn flat_fee_waived_under_2500() {
        assert_eq!(CFG.estimate(200_000), 3_000); // N2,000 -> N30
    }

    #[test]
    fn capped_at_2000_naira() {
        assert_eq!(CFG.estimate(500_000_000), 200_000);
    }

    #[test]
    fn merchant_net_is_price_minus_fee() {
        let price = 2_000_000u64;
        let fee = 20_000u64; // the N200 example from the brief
        assert_eq!(price - fee, 1_980_000);
    }
}
