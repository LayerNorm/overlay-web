import UIKit
import SwiftUI

class KeyboardViewController: UIInputViewController {

    private var hostingController: UIHostingController<KeyboardView>?
    private let transcriptionService = TranscriptionService()
    private var keyboardHeightConstraint: NSLayoutConstraint?
    private var pendingInsertionText: String?
    private var insertionRetryWorkItem: DispatchWorkItem?
    private var insertionAttemptCount = 0
    private let maxInsertionAttempts = 16
    private let normalKeyboardHeight: CGFloat = 248
    private let compactKeyboardHeight: CGFloat = 216

    deinit {
        cancelInsertionRetry()
    }

    override func viewDidLoad() {
        super.viewDidLoad()

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
            transcriptionService: transcriptionService
        )

        let host = UIHostingController(rootView: keyboardView)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        host.view.backgroundColor = .clear

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
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        applyPreferredKeyboardHeight()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        transcriptionService.resumeFromSharedState()
        attemptPendingInsert()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        applyPreferredKeyboardHeight()
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        applyPreferredKeyboardHeight()
    }

    override func textDidChange(_ textInput: UITextInput?) {
        super.textDidChange(textInput)
        attemptPendingInsert()
    }

    private func enqueueTranscriptionForInsert(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        cancelInsertionRetry()
        pendingInsertionText = trimmed
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

    private func configureKeyboardHeight() {
        let heightConstraint = view.heightAnchor.constraint(equalToConstant: normalKeyboardHeight)
        heightConstraint.priority = UILayoutPriority(999)
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
