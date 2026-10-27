// Package nav builds the one script the desktop window runs before the ERP
// page replaces it. The script navigates the top-level webview, so the ERP
// origin owns the cookie jar. It is not a reverse proxy.
package nav

import (
	"encoding/json"
	"fmt"

	"github.com/Boom-Vitt/boombignose-erp/boombignose/internal/policy"
)

// Script returns a window.location.replace call for a loopback ERP URL.
// Any other target is refused, and the raw value is not copied into the error.
func Script(target string) (string, error) {
	if err := policy.AllowEndpoint(target); err != nil {
		return "", fmt.Errorf("erp url: %w", err)
	}
	quoted, err := json.Marshal(target)
	if err != nil {
		return "", err
	}
	return "window.location.replace(" + string(quoted) + ")", nil
}
