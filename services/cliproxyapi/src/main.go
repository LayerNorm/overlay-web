package main

import (
	"bytes"
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/MoeForge/moego/ojson"
	codexauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/codex"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/registry"
	runtimeexecutor "github.com/router-for-me/CLIProxyAPI/v8/internal/runtime/executor"
	_ "github.com/router-for-me/CLIProxyAPI/v8/internal/translator/claude/openai/responses"
	_ "github.com/router-for-me/CLIProxyAPI/v8/internal/translator/codex/openai/responses"
	_ "github.com/router-for-me/CLIProxyAPI/v8/internal/translator/openai/interactions/responses"
	_ "github.com/router-for-me/CLIProxyAPI/v8/internal/translator/openai/openai/responses"
	sdkauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/auth"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
	sdktranslator "github.com/router-for-me/CLIProxyAPI/v8/sdk/translator"
	"github.com/sirupsen/logrus"
)

const (
	// A 32 MiB inference request (several images) plus its credential envelope.
	maxBodyBytes = 33 << 20
	backendName  = "cliproxyapi"
	providerName = "codex"
)

type envelope struct {
	Backend     string
	Version     int
	ProviderID  string
	Metadata    []byte
	ExpiresAt   *int64
	NonExpiring bool
	DisplayName string
}

type pendingEnvelope struct {
	Backend          string
	Version          int
	ProviderID       string
	Metadata         []byte
	ExpiresAt        int64
	Interval         int
	CallbackRequired bool
}

type bridge struct {
	secret        string
	executeStream func(context.Context, *cliproxyauth.Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (*cliproxyexecutor.StreamResult, error)
}

func main() {
	if err := run(); err != nil {
		log.Print("private subscription bridge failed to start")
		os.Exit(1)
	}
}

func run() error {
	secret := os.Getenv("OVERLAY_CLIPROXYAPI_SECRET")
	if len(secret) < 32 {
		return errors.New("OVERLAY_CLIPROXYAPI_SECRET must contain at least 32 characters")
	}
	port := 8317
	if raw := strings.TrimSpace(os.Getenv("PORT")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 65535 {
			return errors.New("PORT must be a valid TCP port")
		}
		port = value
	}
	logrus.SetOutput(io.Discard)
	server := &http.Server{
		Addr:              fmt.Sprintf(":%d", port),
		Handler:           &bridge{secret: secret},
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("private subscription bridge listening on port %d", port)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func (b *bridge) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !authorized(r, b.secret) {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Service authentication is required.")
		return
	}
	switch r.URL.Path {
	case "/healthz":
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	case "/internal/v1/authorize":
		if requireMethod(w, r, http.MethodPost) {
			b.authorize(w, r)
		}
	case "/internal/v1/poll":
		if requireMethod(w, r, http.MethodPost) {
			b.poll(w, r)
		}
	case "/internal/v1/complete":
		if requireMethod(w, r, http.MethodPost) {
			b.complete(w, r)
		}
	case "/internal/v1/refresh":
		if requireMethod(w, r, http.MethodPost) {
			b.refresh(w, r)
		}
	case "/internal/v1/models":
		if requireMethod(w, r, http.MethodPost) {
			b.models(w, r)
		}
	case "/internal/v1/infer":
		if requireMethod(w, r, http.MethodPost) {
			b.infer(w, r)
		}
	default:
		writeError(w, http.StatusNotFound, "not_found", "Not found.")
	}
}

func authorized(r *http.Request, secret string) bool {
	const prefix = "Bearer "
	value := r.Header.Get("Authorization")
	if !strings.HasPrefix(value, prefix) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(strings.TrimPrefix(value, prefix)), []byte(secret)) == 1
}

func requireMethod(w http.ResponseWriter, r *http.Request, method string) bool {
	if r.Method == method {
		return true
	}
	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed.")
	return false
}

func decodeBody(w http.ResponseWriter, r *http.Request) (*ojson.Doc, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	raw, err := io.ReadAll(r.Body)
	if err != nil || !ojson.ParseBytes(raw).IsObject() {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid request.")
		return nil, false
	}
	return ojson.NewDoc(raw), true
}

func onlyFields(object ojson.Result, allowed ...string) bool {
	fields := make(map[string]struct{}, len(allowed))
	for _, field := range allowed {
		fields[field] = struct{}{}
	}
	valid := true
	object.ForEach(func(key, _ ojson.Result) bool {
		if _, ok := fields[key.String()]; !ok {
			valid = false
			return false
		}
		return true
	})
	return valid
}

func decodeEnvelope(doc *ojson.Doc, prefix string) envelope {
	expiry := doc.Get(prefix + ".expiresAt")
	var expiresAt *int64
	if expiry.Exists() && expiry.Raw != "null" {
		value := expiry.Int()
		expiresAt = &value
	}
	return envelope{
		Backend:     doc.Get(prefix + ".backend").String(),
		Version:     int(doc.Get(prefix + ".version").Int()),
		ProviderID:  doc.Get(prefix + ".providerId").String(),
		Metadata:    []byte(doc.Get(prefix + ".metadata").Raw),
		ExpiresAt:   expiresAt,
		NonExpiring: doc.Get(prefix + ".nonExpiring").Bool(),
		DisplayName: doc.Get(prefix + ".displayName").String(),
	}
}

func decodePending(doc *ojson.Doc, prefix string) pendingEnvelope {
	return pendingEnvelope{
		Backend:          doc.Get(prefix + ".backend").String(),
		Version:          int(doc.Get(prefix + ".version").Int()),
		ProviderID:       doc.Get(prefix + ".providerId").String(),
		Metadata:         []byte(doc.Get(prefix + ".metadata").Raw),
		ExpiresAt:        doc.Get(prefix + ".expiresAt").Int(),
		Interval:         int(doc.Get(prefix + ".interval").Int()),
		CallbackRequired: doc.Get(prefix + ".callbackRequired").Bool(),
	}
}

func envelopeValue(value envelope) map[string]any {
	doc := ojson.NewDoc([]byte("{}"))
	_ = doc.Set("backend", value.Backend)
	_ = doc.Set("version", value.Version)
	_ = doc.Set("providerId", value.ProviderID)
	_ = doc.SetRawBytes("metadata", value.Metadata)
	if value.ExpiresAt == nil {
		_ = doc.SetRawBytes("expiresAt", []byte("null"))
	} else {
		_ = doc.Set("expiresAt", *value.ExpiresAt)
	}
	if value.NonExpiring {
		_ = doc.Set("nonExpiring", true)
	}
	if value.DisplayName != "" {
		_ = doc.Set("displayName", value.DisplayName)
	}
	return ojson.ParseBytes(doc.Bytes()).Value().(map[string]any)
}

func pendingValue(value pendingEnvelope) map[string]any {
	doc := ojson.NewDoc([]byte("{}"))
	_ = doc.Set("backend", value.Backend)
	_ = doc.Set("version", value.Version)
	_ = doc.Set("providerId", value.ProviderID)
	_ = doc.SetRawBytes("metadata", value.Metadata)
	_ = doc.Set("expiresAt", value.ExpiresAt)
	_ = doc.Set("interval", value.Interval)
	if value.CallbackRequired {
		_ = doc.Set("callbackRequired", true)
	}
	return ojson.ParseBytes(doc.Bytes()).Value().(map[string]any)
}

func (b *bridge) authorize(w http.ResponseWriter, r *http.Request) {
	doc, ok := decodeBody(w, r)
	if !ok || !onlyFields(doc.Get(""), "providerId") {
		return
	}
	providerID := doc.Get("providerId").String()
	if providerID == "" {
		providerID = providerName
	}
	if providerID != providerName {
		b.authorizeProvider(w, r, providerID)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	device, err := sdkauth.StartCodexDeviceAuthorization(ctx, &config.Config{})
	if err != nil {
		writeError(w, http.StatusBadGateway, "provider_unavailable", "Codex authorization could not be started.")
		return
	}
	interval := int(device.Interval.Seconds())
	if interval < 1 {
		interval = 5
	}
	metadata := ojson.NewDoc([]byte("{}"))
	_ = metadata.Set("deviceAuthId", device.DeviceAuthID)
	_ = metadata.Set("userCode", device.UserCode)
	pending := pendingEnvelope{
		Backend: backendName, Version: 1, ProviderID: providerName,
		Metadata: metadata.Bytes(), ExpiresAt: device.ExpiresAt.UnixMilli(), Interval: interval,
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"authorization": map[string]any{
			"url": sdkauth.CodexDeviceVerificationURL, "userCode": device.UserCode,
			"expiresAt": device.ExpiresAt.UnixMilli(), "interval": interval,
		},
		"pendingState": pendingValue(pending),
	})
}

func (b *bridge) poll(w http.ResponseWriter, r *http.Request) {
	doc, ok := decodeBody(w, r)
	if !ok || !onlyFields(doc.Get(""), "pendingState", "providerId") {
		return
	}
	pending := decodePending(doc, "pendingState")
	requestedProvider := doc.Get("providerId").String()
	if requestedProvider != "" && requestedProvider != pending.ProviderID {
		writeError(w, http.StatusBadRequest, "provider_mismatch", "The authorization provider does not match.")
		return
	}
	if pending.ProviderID != providerName {
		b.pollProvider(w, r, pending)
		return
	}
	if pending.Backend != backendName || pending.Version != 1 || pending.ProviderID != providerName ||
		pending.ExpiresAt <= time.Now().UnixMilli() || pending.Interval < 1 {
		writeError(w, http.StatusGone, "reconnect_required", "Codex authorization expired. Reconnect to continue.")
		return
	}
	metadata := ojson.NewDoc(pending.Metadata)
	deviceAuthID, userCode := metadata.Get("deviceAuthId").String(), metadata.Get("userCode").String()
	if !ojson.ParseBytes(pending.Metadata).IsObject() || deviceAuthID == "" || userCode == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "Codex authorization state is unavailable.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	auth, isPending, err := sdkauth.PollCodexDeviceAuthorization(ctx, &config.Config{}, deviceAuthID, userCode)
	if err != nil {
		writeError(w, http.StatusBadGateway, "provider_unavailable", "Codex authorization could not be completed.")
		return
	}
	if isPending {
		writeJSON(w, http.StatusOK, map[string]any{"status": "pending"})
		return
	}
	storage, ok := auth.Storage.(*codexauth.CodexTokenStorage)
	if !ok || storage == nil || storage.AccessToken == "" || storage.RefreshToken == "" {
		writeError(w, http.StatusBadGateway, "reconnect_required", "Codex authorization could not be completed. Reconnect to continue.")
		return
	}
	credential, err := newCredential(storage)
	if err != nil {
		log.Printf("codex bridge authorization rejected: %s", credentialFailureCode(err))
		writeError(w, http.StatusBadGateway, "reconnect_required", "Codex authorization could not be completed. Reconnect to continue.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "connected", "credential": envelopeValue(credential),
	})
}

func (b *bridge) complete(w http.ResponseWriter, r *http.Request) {
	doc, ok := decodeBody(w, r)
	if !ok || !onlyFields(doc.Get(""), "providerId", "pendingState", "callbackUrl") {
		return
	}
	providerID := doc.Get("providerId").String()
	pending := decodePending(doc, "pendingState")
	if providerID == "" {
		providerID = pending.ProviderID
	}
	if providerID == "" || providerID != pending.ProviderID {
		writeError(w, http.StatusBadRequest, "provider_mismatch", "The authorization provider does not match.")
		return
	}
	if providerID == providerName || !supportedProvider(providerID) {
		writeError(w, http.StatusBadRequest, "invalid_request", "This authorization flow cannot be completed.")
		return
	}
	callbackURL := doc.Get("callbackUrl").String()
	if len(callbackURL) > 8192 {
		writeError(w, http.StatusBadRequest, "invalid_request", "The authorization callback is too large.")
		return
	}
	b.completeProvider(w, r, pending, callbackURL)
}

func (b *bridge) refresh(w http.ResponseWriter, r *http.Request) {
	doc, ok := decodeBody(w, r)
	if !ok || !onlyFields(doc.Get(""), "credential", "providerId") {
		return
	}
	credential := decodeEnvelope(doc, "credential")
	providerID := doc.Get("providerId").String()
	if providerID == "" {
		providerID = credential.ProviderID
	}
	if providerID != credential.ProviderID {
		writeError(w, http.StatusBadRequest, "provider_mismatch", "The credential provider does not match.")
		return
	}
	if providerID != providerName {
		b.refreshProvider(w, r, credential)
		return
	}
	storage, ok := decodeStorage(credential, false)
	if !ok || storage.RefreshToken == "" {
		writeError(w, http.StatusBadRequest, "reconnect_required", "Reconnect this Codex subscription to continue.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	refreshed, err := codexauth.NewCodexAuth(&config.Config{}).RefreshTokens(ctx, storage.RefreshToken)
	if err != nil || refreshed == nil || refreshed.AccessToken == "" || refreshed.RefreshToken == "" {
		status, code, message := safeRefreshError(err)
		writeError(w, status, code, message)
		return
	}
	storage.AccessToken = refreshed.AccessToken
	storage.RefreshToken = refreshed.RefreshToken
	if refreshed.IDToken != "" {
		storage.IDToken = refreshed.IDToken
	}
	if refreshed.AccountID != "" {
		storage.AccountID = refreshed.AccountID
	}
	if refreshed.Email != "" {
		storage.Email = refreshed.Email
	}
	if refreshed.Expire != "" {
		storage.Expire = refreshed.Expire
	}
	if refreshed.PlanType != "" {
		storage.PlanType = refreshed.PlanType
	}
	storage.LastRefresh = time.Now().UTC().Format(time.RFC3339)
	credential, err = newCredential(storage)
	if err != nil {
		writeError(w, http.StatusBadGateway, "reconnect_required", "Codex credentials could not be refreshed. Reconnect to continue.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"credential": envelopeValue(credential)})
}

func safeRefreshError(err error) (int, string, string) {
	var statusErr cliproxyexecutor.StatusError
	if errors.As(err, &statusErr) {
		switch statusErr.StatusCode() {
		case http.StatusTooManyRequests:
			return http.StatusTooManyRequests, "rate_limited", "Codex is temporarily rate limited. Try again later."
		case http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden:
			return http.StatusUnauthorized, "reconnect_required", "Reconnect this Codex subscription to continue."
		default:
			return http.StatusBadGateway, "reconnect_required", "Codex credential rotation could not be confirmed. Reconnect to continue."
		}
	}
	return http.StatusBadGateway, "reconnect_required", "Codex credential rotation could not be confirmed. Reconnect to continue."
}

func (b *bridge) models(w http.ResponseWriter, r *http.Request) {
	doc, ok := decodeBody(w, r)
	if !ok || !onlyFields(doc.Get(""), "credential", "providerId") {
		return
	}
	credential := decodeEnvelope(doc, "credential")
	providerID := doc.Get("providerId").String()
	if providerID == "" {
		providerID = credential.ProviderID
	}
	if providerID != credential.ProviderID {
		writeError(w, http.StatusBadRequest, "provider_mismatch", "The credential provider does not match.")
		return
	}
	if providerID != providerName {
		b.modelsProvider(w, r, credential)
		return
	}
	storage, ok := decodeStorage(credential, false)
	if !ok {
		writeError(w, http.StatusBadRequest, "reconnect_required", "Reconnect this Codex subscription to continue.")
		return
	}
	models, err := catalog(storage.PlanType)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "catalog_unavailable", "Codex model catalog is unavailable for this plan.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"providerId": providerName, "models": models, "source": "provider_catalog"})
}

func (b *bridge) infer(w http.ResponseWriter, r *http.Request) {
	doc, ok := decodeBody(w, r)
	if !ok || !onlyFields(doc.Get(""), "connectionId", "providerId", "credential", "modelId", "request") {
		return
	}
	connectionID, modelID := doc.Get("connectionId").String(), doc.Get("modelId").String()
	credential := decodeEnvelope(doc, "credential")
	providerID := doc.Get("providerId").String()
	if providerID == "" {
		providerID = credential.ProviderID
	}
	if providerID != credential.ProviderID {
		writeError(w, http.StatusBadRequest, "provider_mismatch", "The credential provider does not match.")
		return
	}
	requestPayload := doc.Get("request")
	if connectionID == "" || modelID == "" || !requestPayload.IsObject() {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid subscription request.")
		return
	}
	if providerID != providerName {
		b.inferProvider(w, r, doc, credential, providerID, connectionID, modelID, requestPayload)
		return
	}
	storage, ok := decodeStorage(credential, true)
	if !ok {
		writeError(w, http.StatusUnauthorized, "reconnect_required", "Reconnect this Codex subscription to continue.")
		return
	}
	if _, err := catalogModel(storage.PlanType, modelID); err != nil {
		writeError(w, http.StatusNotFound, "model_unavailable", "This model is not available in the Codex catalog.")
		return
	}
	payload := ojson.NewDoc([]byte(requestPayload.Raw))
	if payload.Get("model").String() != modelID || !payload.Get("stream").Bool() ||
		!payload.Get("store").Exists() || payload.Get("store").Bool() || hasStatefulOption(payload) {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid stateless Responses request.")
		return
	}
	auth := &cliproxyauth.Auth{
		ID:       connectionID,
		Provider: providerName,
		Storage:  storage,
		Metadata: map[string]any{
			"access_token": storage.AccessToken,
			"account_id":   storage.AccountID,
			"plan_type":    storage.PlanType,
		},
		Attributes: map[string]string{"plan_type": storage.PlanType},
	}
	cfg := &config.Config{CommercialMode: true}
	execute := b.executeStream
	if execute == nil {
		execute = runtimeexecutor.NewCodexExecutor(cfg).ExecuteStream
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	result, err := execute(ctx, auth, cliproxyexecutor.Request{
		Model: modelID, Payload: []byte(requestPayload.Raw), Format: sdktranslator.FormatOpenAIResponse,
	}, cliproxyexecutor.Options{
		Stream: true, SourceFormat: sdktranslator.FormatOpenAIResponse,
		ResponseFormat: sdktranslator.FormatOpenAIResponse, OriginalRequest: []byte(requestPayload.Raw),
	})
	if err != nil {
		status, code, message := safeProviderError(err)
		writeError(w, status, code, message)
		return
	}
	if result == nil || result.Chunks == nil {
		writeError(w, http.StatusBadGateway, "provider_unavailable", "Codex did not return a response.")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("X-Overlay-Provider-Id", providerName)
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	for {
		select {
		case <-r.Context().Done():
			return
		case chunk, open := <-result.Chunks:
			if !open {
				return
			}
			if chunk.Err != nil {
				_, code, message := safeProviderError(chunk.Err)
				if _, writeErr := fmt.Fprintf(w, "data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":%q,\"message\":%q},\"incomplete_details\":{\"reason\":\"error\"}}}\n\n", code, message); writeErr != nil {
					cancel()
					return
				}
				if flusher != nil {
					flusher.Flush()
				}
				return
			}
			if len(chunk.Payload) == 0 {
				continue
			}
			frame := normalizeSSEFrame(chunk.Payload)
			written, writeErr := w.Write(frame)
			if writeErr != nil || written != len(frame) {
				cancel()
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
	}
}

func normalizeSSEFrame(payload []byte) []byte {
	event := bytes.TrimSpace(payload)
	// The translator emits both SSE field lines and bare JSON payloads.
	// Preserve field lines: prefixing an event label with data makes it invalid JSON.
	isSSEField := false
	for _, prefix := range []string{"data:", "event:", "id:", "retry:", ":"} {
		if bytes.HasPrefix(event, []byte(prefix)) {
			isSSEField = true
			break
		}
	}
	if !isSSEField {
		event = append([]byte("data: "), event...)
	}
	frame := make([]byte, 0, len(event)+2)
	frame = append(frame, event...)
	frame = append(frame, '\n', '\n')
	return frame
}

func hasStatefulOption(payload *ojson.Doc) bool {
	for _, key := range []string{"previous_response_id", "conversation", "conversation_id"} {
		if payload.Get(key).Exists() {
			return true
		}
	}
	return false
}

func reasoningLevels(model *registry.ModelInfo) []string {
	if model == nil || model.Thinking == nil {
		return nil
	}
	allowed := map[string]bool{
		"none": true, "minimal": true, "low": true,
		"medium": true, "high": true, "xhigh": true,
	}
	seen := make(map[string]bool)
	levels := make([]string, 0, len(model.Thinking.Levels))
	for _, level := range model.Thinking.Levels {
		level = strings.ToLower(strings.TrimSpace(level))
		if allowed[level] && !seen[level] {
			levels = append(levels, level)
			seen[level] = true
		}
	}
	return levels
}

func catalog(plan string) ([]map[string]any, error) {
	normalized := strings.ToLower(strings.TrimSpace(plan))
	var source []*registry.ModelInfo
	switch normalized {
	case "pro":
		source = registry.GetCodexProModels()
	case "prolite", "promax":
		// These plan names are explicit in the pinned Codex client registry.
		// Intersect with its per-model list instead of assuming Pro entitlement.
		source = codexClientPlanModels(normalized)
	case "plus":
		source = registry.GetCodexPlusModels()
	case "team", "business", "go":
		source = registry.GetCodexTeamModels()
	case "free":
		source = registry.GetCodexFreeModels()
	default:
		return nil, errors.New("unknown Codex plan")
	}
	models := make([]map[string]any, 0, len(source))
	for _, model := range source {
		if model == nil || strings.TrimSpace(model.ID) == "" {
			continue
		}
		name := strings.TrimSpace(model.DisplayName)
		if name == "" {
			name = model.ID
		}
		entry := map[string]any{"id": model.ID, "name": name}
		if levels := reasoningLevels(model); len(levels) > 0 {
			entry["reasoningLevels"] = levels
		}
		models = append(models, entry)
	}
	return models, nil
}

func codexClientPlanModels(plan string) []*registry.ModelInfo {
	allowed := make(map[string]bool)
	ojson.ParseBytes(registry.GetCodexClientModelsJSON()).Get("models").ForEach(func(_, model ojson.Result) bool {
		model.Get("available_in_plans").ForEach(func(_, value ojson.Result) bool {
			if value.String() == plan {
				allowed[model.Get("slug").String()] = true
			}
			return true
		})
		return true
	})
	var models []*registry.ModelInfo
	for _, model := range registry.GetCodexProModels() {
		if model != nil && allowed[model.ID] {
			models = append(models, model)
		}
	}
	return models
}

func catalogModel(plan, modelID string) (map[string]any, error) {
	models, err := catalog(plan)
	if err != nil {
		return nil, err
	}
	for _, model := range models {
		if model["id"] == modelID {
			return model, nil
		}
	}
	return nil, errors.New("unknown Codex model")
}

func decodeStorage(value envelope, requireUnexpired bool) (*codexauth.CodexTokenStorage, bool) {
	if value.Backend != backendName || value.Version != 1 || value.ProviderID != providerName ||
		len(value.Metadata) == 0 || !ojson.ParseBytes(value.Metadata).IsObject() {
		return nil, false
	}
	metadata := ojson.NewDoc(value.Metadata)
	tokenStorage := metadata.Get("tokenStorage")
	if !tokenStorage.IsObject() {
		return nil, false
	}
	token := ojson.NewDoc([]byte(tokenStorage.Raw))
	storage := &codexauth.CodexTokenStorage{
		IDToken:      token.Get("id_token").String(),
		AccessToken:  token.Get("access_token").String(),
		RefreshToken: token.Get("refresh_token").String(),
		AccountID:    token.Get("account_id").String(),
		LastRefresh:  token.Get("last_refresh").String(),
		Email:        token.Get("email").String(),
		Type:         token.Get("type").String(),
		Expire:       token.Get("expired").String(),
		PlanType:     token.Get("plan_type").String(),
	}
	if storage.AccessToken == "" || storage.RefreshToken == "" ||
		token.Get("siwc").Exists() || token.Get("use_siwc").Exists() {
		return nil, false
	}
	expiry, err := time.Parse(time.RFC3339, storage.Expire)
	if err != nil || (requireUnexpired && (value.ExpiresAt == nil || *value.ExpiresAt <= time.Now().UnixMilli() ||
		expiry.UnixMilli() <= time.Now().UnixMilli())) {
		return nil, false
	}
	return storage, true
}

// Credential failures are static codes only; never log provider payloads or tokens.
func credentialFailureCode(err error) string {
	switch err.Error() {
	case "invalid Codex token storage":
		return "invalid_token_storage"
	case "invalid Codex token expiry":
		return "invalid_token_expiry"
	default:
		return "credential_encoding_failed"
	}
}

func newCredential(storage *codexauth.CodexTokenStorage) (envelope, error) {
	if storage == nil || storage.AccessToken == "" || storage.RefreshToken == "" {
		return envelope{}, errors.New("invalid Codex token storage")
	}
	expiresAt, err := time.Parse(time.RFC3339, storage.Expire)
	if err != nil {
		return envelope{}, errors.New("invalid Codex token expiry")
	}
	tokenDoc := ojson.NewDoc([]byte("{}"))
	fields := map[string]string{
		"id_token": storage.IDToken, "access_token": storage.AccessToken,
		"refresh_token": storage.RefreshToken, "account_id": storage.AccountID,
		"last_refresh": storage.LastRefresh, "email": storage.Email,
		"type": storage.Type, "expired": storage.Expire, "plan_type": storage.PlanType,
	}
	for key, value := range fields {
		if err := tokenDoc.Set(key, value); err != nil {
			return envelope{}, err
		}
	}
	metadata := ojson.NewDoc([]byte("{}"))
	if err := metadata.SetRawBytes("tokenStorage", tokenDoc.Bytes()); err != nil {
		return envelope{}, err
	}
	return envelope{
		Backend: backendName, Version: 1, ProviderID: providerName,
		Metadata: metadata.Bytes(), ExpiresAt: int64Pointer(expiresAt.UnixMilli()), DisplayName: "Codex account",
	}, nil
}

func int64Pointer(value int64) *int64 {
	return &value
}

func safeProviderError(err error) (int, string, string) {
	var statusErr cliproxyexecutor.StatusError
	if errors.As(err, &statusErr) {
		switch statusErr.StatusCode() {
		case http.StatusUnauthorized, http.StatusForbidden:
			return http.StatusUnauthorized, "reconnect_required", "Reconnect this Codex subscription to continue."
		case http.StatusTooManyRequests:
			return http.StatusTooManyRequests, "rate_limited", "Codex is temporarily rate limited. Try again later."
		case http.StatusBadRequest, http.StatusNotFound:
			return http.StatusBadRequest, "model_unavailable", "Codex could not process this request for the selected model."
		}
	}
	return http.StatusBadGateway, "provider_unavailable", "Codex is temporarily unavailable. Try again later."
}

func writeJSON(w http.ResponseWriter, status int, value map[string]any) {
	doc := ojson.NewDoc([]byte("{}"))
	for key, field := range value {
		if err := doc.Set(key, field); err != nil {
			writeError(w, http.StatusInternalServerError, "provider_unavailable", "Codex is temporarily unavailable. Try again later.")
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(append(doc.Bytes(), '\n'))
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]any{"code": code, "message": message}})
}
