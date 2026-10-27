// Package money is a local integer-satang helper.
// It does not call a network and it does not replace the Postgres finance functions.
package money

import "fmt"

// Satang is 1/100 of a baht.
type Satang int64

// FormatBaht prints a fixed two-decimal amount using integer arithmetic.
func FormatBaht(s Satang) string {
	sign := ""
	v := int64(s)
	if v < 0 {
		sign = "-"
		v = -v
	}
	return fmt.Sprintf("%s%d.%02d", sign, v/100, v%100)
}
