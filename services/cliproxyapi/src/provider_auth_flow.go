package main

import (
	"context"
	"net/http"
	"time"

	"github.com/MoeForge/moego/ojson"
	claudeauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/claude"
	devinauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/devin"
	kimiauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/kimi"
	metaauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/meta"
	xaiauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/xai"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

func validPendingState(pending pendingEnvelope, providerID string) bool {
	return pending.Backend == backendName && pending.Version == 1 &&
		pending.ProviderID == providerID && supportedProvider(providerID) &&
		providerID != "codex" && pending.ExpiresAt > time.Now().UnixMilli() &&
		pending.Interval >= 1 && pending.Interval <= 1800 &&
		len(pending.Metadata) > 0
}

func (b *bridge) pollProvider(w http.ResponseWriter, r *http.Request, pending pendingEnvelope) {
	if !validPendingState(pending, pending.ProviderID) {
		writeProviderError(w, pending.ProviderID, http.StatusGone, "reconnect_required")
		return
	}
	if !ojsonObject(pending.Metadata) {
		writeError(w, http.StatusBadRequest, "invalid_request", "The authorization state is unavailable.")
		return
	}
	if pending.CallbackRequired {
		writeJSON(w, http.StatusOK, map[string]any{
			"status": "pending", "pendingState": pendingValue(pending),
		})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	metadata := newJSONDoc(pending.Metadata)
	interval := time.Duration(pending.Interval) * time.Second
	var credential envelope
	var pendingAgain bool
	switch pending.ProviderID {
	case "xai":
		tokenEndpoint := metadata.Get("tokenEndpoint").String()
		deviceCode := metadata.Get("deviceCode").String()
		auth := xaiauth.NewXAIAuth(&config.Config{})
		tokens, err, nextInterval, shouldContinue := auth.PollDeviceCodeOnce(ctx, tokenEndpoint, deviceCode, interval)
		if err != nil {
			status, code, _ := safeProviderRefreshError(pending.ProviderID, err)
			writeProviderError(w, pending.ProviderID, status, code)
			return
		}
		interval = nextInterval
		pendingAgain = shouldContinue
		if !pendingAgain && tokens != nil {
			storage := auth.CreateTokenStorage(&xaiauth.AuthBundle{
				TokenData: *tokens, LastRefresh: time.Now().UTC().Format(time.RFC3339),
				BaseURL: xaiauth.DefaultAPIBaseURL, TokenEndpoint: tokenEndpoint,
			})
			var errCredential error
			credential, errCredential = newXaiCredential(storage)
			if errCredential != nil {
				writeProviderError(w, pending.ProviderID, http.StatusBadGateway, "reconnect_required")
				return
			}
		}
	case "kimi", "kimi-ai":
		domain, deviceID := metadata.Get("domain").String(), metadata.Get("deviceId").String()
		if domain != kimiDomain(pending.ProviderID) || deviceID == "" {
			writeError(w, http.StatusBadRequest, "invalid_request", "The authorization state is unavailable.")
			return
		}
		client := kimiauth.NewDeviceFlowClientWithDomainDeviceIDAndProxyURL(&config.Config{}, domain, deviceID, "")
		tokens, isPending, nextInterval, err := client.PollDeviceCodeOnce(ctx, metadata.Get("deviceCode").String(), interval)
		if err != nil {
			status, code, _ := safeProviderRefreshError(pending.ProviderID, err)
			writeProviderError(w, pending.ProviderID, status, code)
			return
		}
		interval, pendingAgain = nextInterval, isPending
		if !pendingAgain && tokens != nil {
			storage := kimiauth.NewKimiAuthWithDomain(&config.Config{}, domain).CreateTokenStorage(&kimiauth.KimiAuthBundle{
				TokenData: tokens, DeviceID: deviceID,
			})
			var errCredential error
			credential, errCredential = newKimiCredential(pending.ProviderID, storage)
			if errCredential != nil {
				writeProviderError(w, pending.ProviderID, http.StatusBadGateway, "reconnect_required")
				return
			}
		}
	case "meta":
		device := &metaauth.DeviceCodeResponse{
			DeviceCode:    metadata.Get("deviceCode").String(),
			TokenEndpoint: metadata.Get("tokenEndpoint").String(),
			Interval:      pending.Interval,
		}
		auth := metaauth.NewMetaAuth(&config.Config{})
		bundle, isPending, nextInterval, err := auth.PollForAuthorizationOnce(ctx, device, interval)
		if err != nil {
			status, code, _ := safeProviderRefreshError(pending.ProviderID, err)
			writeProviderError(w, pending.ProviderID, status, code)
			return
		}
		interval, pendingAgain = nextInterval, isPending
		if !pendingAgain && bundle != nil && bundle.MintedKey != nil && bundle.MintedKey.APIKey != "" {
			storage := auth.CreateTokenStorage(bundle)
			displayName := storage.Email
			if displayName == "" {
				displayName = storage.Name
			}
			var errCredential error
			credential, errCredential = newMetaCredential(storage, displayName)
			if errCredential != nil {
				writeProviderError(w, pending.ProviderID, http.StatusBadGateway, "reconnect_required")
				return
			}
		} else if !pendingAgain {
			writeProviderError(w, pending.ProviderID, http.StatusBadGateway, "provider_unavailable")
			return
		}
	default:
		writeError(w, http.StatusBadRequest, "invalid_request", "This authorization flow cannot be polled.")
		return
	}
	if pendingAgain {
		if interval < time.Second {
			interval = time.Second
		}
		pending.Interval = int(interval.Seconds())
		writeJSON(w, http.StatusOK, map[string]any{
			"status": "pending", "pendingState": pendingValue(pending),
		})
		return
	}
	if credential.ProviderID == "" {
		writeProviderError(w, pending.ProviderID, http.StatusBadGateway, "provider_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "connected", "credential": envelopeValue(credential),
	})
}

func (b *bridge) completeProvider(w http.ResponseWriter, r *http.Request, pending pendingEnvelope, callbackURL string) {
	providerID := pending.ProviderID
	if !validPendingState(pending, providerID) || !pending.CallbackRequired || !ojsonObject(pending.Metadata) {
		writeProviderError(w, providerID, http.StatusGone, "reconnect_required")
		return
	}
	metadata := newJSONDoc(pending.Metadata)
	redirectURI := claudeauth.RedirectURI
	if providerID == "devin" {
		redirectURI = metadata.Get("redirectUri").String()
	}
	code, state, err := callbackCodeAndState(callbackURL, redirectURI)
	if err != nil || state != metadata.Get("state").String() || metadata.Get("codeVerifier").String() == "" {
		writeError(w, http.StatusBadRequest, "invalid_callback", "The authorization callback does not match this connection.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	switch providerID {
	case "claude":
		pkce := &claudeauth.PKCECodes{CodeVerifier: metadata.Get("codeVerifier").String()}
		auth := claudeauth.NewClaudeAuth(&config.Config{})
		bundle, errExchange := auth.ExchangeCodeForTokens(ctx, code, state, pkce)
		if errExchange != nil || bundle == nil || bundle.TokenData.AccessToken == "" {
			status, errorCode, _ := safeProviderRefreshError(providerID, errExchange)
			writeProviderError(w, providerID, status, errorCode)
			return
		}
		storage := auth.CreateTokenStorage(bundle)
		storage.Type = "claude"
		storage.LastRefresh = time.Now().UTC().Format(time.RFC3339)
		credential, errCredential := newClaudeCredential(storage, storage.Email)
		if errCredential != nil {
			writeProviderError(w, providerID, http.StatusBadGateway, "reconnect_required")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "connected", "credential": envelopeValue(credential)})
	case "devin":
		auth := devinauth.NewDevinAuthService(&http.Client{Timeout: 30 * time.Second})
		sessionToken, errExchange := auth.ExchangeCodeForToken(ctx, code, metadata.Get("codeVerifier").String())
		if errExchange != nil || sessionToken == "" {
			status, errorCode, _ := safeProviderRefreshError(providerID, errExchange)
			writeProviderError(w, providerID, status, errorCode)
			return
		}
		record, errRecord := auth.CreateAuthRecord(ctx, sessionToken)
		if errRecord != nil || record == nil {
			writeProviderError(w, providerID, http.StatusBadGateway, "provider_unavailable")
			return
		}
		credential, errCredential := newDevinCredential(record)
		if errCredential != nil {
			writeProviderError(w, providerID, http.StatusBadGateway, "reconnect_required")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "connected", "credential": envelopeValue(credential)})
	default:
		writeError(w, http.StatusBadRequest, "invalid_request", "This authorization flow cannot be completed.")
	}
}

func ojsonObject(raw []byte) bool {
	return len(raw) > 0 && ojson.ParseBytes(raw).IsObject()
}

func newJSONDoc(raw []byte) *ojson.Doc {
	return ojson.NewDoc(raw)
}
