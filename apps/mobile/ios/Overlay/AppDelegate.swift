internal import Expo
import React
import ReactAppDependencyProvider
import AVFoundation

@UIApplicationMain
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?
  // Long-lived recorder owned by the app process. When background voice is
  // enabled, this stays alive so the keyboard's start/stop commands can drive
  // recording without ever foregrounding a modal screen.
  var backgroundVoiceController: RecordingViewController?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    // If background voice was previously toggled on, bring up the headless
    // controller right away so the keyboard works on cold launches too.
    DispatchQueue.main.async {
      self.startBackgroundVoiceControllerIfNeeded()
    }

    NotificationCenter.default.addObserver(
      forName: Notification.Name("OverlayBackgroundVoiceDidChange"),
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.startBackgroundVoiceControllerIfNeeded()
    }

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API. We no longer present a modal recorder for `overlay://dictate`;
  // instead we hand the URL to React Native so the JS layer routes the user
  // to the Voice page (which will auto-enable the switch).
  override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    if url.scheme == "overlay" && url.host == "dictate" {
      // Forward to RN linking so JS can navigate. Returning false from the
      // override falls through to RCTLinkingManager below.
      return RCTLinkingManager.application(app, open: url, options: options)
    }
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  /// Headless recorder lifecycle. The controller is parked off-screen so it
  /// never appears in the user's view hierarchy; it just owns the audio
  /// session and command poller.
  func startBackgroundVoiceControllerIfNeeded() {
    let appGroupID = "group.com.layernorm.overlay-mobile"
    let defaults = UserDefaults(suiteName: appGroupID)
    let enabled = defaults?.bool(forKey: "overlay_kb_background_mode_enabled") ?? false
    if enabled && backgroundVoiceController == nil {
      let vc = RecordingViewController()
      vc.headlessMode = true
      // Add as a child VC of the root with zero size so it gets viewDidLoad/
      // viewDidAppear without being visible.
      if let root = window?.rootViewController {
        root.addChild(vc)
        vc.view.frame = .zero
        vc.view.isHidden = true
        root.view.addSubview(vc.view)
        vc.didMove(toParent: root)
      }
      backgroundVoiceController = vc
      vc.startBackgroundEngine()
    } else if !enabled, let vc = backgroundVoiceController {
      vc.willMove(toParent: nil)
      vc.view.removeFromSuperview()
      vc.removeFromParent()
      backgroundVoiceController = nil
    }
  }

  // Universal Links
  override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
