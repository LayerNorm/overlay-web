package main

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MoeForge/moego/ojson"
	codexauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/codex"
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

func TestInferUsesConnectionIdentityAndStreamsTranslatorFrames(t *testing.T) {
	models, err := catalog("plus")
	if err != nil || len(models) == 0 {
		t.Fatalf("Codex Plus catalog unavailable: %v", err)
	}
	modelID := models[0]["id"]
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
	modelID := models[0]["id"]
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

type providerStatus int

func (status providerStatus) Error() string   { return "private provider detail" }
func (status providerStatus) StatusCode() int { return int(status) }

func TestSafeRefreshErrorsDistinguishRateLimitFromReconnection(t *testing.T) {
	for _, test := range []struct {
		status int
		code   string
	}{
		{http.StatusTooManyRequests, "rate_limited"},
		{http.StatusUnauthorized, "reconnect_required"},
		{http.StatusBadGateway, "reconnect_required"},
	} {
		_, code, message := safeRefreshError(providerStatus(test.status))
		if code != test.code {
			t.Fatalf("status %d code = %q", test.status, code)
		}
		if strings.Contains(message, "private provider detail") {
			t.Fatal("refresh error leaked provider details")
		}
	}
}
