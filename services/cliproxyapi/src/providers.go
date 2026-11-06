package main

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/MoeForge/moego/ojson"
	"github.com/google/uuid"
	claudeauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/claude"
	devinauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/devin"
	kimiauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/kimi"
	metaauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/meta"
	xaiauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/xai"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/misc"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/registry"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
)

const (
	claudeCallbackLifetime = 10 * time.Minute
	devinCallbackLifetime  = 10 * time.Minute
)

func supportedProvider(providerID string) bool {
	switch providerID {
	case "codex", "claude", "xai", "meta", "kimi", "devin":
		return true
	default:
		return false
	}
}

func providerLabel(providerID string) string {
	switch providerID {
	case "codex":
		return "Codex"
	case "claude":
		return "Claude"
	case "xai":
		return "xAI"
	case "meta":
		return "Meta"
	case "kimi":
		return "Kimi"
	case "devin":
		return "Devin"
	default:
		return "subscription provider"
	}
}

func providerCatalog(providerID, codexPlan string) ([]map[string]any, error) {
	if providerID == "codex" {
		return catalog(codexPlan)
	}
	var source []*registry.ModelInfo
	switch providerID {
	case "claude":
		source = registry.GetClaudeModels()
	case "xai":
		source = registry.GetXAIModels()
	case "meta":
		source = registry.GetMetaModels()
	case "kimi":
		source = registry.GetKimiModels()
	case "devin":
		source = registry.GetDevinModels()
	default:
		return nil, errors.New("unsupported subscription provider")
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
	if len(models) == 0 {
		return nil, errors.New("empty subscription provider catalog")
	}
	return models, nil
}

func providerCatalogModel(providerID, codexPlan, modelID string) (map[string]any, error) {
	models, err := providerCatalog(providerID, codexPlan)
	if err != nil {
		return nil, err
	}
	for _, model := range models {
		if model["id"] == modelID {
			return model, nil
		}
	}
	return nil, errors.New("model is not in the provider catalog")
}

func providerPending(providerID string, expiresAt time.Time, interval time.Duration, metadata []byte, callbackRequired bool) pendingEnvelope {
	seconds := int(interval.Seconds())
	if seconds < 1 {
		seconds = 5
	}
	return pendingEnvelope{
		Backend: backendName, Version: 1, ProviderID: providerID,
		Metadata: metadata, ExpiresAt: expiresAt.UnixMilli(), Interval: seconds,
		CallbackRequired: callbackRequired,
	}
}

func encodeObject(fields map[string]any) ([]byte, error) {
	doc := ojson.NewDoc([]byte("{}"))
	for key, value := range fields {
		if err := doc.Set(key, value); err != nil {
			return nil, err
		}
	}
	return doc.Bytes(), nil
}

func providerCredential(providerID string, tokenStorage []byte, expiresAt time.Time, nonExpiring bool, displayName string) (envelope, error) {
	if !supportedProvider(providerID) || providerID == "codex" || len(tokenStorage) == 0 ||
		!ojson.ParseBytes(tokenStorage).IsObject() || (!nonExpiring && expiresAt.IsZero()) {
		return envelope{}, errors.New("invalid provider credential")
	}
	metadata := ojson.NewDoc([]byte("{}"))
	if err := metadata.SetRawBytes("tokenStorage", tokenStorage); err != nil {
		return envelope{}, err
	}
	credential := envelope{
		Backend: backendName, Version: 1, ProviderID: providerID,
		Metadata: metadata.Bytes(), NonExpiring: nonExpiring,
		DisplayName: displayName,
	}
	if !nonExpiring {
		value := expiresAt.UnixMilli()
		credential.ExpiresAt = &value
	}
	return credential, nil
}

func readTokenStorage(value envelope, expectedProvider string) (ojson.Result, bool) {
	if value.Backend != backendName || value.Version != 1 || value.ProviderID != expectedProvider ||
		len(value.Metadata) == 0 || !ojson.ParseBytes(value.Metadata).IsObject() {
		return ojson.Result{}, false
	}
	tokenStorage := ojson.ParseBytes(value.Metadata).Get("tokenStorage")
	if !tokenStorage.IsObject() {
		return ojson.Result{}, false
	}
	if value.NonExpiring {
		if expectedProvider != "meta" && expectedProvider != "devin" {
			return ojson.Result{}, false
		}
	} else if value.ExpiresAt == nil {
		return ojson.Result{}, false
	}
	return tokenStorage, true
}

func tokenStorageBytes(value ojson.Result) []byte {
	if !value.IsObject() {
		return nil
	}
	return []byte(value.Raw)
}

func stringsFromArray(value ojson.Result) []string {
	if !value.IsArray() {
		return nil
	}
	items := value.Array()
	result := make([]string, 0, len(items))
	for _, item := range items {
		if item.String() != "" {
			result = append(result, item.String())
		}
	}
	return result
}

func newClaudeCredential(storage *claudeauth.ClaudeTokenStorage, displayName string) (envelope, error) {
	if storage == nil || storage.AccessToken == "" || storage.RefreshToken == "" {
		return envelope{}, errors.New("invalid Claude token storage")
	}
	expiry, err := time.Parse(time.RFC3339, storage.Expire)
	if err != nil {
		return envelope{}, errors.New("invalid Claude token expiry")
	}
	fields := map[string]any{
		"id_token": storage.IDToken, "access_token": storage.AccessToken,
		"refresh_token": storage.RefreshToken, "last_refresh": storage.LastRefresh,
		"email": storage.Email, "account_uuid": storage.AccountUUID,
		"organization_uuid": storage.OrganizationUUID, "organization_name": storage.OrganizationName,
		"claude_device_ids": storage.DeviceIDs, "type": "claude", "expired": storage.Expire,
	}
	raw, err := encodeObject(fields)
	if err != nil {
		return envelope{}, err
	}
	return providerCredential("claude", raw, expiry, false, displayName)
}

func decodeClaudeCredential(value envelope) (*claudeauth.ClaudeTokenStorage, bool) {
	token, ok := readTokenStorage(value, "claude")
	if !ok || token.Get("type").String() != "claude" {
		return nil, false
	}
	storage := &claudeauth.ClaudeTokenStorage{
		IDToken: token.Get("id_token").String(), AccessToken: token.Get("access_token").String(),
		RefreshToken: token.Get("refresh_token").String(), LastRefresh: token.Get("last_refresh").String(),
		Email: token.Get("email").String(), AccountUUID: token.Get("account_uuid").String(),
		OrganizationUUID: token.Get("organization_uuid").String(), OrganizationName: token.Get("organization_name").String(),
		DeviceIDs: stringsFromArray(token.Get("claude_device_ids")), Type: "claude", Expire: token.Get("expired").String(),
	}
	if storage.AccessToken == "" || storage.RefreshToken == "" {
		return nil, false
	}
	return storage, true
}

func newXaiCredential(storage *xaiauth.TokenStorage) (envelope, error) {
	if storage == nil || storage.AccessToken == "" || storage.RefreshToken == "" {
		return envelope{}, errors.New("invalid xAI token storage")
	}
	expiry, err := time.Parse(time.RFC3339, storage.Expire)
	if err != nil {
		return envelope{}, errors.New("invalid xAI token expiry")
	}
	raw, err := encodeObject(map[string]any{
		"access_token": storage.AccessToken, "refresh_token": storage.RefreshToken,
		"id_token": storage.IDToken, "token_type": storage.TokenType, "expires_in": storage.ExpiresIn,
		"expired": storage.Expire, "email": storage.Email, "sub": storage.Subject,
		"type": "xai", "auth_kind": "oauth", "last_refresh": storage.LastRefresh,
		"base_url": storage.BaseURL, "redirect_uri": storage.RedirectURI,
		"token_endpoint": storage.TokenEndpoint,
	})
	if err != nil {
		return envelope{}, err
	}
	return providerCredential("xai", raw, expiry, false, storage.Email)
}

func decodeXaiCredential(value envelope) (*xaiauth.TokenStorage, bool) {
	token, ok := readTokenStorage(value, "xai")
	if !ok || token.Get("type").String() != "xai" || token.Get("auth_kind").String() != "oauth" {
		return nil, false
	}
	storage := &xaiauth.TokenStorage{
		AccessToken: token.Get("access_token").String(), RefreshToken: token.Get("refresh_token").String(),
		IDToken: token.Get("id_token").String(), TokenType: token.Get("token_type").String(),
		ExpiresIn: int(token.Get("expires_in").Int()), Expire: token.Get("expired").String(),
		Email: token.Get("email").String(), Subject: token.Get("sub").String(),
		LastRefresh: token.Get("last_refresh").String(), BaseURL: token.Get("base_url").String(),
		RedirectURI: token.Get("redirect_uri").String(), TokenEndpoint: token.Get("token_endpoint").String(),
	}
	return storage, storage.AccessToken != "" && storage.RefreshToken != ""
}

func newKimiCredential(storage *kimiauth.KimiTokenStorage) (envelope, error) {
	if storage == nil || storage.AccessToken == "" || storage.RefreshToken == "" ||
		storage.Expired == "" ||
		storage.Domain != kimiauth.KimiDefaultDomain {
		return envelope{}, errors.New("invalid Kimi token storage")
	}
	expiry, err := time.Parse(time.RFC3339, storage.Expired)
	if err != nil {
		return envelope{}, errors.New("invalid Kimi token expiry")
	}
	raw, err := encodeObject(map[string]any{
		"access_token": storage.AccessToken, "refresh_token": storage.RefreshToken,
		"token_type": storage.TokenType, "scope": storage.Scope, "device_id": storage.DeviceID,
		"expired": storage.Expired, "type": "kimi", "domain": storage.Domain,
		"base_url": storage.BaseURL,
	})
	if err != nil {
		return envelope{}, err
	}
	return providerCredential("kimi", raw, expiry, false, storage.DeviceID)
}

func decodeKimiCredential(value envelope) (*kimiauth.KimiTokenStorage, bool) {
	token, ok := readTokenStorage(value, value.ProviderID)
	if !ok || value.ProviderID != "kimi" ||
		token.Get("type").String() != value.ProviderID {
		return nil, false
	}
	domain := token.Get("domain").String()
	if domain != kimiauth.KimiDefaultDomain {
		return nil, false
	}
	storage := &kimiauth.KimiTokenStorage{
		AccessToken: token.Get("access_token").String(), RefreshToken: token.Get("refresh_token").String(),
		TokenType: token.Get("token_type").String(), Scope: token.Get("scope").String(),
		DeviceID: token.Get("device_id").String(), Expired: token.Get("expired").String(),
		Type: value.ProviderID, Domain: domain, BaseURL: token.Get("base_url").String(),
	}
	return storage, storage.AccessToken != "" && storage.RefreshToken != ""
}

func newMetaCredential(storage *metaauth.MetaTokenStorage, displayName string) (envelope, error) {
	if storage == nil || storage.AccessToken == "" || storage.APIKey == "" {
		return envelope{}, errors.New("Meta credential has no persisted API key")
	}
	raw, err := encodeObject(map[string]any{
		"type": "meta", "auth_kind": "oauth", "access_token": storage.AccessToken,
		"dca_token": storage.DCAToken, "api_key": storage.APIKey, "token_type": storage.TokenType,
		"expires_in": storage.ExpiresIn, "expired": storage.Expired, "dca_expired": storage.DCAExpired,
		"dca_expires_at": storage.DCAExpiresAt, "last_refresh": storage.LastRefresh,
		"base_url": storage.BaseURL, "email": storage.Email, "name": storage.Name,
	})
	if err != nil {
		return envelope{}, err
	}
	return providerCredential("meta", raw, time.Time{}, true, displayName)
}

func decodeMetaCredential(value envelope) (*metaauth.MetaTokenStorage, bool) {
	token, ok := readTokenStorage(value, "meta")
	if !ok || token.Get("type").String() != "meta" || token.Get("auth_kind").String() != "oauth" {
		return nil, false
	}
	storage := &metaauth.MetaTokenStorage{
		Type: "meta", AuthKind: "oauth", AccessToken: token.Get("access_token").String(),
		DCAToken: token.Get("dca_token").String(), APIKey: token.Get("api_key").String(),
		TokenType: token.Get("token_type").String(), ExpiresIn: int(token.Get("expires_in").Int()),
		Expired: token.Get("expired").String(), DCAExpired: token.Get("dca_expired").String(),
		DCAExpiresAt: token.Get("dca_expires_at").Int(), LastRefresh: token.Get("last_refresh").String(),
		BaseURL: token.Get("base_url").String(), Email: token.Get("email").String(), Name: token.Get("name").String(),
	}
	return storage, storage.APIKey != "" && storage.AccessToken != ""
}

func newDevinCredential(auth *cliproxyauth.Auth) (envelope, error) {
	if auth == nil || auth.Provider != "devin" {
		return envelope{}, errors.New("invalid Devin auth record")
	}
	raw, err := encodeObject(map[string]any{
		"type": "devin", "id": auth.ID, "label": auth.Label,
		"metadata": auth.Metadata, "attributes": auth.Attributes,
	})
	if err != nil {
		return envelope{}, err
	}
	return providerCredential("devin", raw, time.Time{}, true, auth.Label)
}

func decodeDevinCredential(value envelope) (*cliproxyauth.Auth, bool) {
	token, ok := readTokenStorage(value, "devin")
	if !ok || token.Get("type").String() != "devin" || !token.Get("metadata").IsObject() ||
		!token.Get("attributes").IsObject() {
		return nil, false
	}
	metadataValue := ojson.ParseBytes([]byte(token.Get("metadata").Raw)).Value()
	metadata, ok := metadataValue.(map[string]any)
	sessionToken, tokenOK := metadata["session_token"].(string)
	if !ok || metadata["type"] != "devin" || !tokenOK || strings.TrimSpace(sessionToken) == "" {
		return nil, false
	}
	attributes := make(map[string]string)
	token.Get("attributes").ForEach(func(key, value ojson.Result) bool {
		attributes[key.String()] = value.String()
		return true
	})
	return &cliproxyauth.Auth{
		ID: token.Get("id").String(), Provider: "devin", Label: token.Get("label").String(),
		Status: cliproxyauth.StatusActive, Metadata: metadata, Attributes: attributes,
	}, true
}

func providerAuthorizationURL(providerID string, pending pendingEnvelope) (map[string]any, error) {
	metadata := ojson.NewDoc(pending.Metadata)
	urlValue := metadata.Get("verificationUrl").String()
	userCode := metadata.Get("userCode").String()
	if urlValue == "" {
		return nil, errors.New("missing provider authorization URL")
	}
	return map[string]any{
		"url": urlValue, "userCode": userCode, "expiresAt": pending.ExpiresAt,
		"interval": pending.Interval, "callbackRequired": pending.CallbackRequired,
		"providerId": providerID,
	}, nil
}

func (b *bridge) authorizeProvider(w http.ResponseWriter, r *http.Request, providerID string) {
	if !supportedProvider(providerID) || providerID == "codex" {
		writeError(w, http.StatusBadRequest, "invalid_request", "This subscription provider is unavailable.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	now := time.Now()
	var pending pendingEnvelope
	switch providerID {
	case "claude":
		auth := claudeauth.NewClaudeAuth(&config.Config{})
		pkce, err := claudeauth.GeneratePKCECodes()
		if err != nil {
			writeProviderError(w, providerID, http.StatusBadGateway, "provider_unavailable")
			return
		}
		state, err := misc.GenerateRandomState()
		if err != nil {
			writeProviderError(w, providerID, http.StatusBadGateway, "provider_unavailable")
			return
		}
		authorizationURL, _, err := auth.GenerateAuthURL(state, pkce)
		if err != nil {
			writeProviderError(w, providerID, http.StatusBadGateway, "provider_unavailable")
			return
		}
		raw, err := encodeObject(map[string]any{
			"state": state, "codeVerifier": pkce.CodeVerifier,
			"verificationUrl": authorizationURL,
		})
		if err != nil {
			writeProviderError(w, providerID, http.StatusInternalServerError, "provider_unavailable")
			return
		}
		pending = providerPending(providerID, now.Add(claudeCallbackLifetime), 5*time.Second, raw, true)
	case "devin":
		pkce, err := devinauth.GeneratePKCECodes()
		if err != nil {
			writeProviderError(w, providerID, http.StatusBadGateway, "provider_unavailable")
			return
		}
		state, err := misc.GenerateRandomState()
		if err != nil {
			writeProviderError(w, providerID, http.StatusBadGateway, "provider_unavailable")
			return
		}
		redirectURI := "http://127.0.0.1:1455/callback"
		auth := devinauth.NewDevinAuthService(&http.Client{Timeout: 30 * time.Second})
		authorizationURL := auth.BuildAuthorizationURL(redirectURI, pkce.CodeChallenge, state)
		raw, err := encodeObject(map[string]any{
			"state": state, "codeVerifier": pkce.CodeVerifier, "redirectUri": redirectURI,
			"verificationUrl": authorizationURL,
		})
		if err != nil {
			writeProviderError(w, providerID, http.StatusInternalServerError, "provider_unavailable")
			return
		}
		pending = providerPending(providerID, now.Add(devinCallbackLifetime), 5*time.Second, raw, true)
	case "xai":
		auth := xaiauth.NewXAIAuth(&config.Config{})
		device, err := auth.StartDeviceFlow(ctx)
		if err != nil || device == nil || device.DeviceCode == "" {
			writeProviderError(w, providerID, http.StatusBadGateway, "provider_unavailable")
			return
		}
		interval := time.Duration(device.Interval) * time.Second
		expires := time.Duration(device.ExpiresIn) * time.Second
		if expires <= 0 {
			expires = 10 * time.Minute
		}
		verificationURL := device.VerificationURIComplete
		if verificationURL == "" {
			verificationURL = device.VerificationURI
		}
		if !safeProviderVerificationURL(verificationURL, "x.ai", "x.com") {
			writeProviderError(w, providerID, http.StatusBadGateway, "provider_unavailable")
			return
		}
		raw, err := encodeObject(map[string]any{
			"deviceCode": device.DeviceCode, "userCode": device.UserCode,
			"verificationUrl": verificationURL, "tokenEndpoint": device.TokenEndpoint,
		})
		if err != nil {
			writeProviderError(w, providerID, http.StatusInternalServerError, "provider_unavailable")
			return
		}
		pending = providerPending(providerID, now.Add(expires), interval, raw, false)
	case "kimi":
		domain := kimiauth.KimiDefaultDomain
		deviceID := uuid.NewString()
		client := kimiauth.NewDeviceFlowClientWithDomainDeviceIDAndProxyURL(&config.Config{}, domain, deviceID, "")
		device, err := client.RequestDeviceCode(ctx)
		if err != nil || device == nil || device.DeviceCode == "" {
			writeProviderError(w, providerID, http.StatusBadGateway, "provider_unavailable")
			return
		}
		interval := time.Duration(device.Interval) * time.Second
		expires := time.Duration(device.ExpiresIn) * time.Second
		if expires <= 0 {
			expires = 10 * time.Minute
		}
		verificationURL := device.VerificationURIComplete
		if verificationURL == "" {
			verificationURL = device.VerificationURI
		}
		suffix := "kimi.com"
		if !safeProviderVerificationURL(verificationURL, suffix) {
			writeProviderError(w, providerID, http.StatusBadGateway, "provider_unavailable")
			return
		}
		raw, err := encodeObject(map[string]any{
			"deviceCode": device.DeviceCode, "userCode": device.UserCode,
			"verificationUrl": verificationURL, "deviceId": deviceID, "domain": domain,
		})
		if err != nil {
			writeProviderError(w, providerID, http.StatusInternalServerError, "provider_unavailable")
			return
		}
		pending = providerPending(providerID, now.Add(expires), interval, raw, false)
	case "meta":
		auth := metaauth.NewMetaAuth(&config.Config{})
		device, err := auth.StartDeviceFlow(ctx)
		if err != nil || device == nil || device.DeviceCode == "" {
			writeProviderError(w, providerID, http.StatusBadGateway, "provider_unavailable")
			return
		}
		interval := time.Duration(device.Interval) * time.Second
		expires := time.Duration(device.ExpiresIn) * time.Second
		if expires <= 0 {
			expires = 10 * time.Minute
		}
		verificationURL := device.VerificationURIComplete
		if verificationURL == "" {
			verificationURL = device.VerificationURI
		}
		if !safeProviderVerificationURL(verificationURL, "meta.com") {
			writeProviderError(w, providerID, http.StatusBadGateway, "provider_unavailable")
			return
		}
		raw, err := encodeObject(map[string]any{
			"deviceCode": device.DeviceCode, "userCode": device.UserCode,
			"verificationUrl": verificationURL, "tokenEndpoint": device.TokenEndpoint,
		})
		if err != nil {
			writeProviderError(w, providerID, http.StatusInternalServerError, "provider_unavailable")
			return
		}
		pending = providerPending(providerID, now.Add(expires), interval, raw, false)
	}
	authorization, err := providerAuthorizationURL(providerID, pending)
	if err != nil {
		writeProviderError(w, providerID, http.StatusBadGateway, "provider_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"authorization": authorization, "pendingState": pendingValue(pending),
	})
}

func safeProviderVerificationURL(raw string, allowedSuffixes ...string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Hostname() == "" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	for _, suffix := range allowedSuffixes {
		if host == suffix || strings.HasSuffix(host, "."+suffix) {
			return true
		}
	}
	return false
}

func writeProviderError(w http.ResponseWriter, providerID string, status int, code string) {
	label := providerLabel(providerID)
	switch code {
	case "reconnect_required":
		writeError(w, status, code, "Reconnect this "+label+" subscription to continue.")
	case "rate_limited":
		writeError(w, status, code, label+" is temporarily rate limited. Try again later.")
	case "model_unavailable":
		writeError(w, status, code, "This model is not available in the "+label+" catalog.")
	default:
		writeError(w, status, code, label+" is temporarily unavailable. Try again later.")
	}
}

func callbackCodeAndState(rawCallback, expectedRedirect string) (string, string, error) {
	callback, err := url.ParseRequestURI(strings.TrimSpace(rawCallback))
	if err != nil {
		return "", "", errors.New("invalid callback URL")
	}
	expected, err := url.Parse(expectedRedirect)
	if err != nil || callback.Scheme != expected.Scheme || callback.Host != expected.Host ||
		callback.Path != expected.Path || callback.Fragment != "" || callback.User != nil {
		return "", "", errors.New("callback URL does not match")
	}
	query := callback.Query()
	if len(query["code"]) != 1 || len(query["state"]) != 1 ||
		query.Get("code") == "" || query.Get("state") == "" {
		return "", "", errors.New("callback is missing code or state")
	}
	return query.Get("code"), query.Get("state"), nil
}
