// Pure helpers for circuit compile-flag logic. Used from circuits/build.rs.

/// Returns `true` when the env var is set to a non-empty value that is not
/// `"0"`.
pub fn env_truthy(val: Option<&str>) -> bool {
    match val {
        Some(v) => !v.is_empty() && v != "0",
        None => false,
    }
}

/// Returns `true` when `circuit_name` should be compiled.
///
/// If `only` is `None` or empty, every circuit is selected.
/// If `only` is `Some("payroll_10_10,payrollWithdraw_10")`, only those stems
/// pass.
pub fn circuit_selected(circuit_name: &str, only: Option<&str>) -> bool {
    match only {
        None => true,
        Some(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                return true;
            }
            trimmed
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .any(|selected| selected == circuit_name)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_truthy_unset_is_false() {
        assert!(!env_truthy(None));
    }

    #[test]
    fn env_truthy_empty_is_false() {
        assert!(!env_truthy(Some("")));
    }

    #[test]
    fn env_truthy_zero_is_false() {
        assert!(!env_truthy(Some("0")));
    }

    #[test]
    fn env_truthy_one_is_true() {
        assert!(env_truthy(Some("1")));
    }

    #[test]
    fn env_truthy_arbitrary_is_true() {
        assert!(env_truthy(Some("yes")));
    }

    #[test]
    fn circuit_selected_none_selects_all() {
        assert!(circuit_selected("payroll_20", None));
    }

    #[test]
    fn circuit_selected_empty_string_selects_all() {
        assert!(circuit_selected("payroll_20", Some("")));
    }

    #[test]
    fn circuit_selected_match() {
        assert!(circuit_selected(
            "payroll_10_10",
            Some("payroll_10_10,payrollWithdraw_10")
        ));
    }

    #[test]
    fn circuit_selected_no_match() {
        assert!(!circuit_selected(
            "payroll_20",
            Some("payroll_10_10,payrollWithdraw_10")
        ));
    }

    #[test]
    fn circuit_selected_whitespace_handling() {
        assert!(circuit_selected("payroll_10_10", Some(" payroll_10_10 , ")));
    }
}
