package policy

import (
	"strings"
	"testing"
)

func TestAllowEndpoint(t *testing.T) {
	ok := []string{
		"",
		"   ",
		"http://127.0.0.1:3100",
		"http://127.0.0.1:54421",
		"http://localhost:3100/login",
		"http://[::1]:3100",
	}
	for _, raw := range ok {
		if err := AllowEndpoint(raw); err != nil {
			t.Fatalf("AllowEndpoint(%q) = %v", raw, err)
		}
	}
	bad := []string{
		"https://openrouter.ai/api/v1/chat/completions",
		"https://api.resend.com/emails",
		"https://api.openai.com/v1",
		"https://api.anthropic.com",
		"https://xyzcompany.supabase.co",
		"https://example.com",
		"file:///etc/passwd",
		"not a url",
	}
	for _, raw := range bad {
		if err := AllowEndpoint(raw); err == nil {
			t.Fatalf("AllowEndpoint(%q) accepted a non-local endpoint", raw)
		}
	}
}

func TestCheckEnv(t *testing.T) {
	if err := CheckEnv(func(string) string { return "" }); err != nil {
		t.Fatal(err)
	}
	local := map[string]string{"NEXT_PUBLIC_SUPABASE_URL": "http://127.0.0.1:54421"}
	if err := CheckEnv(func(k string) string { return local[k] }); err != nil {
		t.Fatal(err)
	}
	err := CheckEnv(func(k string) string {
		if k == "OPENROUTER_API_KEY" {
			return "secret-value"
		}
		return ""
	})
	if err == nil {
		t.Fatal("expected cloud key to be refused")
	}
	if strings.Contains(err.Error(), "secret-value") {
		t.Fatal("error leaked the secret value")
	}
	if err := CheckEnv(func(k string) string {
		if k == "N8N_OUTBOUND_URL" {
			return "https://hooks.example.com/hook"
		}
		return ""
	}); err == nil {
		t.Fatal("expected hosted webhook to be refused")
	}
}
