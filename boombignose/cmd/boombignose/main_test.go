package main

import (
	"strings"
	"testing"

	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/policy"
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

func TestRunServeRequiresBundle(t *testing.T) {
	t.Setenv("OPENROUTER_API_KEY", "")
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("NEXT_PUBLIC_SUPABASE_URL", "")
	t.Setenv("N8N_OUTBOUND_URL", "")
	t.Setenv("OLLAMA_HOST", "")
	t.Setenv("BOOMBIGNOSE_ERP_URL", "")
	t.Setenv("BOOMBIGNOSE_DATA", t.TempDir())
	t.Setenv("BOOMBIGNOSE_BUNDLE", t.TempDir())
	err := run([]string{"serve"})
	if err == nil {
		t.Fatal("empty bundle must fail")
	}
	if strings.Contains(err.Error(), "http://") || strings.Contains(err.Error(), "sk-") {
		t.Fatalf("error leaked a remote value: %v", err)
	}
}

func TestRunPullModelWithoutBinary(t *testing.T) {
	t.Setenv("OPENROUTER_API_KEY", "")
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("NEXT_PUBLIC_SUPABASE_URL", "")
	t.Setenv("N8N_OUTBOUND_URL", "")
	t.Setenv("OLLAMA_HOST", "")
	t.Setenv("BOOMBIGNOSE_ERP_URL", "")
	t.Setenv("BOOMBIGNOSE_BUNDLE", "")
	t.Setenv("PATH", t.TempDir())
	err := run([]string{"pull-model"})
	if err == nil {
		t.Fatal("missing ollama must fail")
	}
	if strings.Contains(err.Error(), "http://") || strings.Contains(err.Error(), "sk-") {
		t.Fatalf("error leaked a remote value: %v", err)
	}
}

func TestRunStopOnEmptyData(t *testing.T) {
	t.Setenv("BOOMBIGNOSE_BUNDLE", "")
	t.Setenv("BOOMBIGNOSE_DATA", t.TempDir())
	if err := run([]string{"stop"}); err != nil {
		t.Fatal(err)
	}
}
