package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MoeForge/moego/ojson"
	claudeauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/claude"
	kimiauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/kimi"
	metaauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/meta"
	xaiauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/xai"
)

type providerContractRoundTripper func(*http.Request) (*http.Response, error)

func (roundTrip providerContractRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return roundTrip(request)
}

func TestPinnedProviderExecutorsStreamResponsesThroughBridge(t *testing.T) {
	secret := strings.Repeat("s", 32)
	successFixture := responsesProviderContractSSE
	tests := []struct {
		providerID string
		host       string
		path       string
		token      string
	}{
		{providerID: "claude", host: "api.anthropic.com", path: "/v1/messages", token: "claude-access"},
		{providerID: "xai", host: "cli-chat-proxy.grok.com", path: "/v1/responses", token: "xai-access"},
		{providerID: "meta", host: "api.meta.ai", path: "/v1/responses", token: "meta-key"},
		{providerID: "kimi", host: "api.kimi.com", path: "/coding/v1/responses", token: "kimi-access"},
	}

	for _, testCase := range tests {
		t.Run(testCase.providerID, func(t *testing.T) {
			modelID, supportsReasoning := providerContractModel(t, testCase.providerID)
			if testCase.providerID == "xai" && !supportsReasoning {
				t.Fatal("xAI catalog did not advertise a reasoning-capable fixture model")
			}
			credential := providerContractCredential(t, testCase.providerID, testCase.token)
			requestBody := providerContractRequest(t, modelID, testCase.providerID == "xai" && supportsReasoning)
			fixture := successFixture
			if testCase.providerID == "claude" {
				fixture = claudeMessagesProviderContractSSE
			}
			wantModel := modelID
			if strings.HasPrefix(testCase.providerID, "kimi") {
				wantModel = strings.TrimPrefix(modelID, "kimi-")
			}
			var callCount int
			var receivedBody []byte
			transport := providerContractRoundTripper(func(request *http.Request) (*http.Response, error) {
				callCount++
				if callCount != 1 {
					t.Fatalf("unexpected alternate request %d", callCount)
				}
				if request.URL.Host != testCase.host || request.URL.Path != testCase.path {
					t.Fatalf("upstream endpoint = %s%s, want %s%s", request.URL.Host, request.URL.Path, testCase.host, testCase.path)
				}
				if got := request.Header.Get("Authorization"); got != "Bearer "+testCase.token {
					t.Fatalf("Authorization = %q, want Bearer %s", got, testCase.token)
				}
				var err error
				receivedBody, err = io.ReadAll(request.Body)
				if err != nil {
					t.Fatal(err)
				}
				if got := ojson.GetBytes(receivedBody, "model").String(); got != wantModel {
					t.Fatalf("upstream model = %q, want %q; body = %s", got, wantModel, receivedBody)
				}
				return providerContractResponse(request, http.StatusOK, fixture), nil
			})
			response := serveProviderContractInference(t, secret, credential, modelID, requestBody, transport)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d; body = %s", response.Code, response.Body.String())
			}
			if response.Header().Get("X-Overlay-Provider-Id") != testCase.providerID {
				t.Fatalf("provider header = %q", response.Header().Get("X-Overlay-Provider-Id"))
			}
			stream := response.Body.String()
			for _, want := range []string{"response.output_text.delta", "response.function_call_arguments.delta", "lookup", "response.completed"} {
				if !strings.Contains(stream, want) {
					t.Fatalf("stream missing %q: %s", want, stream)
				}
			}
			if callCount != 1 {
				t.Fatalf("upstream requests = %d, want exactly one", callCount)
			}
			if testCase.providerID == "xai" && supportsReasoning &&
				ojson.GetBytes(receivedBody, "reasoning.effort").String() != "medium" {
				t.Fatalf("xAI reasoning was not preserved: %s", receivedBody)
			}
		})
	}

	t.Run("xai unauthorized response is sanitized", func(t *testing.T) {
		modelID, _ := providerContractModel(t, "xai")
		credential := providerContractCredential(t, "xai", "xai-secret")
		requestBody := providerContractRequest(t, modelID, false)
		var callCount int
		transport := providerContractRoundTripper(func(request *http.Request) (*http.Response, error) {
			callCount++
			return providerContractResponse(request, http.StatusUnauthorized, `{"error":"private provider detail xai-secret"}`), nil
		})
		response := serveProviderContractInference(t, secret, credential, modelID, requestBody, transport)
		if response.Code != http.StatusUnauthorized || strings.Contains(response.Body.String(), "private provider detail") ||
			strings.Contains(response.Body.String(), "xai-secret") {
			t.Fatalf("unsafe unauthorized response: %d %s", response.Code, response.Body.String())
		}
		if callCount != 1 {
			t.Fatalf("upstream requests = %d, want exactly one", callCount)
		}
	})
}

func providerContractModel(t *testing.T, providerID string) (string, bool) {
	t.Helper()
	models, err := providerCatalog(providerID, "")
	if err != nil || len(models) == 0 {
		t.Fatalf("%s catalog unavailable: %v", providerID, err)
	}
	firstModel, _ := models[0]["id"].(string)
	for _, model := range models {
		id, _ := model["id"].(string)
		levels, _ := model["reasoningLevels"].([]string)
		if len(levels) > 0 {
			return id, true
		}
	}
	return firstModel, false
}

func providerContractCredential(t *testing.T, providerID, accessToken string) envelope {
	t.Helper()
	expiry := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	switch providerID {
	case "claude":
		credential, err := newClaudeCredential(&claudeauth.ClaudeTokenStorage{
			Type: "claude", AccessToken: accessToken, RefreshToken: "refresh",
			Expire: expiry, DeviceIDs: []string{"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"},
		}, "fixture")
		if err != nil {
			t.Fatal(err)
		}
		return credential
	case "xai":
		credential, err := newXaiCredential(&xaiauth.TokenStorage{
			Type: "xai", AuthKind: "oauth", AccessToken: accessToken, RefreshToken: "refresh",
			Expire: expiry, BaseURL: xaiauth.DefaultAPIBaseURL,
		})
		if err != nil {
			t.Fatal(err)
		}
		return credential
	case "meta":
		credential, err := newMetaCredential(&metaauth.MetaTokenStorage{
			Type: "meta", AuthKind: "oauth", AccessToken: accessToken,
			APIKey: accessToken, BaseURL: metaauth.DefaultAPIBaseURL,
		}, "fixture")
		if err != nil {
			t.Fatal(err)
		}
		return credential
	case "kimi":
		domain := kimiauth.KimiDefaultDomain
		baseURL := kimiauth.KimiAPIBaseURL
		credential, err := newKimiCredential(&kimiauth.KimiTokenStorage{
			Type: providerID, Domain: domain, BaseURL: baseURL, DeviceID: "fixture-device",
			AccessToken: accessToken, RefreshToken: "refresh", Expired: expiry,
		})
		if err != nil {
			t.Fatal(err)
		}
		return credential
	default:
		t.Fatalf("unsupported provider fixture %q", providerID)
		return envelope{}
	}
}

func providerContractRequest(t *testing.T, modelID string, reasoning bool) []byte {
	t.Helper()
	request := ojson.NewDoc([]byte(`{}`))
	_ = request.Set("model", modelID)
	_ = request.Set("stream", true)
	_ = request.Set("store", false)
	_ = request.Set("input", []any{
		map[string]any{"type": "message", "role": "user", "content": []any{map[string]any{"type": "input_text", "text": "hello"}}},
	})
	_ = request.Set("tools", []any{
		map[string]any{"type": "function", "name": "lookup", "parameters": map[string]any{"type": "object", "properties": map[string]any{"value": map[string]any{"type": "string"}}}},
	})
	if reasoning {
		_ = request.Set("reasoning", map[string]any{"effort": "medium"})
	}
	return request.Bytes()
}

func serveProviderContractInference(t *testing.T, secret string, credential envelope, modelID string, requestBody []byte, transport http.RoundTripper) *httptest.ResponseRecorder {
	t.Helper()
	body := ojson.NewDoc([]byte(`{}`))
	_ = body.Set("connectionId", "connection-fixture")
	_ = body.Set("providerId", credential.ProviderID)
	_ = body.Set("credential", envelopeValue(credential))
	_ = body.Set("modelId", modelID)
	_ = body.SetRawBytes("request", requestBody)
	request := httptest.NewRequest(http.MethodPost, "/internal/v1/infer", strings.NewReader(string(body.Bytes())))
	request.Header.Set("Authorization", "Bearer "+secret)
	request = request.WithContext(context.WithValue(request.Context(), "cliproxy.roundtripper", transport))
	response := httptest.NewRecorder()
	(&bridge{secret: secret}).ServeHTTP(response, request)
	return response
}

func providerContractResponse(request *http.Request, status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    request,
	}
}

const responsesProviderContractSSE = "event: response.created\ndata: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_1\",\"status\":\"in_progress\",\"model\":\"fixture\"}}\n\n" +
	"event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"output_index\":0,\"content_index\":0,\"delta\":\"hello\"}\n\n" +
	"event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"output_index\":1,\"item\":{\"type\":\"function_call\",\"id\":\"fc_1\",\"call_id\":\"call_1\",\"name\":\"lookup\",\"arguments\":\"\"}}\n\n" +
	"event: response.function_call_arguments.delta\ndata: {\"type\":\"response.function_call_arguments.delta\",\"output_index\":1,\"item_id\":\"fc_1\",\"delta\":\"{\\\"value\\\":\\\"ok\\\"}\"}\n\n" +
	"event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_1\",\"status\":\"completed\",\"output\":[]}}\n\n"

const claudeMessagesProviderContractSSE = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-fixture\",\"content\":[],\"stop_reason\":null,\"usage\":{\"input_tokens\":1,\"output_tokens\":0}}}\n\n" +
	"event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n" +
	"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\n" +
	"event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\n" +
	"event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"call_1\",\"name\":\"lookup\",\"input\":{}}}\n\n" +
	"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"value\\\":\\\"ok\\\"}\"}}\n\n" +
	"event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":1}\n\n" +
	"event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"output_tokens\":2}}\n\n" +
	"event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
