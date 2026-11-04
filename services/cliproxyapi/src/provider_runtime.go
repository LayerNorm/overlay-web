package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/MoeForge/moego/ojson"
	claudeauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/claude"
	kimiauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/kimi"
	metaauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/meta"
	xaiauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/xai"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/runtime/executor"
	_ "github.com/router-for-me/CLIProxyAPI/v8/internal/translator/claude/openai/responses"
	_ "github.com/router-for-me/CLIProxyAPI/v8/internal/translator/openai/interactions/responses"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
	sdktranslator "github.com/router-for-me/CLIProxyAPI/v8/sdk/translator"
)

func (b *bridge) modelsProvider(w http.ResponseWriter, _ *http.Request, credential envelope) {
	if !supportedProvider(credential.ProviderID) || credential.ProviderID == "codex" {
		writeError(w, http.StatusBadRequest, "invalid_request", "The credential provider is unavailable.")
		return
	}
	if _, ok := providerTokenStorage(credential); !ok {
		writeProviderError(w, credential.ProviderID, http.StatusUnauthorized, "reconnect_required")
		return
	}
	models, err := providerCatalog(credential.ProviderID, "")
	if err != nil {
		writeProviderError(w, credential.ProviderID, http.StatusUnprocessableEntity, "provider_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"providerId": credential.ProviderID, "models": models, "source": "provider_catalog"})
}

func providerTokenStorage(credential envelope) (ojson.Result, bool) {
	return readTokenStorage(credential, credential.ProviderID)
}

func (b *bridge) refreshProvider(w http.ResponseWriter, r *http.Request, credential envelope) {
	providerID := credential.ProviderID
	if !supportedProvider(providerID) || providerID == "codex" {
		writeError(w, http.StatusBadRequest, "invalid_request", "The credential provider is unavailable.")
		return
	}
	if !credential.NonExpiring && credential.ExpiresAt == nil {
		writeProviderError(w, providerID, http.StatusUnauthorized, "reconnect_required")
		return
	}
	if providerID == "devin" {
		if _, ok := decodeDevinCredential(credential); !ok {
			writeProviderError(w, providerID, http.StatusUnauthorized, "reconnect_required")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"credential": envelopeValue(credential)})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	cfg := &config.Config{CommercialMode: true}
	switch providerID {
	case "claude":
		storage, ok := decodeClaudeCredential(credential)
		if !ok {
			writeProviderError(w, providerID, http.StatusUnauthorized, "reconnect_required")
			return
		}
		tokens, err := claudeauth.NewClaudeAuth(cfg).RefreshTokens(ctx, storage.RefreshToken)
		if err != nil || tokens == nil || tokens.AccessToken == "" {
			status, code, _ := safeProviderRefreshError(providerID, err)
			writeProviderError(w, providerID, status, code)
			return
		}
		if tokens.RefreshToken == "" {
			tokens.RefreshToken = storage.RefreshToken
		}
		if tokens.Email == "" {
			tokens.Email = storage.Email
		}
		if tokens.AccountUUID == "" {
			tokens.AccountUUID = storage.AccountUUID
		}
		if tokens.OrganizationUUID == "" {
			tokens.OrganizationUUID = storage.OrganizationUUID
		}
		if tokens.OrganizationName == "" {
			tokens.OrganizationName = storage.OrganizationName
		}
		updated := claudeauth.NewClaudeAuth(cfg).CreateTokenStorage(&claudeauth.ClaudeAuthBundle{
			TokenData: *tokens, DeviceIDs: append([]string(nil), storage.DeviceIDs...),
			LastRefresh: time.Now().UTC().Format(time.RFC3339),
		})
		updated.IDToken = storage.IDToken
		updated.Type = "claude"
		refreshed, err := newClaudeCredential(updated, updated.Email)
		if err != nil {
			writeProviderError(w, providerID, http.StatusBadGateway, "reconnect_required")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"credential": envelopeValue(refreshed)})
		return
	case "xai":
		storage, ok := decodeXaiCredential(credential)
		if !ok || storage.RefreshToken == "" {
			writeProviderError(w, providerID, http.StatusUnauthorized, "reconnect_required")
			return
		}
		auth := buildProviderAuth(credential, "subscription")
		refreshedAuth, err := executor.NewXAIExecutor(cfg).Refresh(ctx, auth)
		if err != nil {
			status, code, _ := safeProviderRefreshError(providerID, err)
			writeProviderError(w, providerID, status, code)
			return
		}
		updated := xaiStorageFromAuth(refreshedAuth, storage)
		refreshed, err := newXaiCredential(updated)
		if err != nil {
			writeProviderError(w, providerID, http.StatusBadGateway, "reconnect_required")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"credential": envelopeValue(refreshed)})
		return
	case "kimi", "kimi-ai":
		storage, ok := decodeKimiCredential(credential)
		if !ok {
			writeProviderError(w, providerID, http.StatusUnauthorized, "reconnect_required")
			return
		}
		refreshedAuth, err := executor.NewKimiExecutor(cfg).Refresh(ctx, buildProviderAuth(credential, "subscription"))
		if err != nil {
			status, code, _ := safeProviderRefreshError(providerID, err)
			writeProviderError(w, providerID, status, code)
			return
		}
		updated := kimiStorageFromAuth(refreshedAuth, storage, providerID)
		refreshed, err := newKimiCredential(providerID, updated)
		if err != nil {
			writeProviderError(w, providerID, http.StatusBadGateway, "reconnect_required")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"credential": envelopeValue(refreshed)})
		return
	case "meta":
		storage, ok := decodeMetaCredential(credential)
		if !ok || storage.APIKey == "" {
			writeProviderError(w, providerID, http.StatusUnauthorized, "reconnect_required")
			return
		}
		refreshedAuth, err := executor.NewMetaExecutor(cfg).Refresh(ctx, buildProviderAuth(credential, "subscription"))
		if err != nil {
			status, code, _ := safeProviderRefreshError(providerID, err)
			writeProviderError(w, providerID, status, code)
			return
		}
		updated := metaStorageFromAuth(refreshedAuth, storage)
		refreshed, err := newMetaCredential(updated, updated.Email)
		if err != nil {
			writeProviderError(w, providerID, http.StatusBadGateway, "reconnect_required")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"credential": envelopeValue(refreshed)})
		return
	}
	writeProviderError(w, providerID, http.StatusBadRequest, "provider_unavailable")
}

func safeProviderRefreshError(providerID string, err error) (int, string, string) {
	if err == nil {
		return http.StatusBadGateway, "provider_unavailable", ""
	}
	var statusErr cliproxyexecutor.StatusError
	if errors.As(err, &statusErr) {
		switch statusErr.StatusCode() {
		case http.StatusTooManyRequests:
			return http.StatusTooManyRequests, "rate_limited", ""
		case http.StatusUnauthorized, http.StatusForbidden:
			return http.StatusUnauthorized, "reconnect_required", ""
		}
	}
	return http.StatusBadGateway, "provider_unavailable", ""
}

func buildProviderAuth(credential envelope, connectionID string) *cliproxyauth.Auth {
	switch credential.ProviderID {
	case "claude":
		storage, ok := decodeClaudeCredential(credential)
		if !ok {
			return nil
		}
		return &cliproxyauth.Auth{
			ID: connectionID, Provider: "claude", Storage: storage,
			Metadata: map[string]any{
				"type": "claude", "access_token": storage.AccessToken, "refresh_token": storage.RefreshToken,
				"id_token": storage.IDToken, "account_uuid": storage.AccountUUID,
				"organization_uuid": storage.OrganizationUUID, "organization_name": storage.OrganizationName,
				"claude_device_ids": storage.DeviceIDs, "expired": storage.Expire,
			},
		}
	case "xai":
		storage, ok := decodeXaiCredential(credential)
		if !ok {
			return nil
		}
		return &cliproxyauth.Auth{
			ID: connectionID, Provider: "xai", Storage: storage,
			Metadata: map[string]any{
				"type": "xai", "auth_kind": "oauth", "access_token": storage.AccessToken,
				"refresh_token": storage.RefreshToken, "id_token": storage.IDToken,
				"expired": storage.Expire, "base_url": storage.BaseURL,
				"token_endpoint": storage.TokenEndpoint,
			},
			Attributes: map[string]string{"type": "xai", "auth_kind": "oauth"},
		}
	case "kimi", "kimi-ai":
		storage, ok := decodeKimiCredential(credential)
		if !ok {
			return nil
		}
		return &cliproxyauth.Auth{
			ID: connectionID, Provider: credential.ProviderID, Storage: storage,
			Metadata: map[string]any{
				"type": credential.ProviderID, "domain": storage.Domain, "device_id": storage.DeviceID,
				"access_token": storage.AccessToken, "refresh_token": storage.RefreshToken,
				"expired": storage.Expired, "base_url": storage.BaseURL,
			},
			Attributes: map[string]string{
				"type": credential.ProviderID, "domain": storage.Domain, "device_id": storage.DeviceID,
				"base_url": storage.BaseURL,
			},
		}
	case "meta":
		storage, ok := decodeMetaCredential(credential)
		if !ok || storage.APIKey == "" {
			return nil
		}
		return &cliproxyauth.Auth{
			ID: connectionID, Provider: "meta", Storage: storage,
			Metadata: map[string]any{
				"type": "meta", "auth_kind": "oauth", "access_token": storage.APIKey,
				"api_key": storage.APIKey, "dca_token": storage.DCAToken,
				"base_url": storage.BaseURL, "email": storage.Email, "name": storage.Name,
			},
			Attributes: map[string]string{
				"type": "meta", "auth_kind": "oauth", "access_token": storage.APIKey,
				"api_key": storage.APIKey, "dca_token": storage.DCAToken, "base_url": storage.BaseURL,
			},
		}
	case "devin":
		auth, _ := decodeDevinCredential(credential)
		if auth != nil {
			auth.ID = connectionID
		}
		return auth
	default:
		return nil
	}
}

func xaiStorageFromAuth(auth *cliproxyauth.Auth, previous *xaiauth.TokenStorage) *xaiauth.TokenStorage {
	if auth == nil || auth.Metadata == nil {
		return nil
	}
	get := func(key string) string {
		value, _ := auth.Metadata[key].(string)
		return value
	}
	result := &xaiauth.TokenStorage{
		AccessToken: get("access_token"), RefreshToken: get("refresh_token"),
		IDToken: get("id_token"), TokenType: get("token_type"), Expire: get("expired"),
		Email: get("email"), Subject: get("sub"), LastRefresh: get("last_refresh"),
		BaseURL: get("base_url"), TokenEndpoint: get("token_endpoint"),
	}
	if previous != nil {
		if result.Email == "" {
			result.Email = previous.Email
		}
		if result.TokenEndpoint == "" {
			result.TokenEndpoint = previous.TokenEndpoint
		}
	}
	if result.LastRefresh == "" {
		result.LastRefresh = time.Now().UTC().Format(time.RFC3339)
	}
	return result
}

func kimiStorageFromAuth(auth *cliproxyauth.Auth, previous *kimiauth.KimiTokenStorage, providerID string) *kimiauth.KimiTokenStorage {
	if auth == nil {
		return nil
	}
	result := previous
	if result == nil {
		result = &kimiauth.KimiTokenStorage{}
	}
	if auth.Metadata != nil {
		if value, ok := auth.Metadata["access_token"].(string); ok && value != "" {
			result.AccessToken = value
		}
		if value, ok := auth.Metadata["refresh_token"].(string); ok && value != "" {
			result.RefreshToken = value
		}
		if value, ok := auth.Metadata["expired"].(string); ok {
			result.Expired = value
		}
	}
	result.Type = providerID
	result.Domain = kimiDomain(providerID)
	result.BaseURL = kimiauth.ResolveKimiAPIBaseURL(result.Domain)
	if result.AccessToken == "" || result.RefreshToken == "" {
		return nil
	}
	return result
}

func metaStorageFromAuth(auth *cliproxyauth.Auth, previous *metaauth.MetaTokenStorage) *metaauth.MetaTokenStorage {
	if auth == nil || auth.Metadata == nil {
		return nil
	}
	result := previous
	if result == nil {
		result = &metaauth.MetaTokenStorage{}
	}
	get := func(key string) string {
		value, _ := auth.Metadata[key].(string)
		return value
	}
	if value := get("api_key"); value != "" {
		result.APIKey = value
		result.AccessToken = value
	}
	if value := get("dca_token"); value != "" {
		result.DCAToken = value
	}
	if value := get("base_url"); value != "" {
		result.BaseURL = value
	}
	if value := get("email"); value != "" {
		result.Email = value
	}
	if value := get("name"); value != "" {
		result.Name = value
	}
	result.Type, result.AuthKind = "meta", "oauth"
	result.LastRefresh = time.Now().UTC().Format(time.RFC3339)
	if result.APIKey == "" {
		return nil
	}
	return result
}

func (b *bridge) inferProvider(w http.ResponseWriter, r *http.Request, doc *ojson.Doc, credential envelope, providerID, connectionID, modelID string, requestPayload ojson.Result) {
	if !supportedProvider(providerID) || providerID == "codex" {
		writeError(w, http.StatusBadRequest, "invalid_request", "The subscription provider is unavailable.")
		return
	}
	if !providerCredentialCurrent(credential) {
		writeProviderError(w, providerID, http.StatusUnauthorized, "reconnect_required")
		return
	}
	auth := buildProviderAuth(credential, connectionID)
	if auth == nil || auth.ID != connectionID || auth.Provider != providerID {
		writeProviderError(w, providerID, http.StatusUnauthorized, "reconnect_required")
		return
	}
	if _, err := providerCatalogModel(providerID, "", modelID); err != nil {
		writeProviderError(w, providerID, http.StatusNotFound, "model_unavailable")
		return
	}
	payload := ojson.NewDoc([]byte(requestPayload.Raw))
	if payload.Get("model").String() != modelID || !payload.Get("stream").Bool() ||
		!payload.Get("store").Exists() || payload.Get("store").Bool() || hasStatefulOption(payload) ||
		!supportsStatelessResponses(payload) {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid stateless Responses request.")
		return
	}
	cfg := &config.Config{CommercialMode: true}
	execute := b.executeStream
	if execute == nil {
		switch providerID {
		case "claude":
			execute = executor.NewClaudeExecutor(cfg).ExecuteStream
		case "xai":
			execute = executor.NewXAIExecutor(cfg).ExecuteStream
		case "meta":
			execute = executor.NewMetaExecutor(cfg).ExecuteStream
		case "kimi", "kimi-ai":
			execute = executor.NewKimiExecutor(cfg).ExecuteStream
		case "devin":
			execute = executor.NewDevinExecutor(cfg).ExecuteStream
		}
	}
	if execute == nil {
		writeProviderError(w, providerID, http.StatusBadGateway, "provider_unavailable")
		return
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
		status, code, message := safeProviderExecutionError(providerID, err)
		writeError(w, status, code, message)
		return
	}
	if result == nil || result.Chunks == nil {
		writeProviderError(w, providerID, http.StatusBadGateway, "provider_unavailable")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("X-Overlay-Provider-Id", providerID)
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
				_, code, message := safeProviderExecutionError(providerID, chunk.Err)
				if _, writeErr := fmt.Fprintf(w, "data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":%q,\"message\":%q},\"incomplete_details\":{\"reason\":\"error\"}}}\n\n", code, message); writeErr != nil {
					cancel()
					return
				}
			} else if len(chunk.Payload) > 0 {
				frame := normalizeSSEFrame(chunk.Payload)
				written, writeErr := w.Write(frame)
				if writeErr != nil || written != len(frame) {
					cancel()
					return
				}
			}
			if flusher != nil {
				flusher.Flush()
			}
			if chunk.Err != nil {
				return
			}
		}
	}
}

func providerCredentialCurrent(credential envelope) bool {
	if credential.NonExpiring {
		return credential.ProviderID == "meta" || credential.ProviderID == "devin"
	}
	if credential.ExpiresAt == nil || *credential.ExpiresAt <= time.Now().UnixMilli() {
		return false
	}
	return true
}

func supportsStatelessResponses(payload *ojson.Doc) bool {
	tools := payload.Get("tools")
	if tools.Exists() {
		if !tools.IsArray() {
			return false
		}
		for _, tool := range tools.Array() {
			if !tool.IsObject() || tool.Get("type").String() != "function" {
				return false
			}
		}
	}
	input := payload.Get("input")
	if input.IsArray() {
		for _, item := range input.Array() {
			if !item.IsObject() {
				continue
			}
			kind := strings.ToLower(item.Get("type").String())
			for _, unsupported := range []string{"image", "audio", "video", "file", "computer", "browser", "web_search", "code_interpreter"} {
				if strings.Contains(kind, unsupported) {
					return false
				}
			}
			content := item.Get("content")
			if content.IsArray() {
				for _, part := range content.Array() {
					partType := strings.ToLower(part.Get("type").String())
					if partType != "" && partType != "input_text" && partType != "output_text" && partType != "text" {
						return false
					}
				}
			}
		}
	}
	return true
}

func safeProviderExecutionError(providerID string, err error) (int, string, string) {
	label := providerLabel(providerID)
	var statusErr cliproxyexecutor.StatusError
	if errors.As(err, &statusErr) {
		switch statusErr.StatusCode() {
		case http.StatusUnauthorized, http.StatusForbidden:
			return http.StatusUnauthorized, "reconnect_required", "Reconnect this " + label + " subscription to continue."
		case http.StatusTooManyRequests:
			return http.StatusTooManyRequests, "rate_limited", label + " is temporarily rate limited. Try again later."
		case http.StatusNotFound:
			return http.StatusNotFound, "model_unavailable", "This model is not available in the " + label + " catalog."
		}
	}
	return http.StatusBadGateway, "provider_unavailable", label + " is temporarily unavailable. Try again later."
}
