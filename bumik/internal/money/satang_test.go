package money

import "testing"

func TestFormatBaht(t *testing.T) {
	cases := []struct {
		in   Satang
		want string
	}{
		{0, "0.00"},
		{100, "1.00"},
		{123456, "1234.56"},
		{-250, "-2.50"},
	}
	for _, tc := range cases {
		if got := FormatBaht(tc.in); got != tc.want {
			t.Fatalf("FormatBaht(%d) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
