package main

import "testing"

func TestValidMonthKey(t *testing.T) {
	cases := map[string]bool{"2026-10": true, "2026-01": true, "2026-13": false, "26-10": false, "2026-1": false}
	for input, want := range cases {
		if got := validMonthKey(input); got != want {
			t.Fatalf("validMonthKey(%q)=%v want %v", input, got, want)
		}
	}
}

func TestNonNegative(t *testing.T) {
	if nonNegative(-10) != 0 || nonNegative(25) != 25 {
		t.Fatal("nonNegative failed")
	}
}
