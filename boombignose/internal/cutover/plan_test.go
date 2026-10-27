package cutover

import "testing"

func TestPlanDoesNotNameARemoteHost(t *testing.T) {
	text := Plan()
	for _, banned := range []string{"supabase.co", "https://", "DROP TABLE", "delete from"} {
		if stringsContains(text, banned) {
			t.Fatalf("plan contains %q", banned)
		}
	}
	if !stringsContains(text, "127.0.0.1:3100") {
		t.Fatal("plan missing loopback target")
	}
	if err := RefuseApply(); err == nil {
		t.Fatal("apply must be refused")
	}
}

func stringsContains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
