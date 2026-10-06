package main

import "testing"

func TestNextRecurringDatePreservesMonthEndAnchor(t *testing.T) {
	next, err := nextRecurringDate("2026-01-31", "monthly", 31)
	if err != nil || next != "2026-02-28" {
		t.Fatalf("expected 2026-02-28, got %s (%v)", next, err)
	}
	next, err = nextRecurringDate(next, "monthly", 31)
	if err != nil || next != "2026-03-31" {
		t.Fatalf("expected 2026-03-31, got %s (%v)", next, err)
	}
}

func TestFingerprintNormalizesDescription(t *testing.T) {
	base := TransactionInput{AmountPaise: 50000, Description: "Petrol", PaymentMethodID: 2, TransactionDate: "2026-10-02"}
	other := base
	other.Description = "  PETROL   "
	if fingerprint(base) != fingerprint(other) {
		t.Fatal("description normalization should produce same fingerprint")
	}
}

func TestValidateDate(t *testing.T) {
	for _, tc := range []struct {
		in string
		ok bool
	}{{"2026-10-02", true}, {"2026-02-30", false}, {"02-10-2026", false}} {
		if got := validateDate(tc.in); got != tc.ok {
			t.Fatalf("validateDate(%q)=%v want %v", tc.in, got, tc.ok)
		}
	}
}
