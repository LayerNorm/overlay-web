package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/MoeForge/moego/ojson"
	claudeauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/claude"
	codexauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/codex"
	kimiauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/kimi"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/registry"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
)

func TestBridgeRequiresServiceBearer(t *testing.T) {
	handler := &bridge{secret: strings.Repeat("s", 32)}
	request := httptest.NewRequest(http.MethodPost, "/internal/v1/authorize", bytes.NewReader([]byte("{}")))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if strings.Contains(response.Body.String(), strings.Repeat("s", 8)) {
		t.Fatal("response leaked service secret")
	}
}

func TestBridgeRejectsCredentialAuthorityAndStatefulInference(t *testing.T) {
	handler := &bridge{secret: strings.Repeat("s", 32)}
	request := httptest.NewRequest(http.MethodPost, "/internal/v1/infer", strings.NewReader(`{"connectionId":"c","modelId":"m","credential":{"backend":"cliproxyapi","version":1,"providerId":"codex","metadata":{}},"request":{"model":"m","stream":true,"previous_response_id":"r"}}`))
	request.Header.Set("Authorization", "Bearer "+strings.Repeat("s", 32))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	stateful := ojson.NewDoc([]byte(`{"previous_response_id":"response"}`))
	if !hasStatefulOption(stateful) {
		t.Fatal("expected previous response state to be rejected")
	}
}

func TestUnknownPlanDoesNotGetCatalog(t *testing.T) {
	if _, err := catalog("unrecognized"); err == nil {
		t.Fatal("expected unknown plan to fail")
	}
}

func TestCatalogReasoningLevelsUseOnlyPinnedCanonicalThinkingLevels(t *testing.T) {
	got := reasoningLevels(&registry.ModelInfo{
		Thinking: &registry.ThinkingSupport{Levels: []string{"low", " high ", "unknown", "low", "none"}},
	})
	want := []string{"low", "high", "none"}
	if len(got) != len(want) {
		t.Fatalf("levels = %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("levels = %v, want %v", got, want)
		}
	}
}

func TestProviderCredentialIdentityAndKimiDomainAreBound(t *testing.T) {
	for _, providerID := range []string{"codex", "claude", "xai", "meta", "kimi", "kimi-ai", "devin"} {
		if !supportedProvider(providerID) {
			t.Fatalf("provider %q is not supported", providerID)
		}
	}
	credential, err := providerCredential("claude", []byte(`{"access_token":"opaque"}`), time.Now().Add(time.Hour), false, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := readTokenStorage(credential, "xai"); ok {
		t.Fatal("credential was accepted for a different provider")
	}
	if _, ok := readTokenStorage(credential, "claude"); !ok {
		t.Fatal("credential was not accepted for its provider")
	}

	storage := &kimiauth.KimiTokenStorage{
		AccessToken: "access", RefreshToken: "refresh", Type: "kimi-ai",
		Domain: kimiauth.KimiAIDomain, DeviceID: "connection-device",
		Expired: time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	}
	kimiCredential, err := newKimiCredential("kimi-ai", storage)
	if err != nil {
		t.Fatal(err)
	}
	decoded, ok := decodeKimiCredential(kimiCredential)
	if !ok || decoded.Domain != kimiauth.KimiAIDomain || decoded.DeviceID != "connection-device" {
		t.Fatalf("Kimi.ai identity was not preserved: %#v", decoded)
	}
	if _, err := newKimiCredential("kimi", storage); err == nil {
		t.Fatal("Kimi.ai credential was accepted for the kimi domain")
	}
	storage.Expired = ""
	if _, err := newKimiCredential("kimi-ai", storage); err == nil {
		t.Fatal("Kimi credential without an upstream expiry was treated as non-expiring")
	}
}

func TestClaudeCallbackStateMismatchIsRejectedBeforeExchange(t *testing.T) {
	callback, err := url.Parse(claudeauth.RedirectURI)
	if err != nil {
		t.Fatal(err)
	}
	query := callback.Query()
	query.Set("code", "authorization-code")
	query.Set("state", "wrong-state")
	callback.RawQuery = query.Encode()
	pending := pendingEnvelope{
		Backend: backendName, Version: 1, ProviderID: "claude",
		Metadata:  []byte(`{"state":"expected-state","codeVerifier":"opaque-verifier"}`),
		ExpiresAt: time.Now().Add(10 * time.Minute).UnixMilli(),
		Interval:  5, CallbackRequired: true,
	}
	if !validPendingState(pending, "claude") || !ojsonObject(pending.Metadata) {
		t.Fatalf("callback pending state was invalid: %#v", pending)
	}
	request := httptest.NewRequest(http.MethodPost, "/internal/v1/complete", nil)
	response := httptest.NewRecorder()
	(&bridge{}).completeProvider(response, request, pending, callback.String())
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"invalid_callback"`) {
		t.Fatalf("callback mismatch response = %d %s", response.Code, response.Body.String())
	}
}

func TestNormalizeSSEFramePreservesTranslatorDataPrefix(t *testing.T) {
	translatorFrame := []byte(`data: {"type":"response.output_text.delta","delta":"hello"}`)
	got := normalizeSSEFrame(translatorFrame)
	if strings.Count(string(got), "data:") != 1 {
		t.Fatalf("translator frame was prefixed more than once: %q", got)
	}
	if string(got) != string(append(translatorFrame, '\n', '\n')) {
		t.Fatalf("frame = %q", got)
	}
}

func TestNormalizeSSEFramePreservesTranslatorEventFields(t *testing.T) {
	for _, field := range []string{"event: response.created", "id: 1", "retry: 1000", ": heartbeat"} {
		got := string(normalizeSSEFrame([]byte(field)))
		if got != field+"\n\n" {
			t.Fatalf("SSE field changed: %q", got)
		}
	}
	combined := "event: response.completed\ndata: {\"type\":\"response.completed\"}\n\n"
	if got := string(normalizeSSEFrame([]byte(combined))); got != combined {
		t.Fatalf("combined event changed: %q", got)
	}
}

func TestInferUsesConnectionIdentityAndStreamsTranslatorFrames(t *testing.T) {
	models, err := catalog("plus")
	if err != nil || len(models) == 0 {
		t.Fatalf("Codex Plus catalog unavailable: %v", err)
	}
	modelID := models[0]["id"].(string)
	credential, err := newCredential(&codexauth.CodexTokenStorage{
		AccessToken: "access", RefreshToken: "refresh", PlanType: "plus",
		Expire: time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatal(err)
	}
	body := ojson.NewDoc([]byte("{}"))
	_ = body.Set("connectionId", "connection-selected")
	_ = body.Set("modelId", modelID)
	_ = body.Set("credential", envelopeValue(credential))
	_ = body.Set("request", map[string]any{
		"model": modelID, "stream": true, "store": false,
	})
	var selectedID string
	handler := &bridge{
		secret: strings.Repeat("s", 32),
		executeStream: func(_ context.Context, auth *cliproxyauth.Auth, _ cliproxyexecutor.Request, options cliproxyexecutor.Options) (*cliproxyexecutor.StreamResult, error) {
			selectedID = auth.ID
			if !options.Stream {
				t.Fatal("executor was not asked to stream")
			}
			chunks := make(chan cliproxyexecutor.StreamChunk, 1)
			chunks <- cliproxyexecutor.StreamChunk{Payload: []byte(`data: {"type":"response.completed"}`)}
			close(chunks)
			return &cliproxyexecutor.StreamResult{Chunks: chunks}, nil
		},
	}
	request := httptest.NewRequest(http.MethodPost, "/internal/v1/infer", bytes.NewReader(body.Bytes()))
	request.Header.Set("Authorization", "Bearer "+strings.Repeat("s", 32))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if selectedID != "connection-selected" {
		t.Fatalf("executor auth ID = %q", selectedID)
	}
	if got := strings.Count(response.Body.String(), "data:"); got != 1 {
		t.Fatalf("stream frame count = %d; body = %q", got, response.Body.String())
	}
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", response.Code, response.Body.String())
	}
}

type failingWriter struct {
	header http.Header
}

func (w *failingWriter) Header() http.Header {
	if w.header == nil {
		w.header = make(http.Header)
	}
	return w.header
}

func (*failingWriter) WriteHeader(int) {}

func (*failingWriter) Write([]byte) (int, error) {
	return 0, errors.New("write failed")
}

func (*failingWriter) Flush() {}

func TestInferCancelsExecutorWhenStreamWriteFails(t *testing.T) {
	models, err := catalog("plus")
	if err != nil || len(models) == 0 {
		t.Fatalf("Codex Plus catalog unavailable: %v", err)
	}
	modelID := models[0]["id"].(string)
	credential, err := newCredential(&codexauth.CodexTokenStorage{
		AccessToken: "access", RefreshToken: "refresh", PlanType: "plus",
		Expire: time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatal(err)
	}
	body := ojson.NewDoc([]byte("{}"))
	_ = body.Set("connectionId", "connection-selected")
	_ = body.Set("modelId", modelID)
	_ = body.Set("credential", envelopeValue(credential))
	_ = body.Set("request", map[string]any{"model": modelID, "stream": true, "store": false})
	var executionContext context.Context
	handler := &bridge{
		secret: strings.Repeat("s", 32),
		executeStream: func(ctx context.Context, _ *cliproxyauth.Auth, _ cliproxyexecutor.Request, _ cliproxyexecutor.Options) (*cliproxyexecutor.StreamResult, error) {
			executionContext = ctx
			chunks := make(chan cliproxyexecutor.StreamChunk, 1)
			chunks <- cliproxyexecutor.StreamChunk{Payload: []byte(`data: {"type":"response.completed"}`)}
			return &cliproxyexecutor.StreamResult{Chunks: chunks}, nil
		},
	}
	request := httptest.NewRequest(http.MethodPost, "/internal/v1/infer", bytes.NewReader(body.Bytes()))
	request.Header.Set("Authorization", "Bearer "+strings.Repeat("s", 32))
	handler.ServeHTTP(&failingWriter{}, request)
	if executionContext == nil || !errors.Is(executionContext.Err(), context.Canceled) {
		t.Fatal("executor context was not canceled after a stream write failure")
	}
}

type refreshRoundTripFunc func(*http.Request) (*http.Response, error)

func (f refreshRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestSafeRefreshErrorsUseActualUpstreamRefreshStatus(t *testing.T) {
	for _, test := range []struct {
		name       string
		status     int
		code       string
		wantStatus int
	}{
		{"rate-limited", http.StatusTooManyRequests, "rate_limited", http.StatusTooManyRequests},
		{"invalidated", http.StatusUnauthorized, "reconnect_required", http.StatusUnauthorized},
		{"uncertain", http.StatusBadGateway, "reconnect_required", http.StatusBadGateway},
	} {
		auth := codexauth.NewCodexAuthWithHTTPClient(nil, &http.Client{
			Transport: refreshRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: test.status,
					Body:       io.NopCloser(strings.NewReader("private provider text")),
					Header:     make(http.Header),
					Request:    request,
				}, nil
			}),
		})
		_, err := auth.RefreshTokens(context.Background(), "safe-refresh-"+test.name)
		if err == nil {
			t.Fatalf("%s: expected upstream refresh error", test.name)
		}
		status, code, message := safeRefreshError(err)
		if status != test.wantStatus || code != test.code {
			t.Fatalf("status/code = %d/%q, want %d/%q", status, code, test.wantStatus, test.code)
		}
		if strings.Contains(message, "private provider text") {
			t.Fatal("refresh error leaked provider details")
		}
	}
}

func TestUnknownCatalogDoesNotDiscardAuthorizedCredentials(t *testing.T) {
	credential, err := newCredential(&codexauth.CodexTokenStorage{
		AccessToken: "access", RefreshToken: "refresh", PlanType: "unrecognized",
		Expire: time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("authorized credential discarded: %v", err)
	}
	storage, ok := decodeStorage(credential, true)
	if !ok || storage.PlanType != "unrecognized" {
		t.Fatal("credential did not survive storage round trip")
	}
	if _, err := catalog(storage.PlanType); err == nil {
		t.Fatal("unknown catalog must still fail closed")
	}
}

func TestProVariantsUseExplicitPinnedClientPlanMembership(t *testing.T) {
	for _, plan := range []string{"prolite", "promax"} {
		models, err := catalog(plan)
		if err != nil || len(models) == 0 {
			t.Fatalf("known plan %s has no catalog: %v", plan, err)
		}
		for _, model := range models {
			id := model["id"].(string)
			found := false
			ojson.ParseBytes(registry.GetCodexClientModelsJSON()).Get("models").ForEach(func(_, candidate ojson.Result) bool {
				if candidate.Get("slug").String() != id {
					return true
				}
				candidate.Get("available_in_plans").ForEach(func(_, value ojson.Result) bool {
					if value.String() == plan {
						found = true
					}
					return true
				})
				return true
			})
			if !found {
				t.Fatalf("model %s not explicitly advertised for %s", id, plan)
			}
		}
	}
}
