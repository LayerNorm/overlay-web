import Foundation
import AVFoundation

/// React Native bridge for App Group shared state between the Overlay app
/// and the OverlayKeyboard extension. All keys live in the shared
/// UserDefaults suite so both processes can read/write atomically.
@objc(SharedKeyStore)
class SharedKeyStore: NSObject {

    private static let appGroupID = "group.com.layernorm.overlay-mobile"
    private static let groqKeyName = "groq_api_key"
    private static let authTokenKey = "overlay_kb_auth_token"
    private static let authBaseURLKey = "overlay_kb_auth_base_url"
    private static let authUserIdKey = "overlay_kb_auth_user_id"
    private static let backgroundModeKey = "overlay_kb_background_mode_enabled"
    private static let transcriptionHistoryKey = "overlay_voice_transcription_history"
    private static let maxTranscriptionHistoryCount = 50

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroupID)
    }

    // MARK: - Groq key (legacy fallback)

    @objc func setGroqKey(_ key: String) {
        Self.defaults?.set(key, forKey: Self.groqKeyName)
        Self.defaults?.synchronize()
    }

    @objc func clearGroqKey() {
        Self.defaults?.removeObject(forKey: Self.groqKeyName)
        Self.defaults?.synchronize()
    }

    // MARK: - Auth session (token + base URL) for backend-routed transcription

    @objc func setAuthSession(_ token: String, baseURL: String, userId: String) {
        Self.defaults?.set(token, forKey: Self.authTokenKey)
        Self.defaults?.set(baseURL, forKey: Self.authBaseURLKey)
        Self.defaults?.set(userId, forKey: Self.authUserIdKey)
        Self.defaults?.synchronize()
    }

    @objc func clearAuthSession() {
        Self.defaults?.removeObject(forKey: Self.authTokenKey)
        Self.defaults?.removeObject(forKey: Self.authBaseURLKey)
        Self.defaults?.removeObject(forKey: Self.authUserIdKey)
        Self.defaults?.synchronize()
    }

    // MARK: - Background voice toggle

    @objc(setBackgroundModeEnabled:resolver:rejecter:)
    func setBackgroundModeEnabled(_ enabled: Bool,
                                  resolver: @escaping RCTPromiseResolveBlock,
                                  rejecter: @escaping RCTPromiseRejectBlock) {
        Self.defaults?.set(enabled, forKey: Self.backgroundModeKey)
        if !enabled {
            // Tell the recorder side (if running) to wind down by clearing
            // any recording state. The recorder polls this flag.
            Self.defaults?.set("idle", forKey: "overlay_kb_status")
            Self.defaults?.set("idle", forKey: "overlay_kb_command")
            Self.defaults?.set(Float(0), forKey: "overlay_kb_audio_level")
        }
        Self.defaults?.synchronize()

        if enabled {
            DispatchQueue.main.async {
                Self.activateBackgroundAudioSession()
                NotificationCenter.default.post(
                    name: Notification.Name("OverlayBackgroundVoiceDidChange"),
                    object: nil,
                    userInfo: ["enabled": true]
                )
            }
        } else {
            DispatchQueue.main.async {
                Self.deactivateBackgroundAudioSession()
                NotificationCenter.default.post(
                    name: Notification.Name("OverlayBackgroundVoiceDidChange"),
                    object: nil,
                    userInfo: ["enabled": false]
                )
            }
        }

        resolver(enabled)
    }

    @objc(getBackgroundModeEnabled:rejecter:)
    func getBackgroundModeEnabled(_ resolver: @escaping RCTPromiseResolveBlock,
                                  rejecter: @escaping RCTPromiseRejectBlock) {
        let enabled = Self.defaults?.bool(forKey: Self.backgroundModeKey) ?? false
        resolver(enabled)
    }

    // MARK: - Transcription history

    static func appendTranscription(_ text: String) {
        let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return }

        var history = Self.loadTranscriptionHistory()
        let item: [String: Any] = [
            "id": UUID().uuidString,
            "text": normalized,
            "createdAt": ISO8601DateFormatter().string(from: Date())
        ]
        history.insert(item, at: 0)
        if history.count > Self.maxTranscriptionHistoryCount {
            history = Array(history.prefix(Self.maxTranscriptionHistoryCount))
        }
        Self.defaults?.set(history, forKey: Self.transcriptionHistoryKey)
        Self.defaults?.synchronize()
    }

    @objc(getTranscriptionHistory:rejecter:)
    func getTranscriptionHistory(_ resolver: @escaping RCTPromiseResolveBlock,
                                 rejecter: @escaping RCTPromiseRejectBlock) {
        resolver(Self.loadTranscriptionHistory())
    }

    @objc(deleteTranscription:resolver:rejecter:)
    func deleteTranscription(_ id: String,
                             resolver: @escaping RCTPromiseResolveBlock,
                             rejecter: @escaping RCTPromiseRejectBlock) {
        let history = Self.loadTranscriptionHistory().filter { item in
            (item["id"] as? String) != id
        }
        Self.defaults?.set(history, forKey: Self.transcriptionHistoryKey)
        Self.defaults?.synchronize()
        resolver(true)
    }

    // MARK: - Microphone permission

    @objc(getMicPermission:rejecter:)
    func getMicPermission(_ resolver: @escaping RCTPromiseResolveBlock,
                          rejecter: @escaping RCTPromiseRejectBlock) {
        let perm = AVAudioSession.sharedInstance().recordPermission
        resolver(Self.permissionString(perm))
    }

    @objc(requestMicPermission:rejecter:)
    func requestMicPermission(_ resolver: @escaping RCTPromiseResolveBlock,
                              rejecter: @escaping RCTPromiseRejectBlock) {
        let session = AVAudioSession.sharedInstance()
        switch session.recordPermission {
        case .granted:
            resolver("granted")
        case .denied:
            resolver("denied")
        case .undetermined:
            session.requestRecordPermission { granted in
                DispatchQueue.main.async {
                    resolver(granted ? "granted" : "denied")
                }
            }
        @unknown default:
            resolver("denied")
        }
    }

    // MARK: - Helpers

    private static func permissionString(_ perm: AVAudioSession.RecordPermission) -> String {
        switch perm {
        case .granted: return "granted"
        case .denied: return "denied"
        case .undetermined: return "undetermined"
        @unknown default: return "undetermined"
        }
    }

    private static func loadTranscriptionHistory() -> [[String: Any]] {
        let raw = Self.defaults?.array(forKey: Self.transcriptionHistoryKey) as? [[String: Any]] ?? []
        return raw.compactMap { item in
            guard
                let id = item["id"] as? String,
                let text = item["text"] as? String,
                let createdAt = item["createdAt"] as? String,
                !id.isEmpty,
                !text.isEmpty
            else {
                return nil
            }
            return ["id": id, "text": text, "createdAt": createdAt]
        }
    }

    private static func activateBackgroundAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(
                .playAndRecord,
                mode: .default,
                options: [.mixWithOthers, .defaultToSpeaker, .allowBluetooth]
            )
            try session.setActive(true)
            NSLog("[SharedKeyStore] Background audio session activated")
        } catch {
            NSLog("[SharedKeyStore] Failed to activate audio session: \(error)")
        }
    }

    private static func deactivateBackgroundAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            NSLog("[SharedKeyStore] Background audio session deactivated")
        } catch {
            NSLog("[SharedKeyStore] Failed to deactivate audio session: \(error)")
        }
    }

    @objc static func requiresMainQueueSetup() -> Bool {
        return false
    }
}
