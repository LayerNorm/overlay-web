import Foundation

@objc(SharedKeyStore)
class SharedKeyStore: NSObject {

    private static let appGroupID = "group.com.layernorm.overlay-mobile"
    private static let groqKeyName = "groq_api_key"

    @objc func setGroqKey(_ key: String) {
        let defaults = UserDefaults(suiteName: Self.appGroupID)
        defaults?.set(key, forKey: Self.groqKeyName)
        defaults?.synchronize()
    }

    @objc func clearGroqKey() {
        let defaults = UserDefaults(suiteName: Self.appGroupID)
        defaults?.removeObject(forKey: Self.groqKeyName)
        defaults?.synchronize()
    }

    @objc static func requiresMainQueueSetup() -> Bool {
        return false
    }
}
