import SwiftUI

struct KeyboardView: View {
    let hasFullAccess: Bool
    @ObservedObject var transcriptionService: TranscriptionService

    init(hasFullAccess: Bool, transcriptionService: TranscriptionService) {
        self.hasFullAccess = hasFullAccess
        self.transcriptionService = transcriptionService
    }

    var body: some View {
        ZStack {
            Color(red: 0.07, green: 0.07, blue: 0.07)
                .ignoresSafeArea()

            if !hasFullAccess {
                NoAccessView()
            } else {
                RecordingView(service: transcriptionService)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct RecordingView: View {
    @ObservedObject var service: TranscriptionService
    @Environment(\.verticalSizeClass) private var verticalSizeClass

    var body: some View {
        keyboardContent(compact: verticalSizeClass == .compact)
    }

    private func handleButtonTap() {
        switch service.state {
        case .idle:
            service.startRecording()
        case .recording:
            service.stopRecording()
        case .processing:
            break // Can't interrupt
        case .done, .error:
            service.startRecording()
        }
    }

    @ViewBuilder
    private func keyboardContent(compact: Bool) -> some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.08, green: 0.09, blue: 0.11),
                    Color(red: 0.05, green: 0.06, blue: 0.08)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .clipShape(RoundedRectangle(cornerRadius: 18))

            RoundedRectangle(cornerRadius: 18)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)

            VStack(spacing: compact ? 7 : 10) {
                topBar(compact: compact)

                if service.state == .recording {
                    WaveformView(level: service.audioLevel)
                        .frame(height: compact ? 24 : 36)
                        .padding(.horizontal, compact ? 18 : 24)
                }

                recordButton(compact: compact)
                statusChip(compact: compact)
            }
            .padding(.horizontal, compact ? 10 : 14)
            .padding(.vertical, compact ? 8 : 10)
            .frame(maxWidth: .infinity, alignment: .top)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    @ViewBuilder
    private func topBar(compact: Bool) -> some View {
        HStack(spacing: 10) {
            Label("Background Mic", systemImage: service.backgroundModeEnabled ? "waveform.and.mic" : "mic.slash")
                .font(.system(size: compact ? 10 : 11, weight: .semibold))
                .foregroundColor(service.backgroundModeEnabled ? Color(red: 0.3, green: 0.9, blue: 0.5) : Color(white: 0.7))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .layoutPriority(1)

            Spacer(minLength: 6)

            Toggle("", isOn: Binding(
                get: { service.backgroundModeEnabled },
                set: { service.setBackgroundModeEnabled($0) }
            ))
            .labelsHidden()
            .toggleStyle(SwitchToggleStyle(tint: Color.green))
            .scaleEffect(compact ? 0.9 : 1.0)
        }
        .padding(.horizontal, compact ? 9 : 10)
        .padding(.vertical, compact ? 5 : 6)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.white.opacity(0.06))
        )
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private func recordButton(compact: Bool) -> some View {
        Button {
            handleButtonTap()
        } label: {
            ZStack {
                if service.state == .recording {
                    Circle()
                        .stroke(Color.red.opacity(0.35), lineWidth: compact ? 2.5 : 3)
                        .frame(width: compact ? 68 : 78, height: compact ? 68 : 78)
                        .scaleEffect(1.0 + CGFloat(service.audioLevel) * 0.2)
                        .animation(.easeOut(duration: 0.1), value: service.audioLevel)
                }

                Circle()
                    .fill(buttonBackground)
                    .frame(width: compact ? 54 : 62, height: compact ? 54 : 62)
                    .shadow(color: buttonBackground.opacity(0.45), radius: compact ? 5 : 8, y: 2)

                buttonIcon
            }
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func statusChip(compact: Bool) -> some View {
        Text(statusLabel)
            .font(.system(size: compact ? 11 : 12, weight: .medium))
            .foregroundColor(statusColor)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .minimumScaleFactor(0.75)
            .padding(.horizontal, compact ? 10 : 12)
            .padding(.vertical, compact ? 5 : 6)
            .frame(maxWidth: .infinity)
            .background(
                Capsule()
                    .fill(Color.white.opacity(0.06))
            )
    }

    private var buttonBackground: Color {
        switch service.state {
        case .idle:       return Color(white: 0.22)
        case .recording:  return Color.red
        case .processing: return Color(white: 0.3)
        case .done:       return Color(red: 0.2, green: 0.7, blue: 0.4)
        case .error:      return Color.orange
        }
    }

    @ViewBuilder
    private var buttonIcon: some View {
        switch service.state {
        case .idle, .done, .error:
            Image(systemName: "mic.fill")
                .font(.system(size: 24, weight: .medium))
                .foregroundColor(.white)
        case .recording:
            Image(systemName: "stop.fill")
                .font(.system(size: 22, weight: .medium))
                .foregroundColor(.white)
        case .processing:
            ProgressView()
                .tint(.white)
                .scaleEffect(1.1)
        }
    }

    private var statusLabel: String {
        switch service.state {
        case .idle:
            return "Tap to dictate"
        case .recording:
            return "Recording… tap to stop"
        case .processing:
            return "Transcribing…"
        case .done(let text):
            let preview = text.count > 30 ? String(text.prefix(30)) + "…" : text
            return "✓ \(preview)"
        case .error(let msg):
            return msg
        }
    }

    private var statusColor: Color {
        switch service.state {
        case .idle:       return Color(white: 0.55)
        case .recording:  return Color.red
        case .processing: return Color(red: 1, green: 0.7, blue: 0.2)
        case .done:       return Color(red: 0.3, green: 0.9, blue: 0.5)
        case .error:      return Color.orange
        }
    }
}

// MARK: - Waveform

struct WaveformView: View {
    let level: Float
    private let barCount = 9

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<barCount, id: \.self) { index in
                WaveformBar(level: level, index: index, total: barCount)
            }
        }
    }
}

struct WaveformBar: View {
    let level: Float
    let index: Int
    let total: Int

    var body: some View {
        let centerDistance = abs(CGFloat(index) - CGFloat(total - 1) / 2.0) / (CGFloat(total) / 2.0)
        let noise = CGFloat.random(in: 0.6...1.4)
        let baseHeight: CGFloat = 4
        let maxHeight: CGFloat = 36
        let height = baseHeight + (maxHeight - baseHeight) * CGFloat(level) * (1.0 - centerDistance * 0.4) * noise

        RoundedRectangle(cornerRadius: 2)
            .fill(Color.red)
            .frame(width: 4, height: max(baseHeight, min(maxHeight, height)))
            .animation(.easeOut(duration: 0.08), value: level)
    }
}

// MARK: - No Access

struct NoAccessView: View {
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "lock.fill")
                .font(.system(size: 22))
                .foregroundColor(Color(white: 0.45))

            Text("Full Access Required")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.white)

            Text("Settings → General → Keyboard → Overlay → Allow Full Access")
                .font(.system(size: 11))
                .foregroundColor(Color(white: 0.45))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
    }
}
