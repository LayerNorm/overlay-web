import UIKit
import SwiftUI

class KeyboardViewController: UIInputViewController, UIInputViewAudioFeedback {

    private var hostingController: UIHostingController<KeyboardView>?
    private let transcriptionService = TranscriptionService()
    private let keyboardContext = KeyboardContext()
    private var keyboardHeightConstraint: NSLayoutConstraint?
    private var pendingInsertionText: String?
    private var insertionRetryWorkItem: DispatchWorkItem?
    private var insertionAttemptCount = 0
    private let maxInsertionAttempts = 16
    // Layout budget (regular): headerBarH(40) + 4×rowTouchHeight(4×52=208) = 248pt.
    // Layout budget (compact): headerBarH(34) + 4×rowTouchHeight(4×43=172) = 206pt.
    private let normalKeyboardHeight: CGFloat = 248
    private let compactKeyboardHeight: CGFloat = 206
    private let keyboardBaseColor = UIColor.clear

    deinit {
        cancelInsertionRetry()
    }

    var enableInputClicksWhenVisible: Bool {
        true
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = keyboardBaseColor
        view.isOpaque = false
        inputView?.backgroundColor = keyboardBaseColor
        inputView?.isOpaque = false

        // Wire up URL opener via KVC
        transcriptionService.openURL = { url in
            if let application = UIApplication.value(forKeyPath: "sharedApplication") as? UIApplication {
                application.open(url, options: [:]) { success in
                    NSLog("[OverlayKeyboard] open URL result: \(success)")
                }
            } else {
                NSLog("[OverlayKeyboard] Could not get sharedApplication")
            }
        }

        // Wire up transcription callback to insert text
        transcriptionService.onTranscriptionReady = { [weak self] text in
            self?.enqueueTranscriptionForInsert(text)
        }

        let keyboardView = KeyboardView(
            hasFullAccess: self.hasFullAccess,
            transcriptionService: transcriptionService,
            context: keyboardContext,
            onInsertText: { [weak self] text in
                self?.insertTextFromKey(text)
            },
            onBackspace: { [weak self] in
                self?.handleBackspace()
            },
            onReturn: { [weak self] in
                self?.handleReturnKey()
            },
            onNextKeyboard: { [weak self] in
                self?.handleNextKeyboard()
            }
        )

        let host = UIHostingController(rootView: keyboardView)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        host.view.backgroundColor = keyboardBaseColor
        host.view.isOpaque = false

        addChild(host)
        view.addSubview(host.view)
        host.didMove(toParent: self)

        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        hostingController = host
        configureKeyboardHeight()
        refreshKeyboardContext()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        applyPreferredKeyboardHeight()
        refreshKeyboardContext()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        transcriptionService.resumeFromSharedState()
        attemptPendingInsert()
        refreshKeyboardContext()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        applyPreferredKeyboardHeight()
        refreshKeyboardContext()
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        applyPreferredKeyboardHeight()
        refreshKeyboardContext()
    }

    override func textDidChange(_ textInput: UITextInput?) {
        super.textDidChange(textInput)
        attemptPendingInsert()
        refreshKeyboardContext()
    }

    private func enqueueTranscriptionForInsert(_ text: String) {
        guard let normalized = normalizeTranscriptionForInsert(text) else { return }
        cancelInsertionRetry()
        pendingInsertionText = normalized
        insertionAttemptCount = 0
        attemptPendingInsert()
    }

    private func attemptPendingInsert() {
        guard let text = pendingInsertionText else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard self.view.window != nil else {
                self.scheduleInsertionRetry()
                return
            }

            let beforeContext = self.textDocumentProxy.documentContextBeforeInput
            let afterContext = self.textDocumentProxy.documentContextAfterInput
            self.textDocumentProxy.insertText(text)

            let updatedBeforeContext = self.textDocumentProxy.documentContextBeforeInput
            let updatedAfterContext = self.textDocumentProxy.documentContextAfterInput
            let insertionLooksSuccessful =
                (updatedBeforeContext?.hasSuffix(text) == true) ||
                (beforeContext != updatedBeforeContext) ||
                (afterContext != updatedAfterContext)

            if insertionLooksSuccessful {
                self.finishPendingInsert(successText: text)
            } else {
                self.scheduleInsertionRetry()
            }
        }
    }

    private func finishPendingInsert(successText text: String) {
        cancelInsertionRetry()
        pendingInsertionText = nil
        insertionAttemptCount = 0
        transcriptionService.acknowledgeInsertion()
        NSLog("[OverlayKeyboard] Inserted transcription (\(text.count) chars)")
    }

    private func scheduleInsertionRetry() {
        guard let text = pendingInsertionText else { return }
        cancelInsertionRetry()

        if insertionAttemptCount >= maxInsertionAttempts {
            UIPasteboard.general.string = text
            pendingInsertionText = nil
            insertionAttemptCount = 0
            transcriptionService.acknowledgeInsertion()
            transcriptionService.state = .error("Paste failed. Copied to clipboard.")
            NSLog("[OverlayKeyboard] Insert failed after retries; copied transcription to clipboard")
            return
        }

        insertionAttemptCount += 1
        let delay = min(0.15 * Double(insertionAttemptCount), 0.6)
        let workItem = DispatchWorkItem { [weak self] in
            self?.attemptPendingInsert()
        }
        insertionRetryWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: workItem)
    }

    private func cancelInsertionRetry() {
        insertionRetryWorkItem?.cancel()
        insertionRetryWorkItem = nil
    }

    private func normalizeTranscriptionForInsert(_ rawText: String) -> String? {
        let trimmed = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let punctuationSet = CharacterSet(charactersIn: ".,!?;:'\")]}").union(.newlines)
        if let lastScalar = trimmed.unicodeScalars.last, punctuationSet.contains(lastScalar) {
            return trimmed
        }

        if let afterContext = textDocumentProxy.documentContextAfterInput,
           let first = afterContext.unicodeScalars.first,
           CharacterSet.whitespacesAndNewlines.contains(first) {
            return trimmed
        }

        return "\(trimmed) "
    }

    private func insertTextFromKey(_ text: String) {
        guard !text.isEmpty else { return }
        cancelInsertionRetry()
        textDocumentProxy.insertText(text)
        UIDevice.current.playInputClick()
        refreshKeyboardContext()
    }

    private func handleBackspace() {
        cancelInsertionRetry()
        textDocumentProxy.deleteBackward()
        UIDevice.current.playInputClick()
        refreshKeyboardContext()
    }

    private func handleReturnKey() {
        cancelInsertionRetry()
        textDocumentProxy.insertText("\n")
        UIDevice.current.playInputClick()
        refreshKeyboardContext()
    }

    private func handleNextKeyboard() {
        advanceToNextInputMode()
        UIDevice.current.playInputClick()
        refreshKeyboardContext()
    }

    private func refreshKeyboardContext() {
        keyboardContext.needsInputModeSwitchKey = needsInputModeSwitchKey
        keyboardContext.returnKeyTitle = returnKeyTitle(for: textDocumentProxy.returnKeyType ?? .default)
    }

    private func returnKeyTitle(for keyType: UIReturnKeyType) -> String {
        switch keyType {
        case .go:
            return "Go"
        case .google:
            return "Google"
        case .join:
            return "Join"
        case .next:
            return "Next"
        case .route:
            return "Route"
        case .search:
            return "Search"
        case .send:
            return "Send"
        case .yahoo:
            return "Yahoo"
        case .done:
            return "Done"
        case .emergencyCall:
            return "Emergency"
        case .continue:
            return "Continue"
        default:
            return "Return"
        }
    }

    private func configureKeyboardHeight() {
        let heightConstraint = view.heightAnchor.constraint(equalToConstant: normalKeyboardHeight)
        heightConstraint.priority = .required
        heightConstraint.isActive = true
        keyboardHeightConstraint = heightConstraint
        applyPreferredKeyboardHeight()
    }

    private func applyPreferredKeyboardHeight() {
        let isCompact = traitCollection.verticalSizeClass == .compact
        let targetHeight = isCompact ? compactKeyboardHeight : normalKeyboardHeight
        if keyboardHeightConstraint?.constant != targetHeight {
            keyboardHeightConstraint?.constant = targetHeight
        }
        if preferredContentSize.height != targetHeight {
            preferredContentSize = CGSize(width: 0, height: targetHeight)
        }
    }
}
