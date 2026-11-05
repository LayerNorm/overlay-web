package main

import (
	"bytes"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/runtime/executor/helps"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	"google.golang.org/protobuf/encoding/protowire"
)

func TestPinnedDevinExecutorStreamsResponsesThroughBridge(t *testing.T) {
	const token = "devin-contract-token"
	const model = "devin/swe-2"
	credential, err := newDevinCredential(&cliproxyauth.Auth{
		ID: "fixture", Provider: "devin", Label: "fixture",
		Metadata:   map[string]any{"type": "devin", "session_token": token},
		Attributes: map[string]string{},
	})
	if err != nil {
		t.Fatal(err)
	}
	requestBody := providerContractRequest(t, model, true)
	var calls int
	transport := providerContractRoundTripper(func(request *http.Request) (*http.Response, error) {
		calls++
		if calls != 1 || request.URL.Host != "server.codeium.com" || request.URL.Path != "/exa.api_server_pb.ApiServerService/GetChatMessage" {
			t.Fatalf("unexpected request %d to %s", calls, request.URL)
		}
		if request.Header.Get("Authorization") != "Basic "+token+"-"+token {
			t.Fatal("incorrect Devin credential")
		}
		if request.Header.Get("Content-Type") != "application/connect+proto" {
			t.Fatal("incorrect Devin wire format")
		}
		flag, body, err := helps.ReadConnectFrame(request.Body)
		if err != nil || flag != helps.ConnectFlagData {
			t.Fatalf("request framing: flag=%d, error=%v", flag, err)
		}
		if got := string(devinContractField(t, body, 21)); got != "swe-2-medium" {
			t.Fatalf("selected model/reasoning = %q, want swe-2-medium", got)
		}
		metadata := devinContractField(t, body, 1)
		if string(devinContractField(t, metadata, 3)) != token {
			t.Fatal("incorrect wire credential")
		}
		tool := devinContractField(t, body, 10)
		if got := string(devinContractField(t, tool, 1)); got != "lookup" {
			t.Fatalf("outbound tool = %q, want lookup", got)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/connect+proto"}},
			Body:       io.NopCloser(bytes.NewReader(devinContractFrames())), Request: request,
		}, nil
	})
	response := serveProviderContractInference(t, strings.Repeat("s", 32), credential, model, requestBody, transport)
	if response.Code != http.StatusOK || response.Header().Get("X-Overlay-Provider-Id") != "devin" {
		t.Fatalf("bridge response: %d %s", response.Code, response.Body.String())
	}
	for _, event := range []string{"response.output_text.delta", "hello", "response.function_call_arguments.delta", "lookup", "response.completed"} {
		if !strings.Contains(response.Body.String(), event) {
			t.Fatalf("stream missing %q: %s", event, response.Body.String())
		}
	}
	if calls != 1 {
		t.Fatalf("upstream calls = %d, want 1", calls)
	}
}

func devinContractField(t *testing.T, payload []byte, target protowire.Number) []byte {
	t.Helper()
	for len(payload) > 0 {
		number, kind, n := protowire.ConsumeTag(payload)
		if n < 0 {
			t.Fatal("invalid protobuf tag")
		}
		payload = payload[n:]
		if kind == protowire.BytesType && number == target {
			value, n := protowire.ConsumeBytes(payload)
			if n < 0 {
				t.Fatal("invalid protobuf bytes")
			}
			return value
		}
		n = protowire.ConsumeFieldValue(number, kind, payload)
		if n < 0 {
			t.Fatal("invalid protobuf field")
		}
		payload = payload[n:]
	}
	t.Fatalf("missing protobuf field %d", target)
	return nil
}

func devinContractFrames() []byte {
	text := protowire.AppendString(protowire.AppendTag(nil, 3, protowire.BytesType), "hello")
	tool := protowire.AppendString(protowire.AppendTag(nil, 1, protowire.BytesType), "call_1")
	tool = protowire.AppendString(protowire.AppendTag(tool, 2, protowire.BytesType), "lookup")
	tool = protowire.AppendString(protowire.AppendTag(tool, 3, protowire.BytesType), `{"value":"ok"}`)
	toolFrame := protowire.AppendBytes(protowire.AppendTag(nil, 6, protowire.BytesType), tool)
	frames := helps.WrapConnectEnvelope(text)
	frames = append(frames, helps.WrapConnectEnvelope(toolFrame)...)
	return append(frames, helps.WrapConnectEnvelopeWithFlag(helps.ConnectFlagEndStream, []byte(`{}`))...)
}
