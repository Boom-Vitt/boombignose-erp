package main

import (
	"testing"

	"github.com/Boom-Vitt/boombignose-erp/boombignose/internal/policy"
)

func TestRunCheckRequiresLocalEnv(t *testing.T) {
	t.Setenv("OPENROUTER_API_KEY", "")
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("NEXT_PUBLIC_SUPABASE_URL", "")
	t.Setenv("N8N_OUTBOUND_URL", "")
	t.Setenv("BOOMBIGNOSE_ERP_URL", "")
	if err := run([]string{"check"}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPENROUTER_API_KEY", "secret-value")
	err := run([]string{"check"})
	if err == nil {
		t.Fatal("expected refusal")
	}
	if policy.ErrNotLocal == nil {
		t.Fatal("sentinel missing")
	}
}

func TestRunCutoverDoesNotApply(t *testing.T) {
	t.Setenv("OPENROUTER_API_KEY", "")
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54421")
	t.Setenv("N8N_OUTBOUND_URL", "")
	t.Setenv("BOOMBIGNOSE_ERP_URL", "")
	if err := run([]string{"cutover"}); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"apply"}); err == nil {
		t.Fatal("unknown command must fail")
	}
}
