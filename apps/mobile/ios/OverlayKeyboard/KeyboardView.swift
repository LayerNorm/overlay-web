import SwiftUI
import Combine

final class KeyboardContext: ObservableObject {
    @Published var needsInputModeSwitchKey: Bool = true
    @Published var returnKeyTitle: String = "Return"
}

private enum KeyboardPage {
    case letters
    case numbers
    case symbols
    case emoji
}

private enum ShiftState {
    case lower
    case upper
    case caps
}

private enum EmojiCategory: String, CaseIterable, Identifiable {
    case all
    case smileys
    case people
    case animals
    case food
    case activities
    case travel
    case objects
    case symbols
    case flags

    var id: String { rawValue }

    var symbolName: String {
        switch self {
        case .all: return "square.grid.2x2"
        case .smileys: return "face.smiling"
        case .people: return "person.2"
        case .animals: return "pawprint"
        case .food: return "fork.knife"
        case .activities: return "gamecontroller"
        case .travel: return "car"
        case .objects: return "lightbulb"
        case .symbols: return "number"
        case .flags: return "flag"
        }
    }

    var menuTitle: String {
        switch self {
        case .all: return "All"
        case .smileys: return "Smileys"
        case .people: return "People"
        case .animals: return "Animals"
        case .food: return "Food"
        case .activities: return "Activity"
        case .travel: return "Travel"
        case .objects: return "Objects"
        case .symbols: return "Symbols"
        case .flags: return "Flags"
        }
    }
}

private enum KeyboardPalette {
    static let background = Color.clear
    static let key = Color(red: 113.0 / 255.0, green: 113.0 / 255.0, blue: 113.0 / 255.0)
    static let keyPressed = Color(red: 98.0 / 255.0, green: 98.0 / 255.0, blue: 98.0 / 255.0)
    static let functionKey = Color(red: 0.33, green: 0.33, blue: 0.35)
    static let actionKey = Color(red: 0.31, green: 0.31, blue: 0.33)
    static let keyStroke = Color.white.opacity(0.10)
    static let text = Color.white.opacity(0.96)
    static let secondaryText = Color.white.opacity(0.82)
    static let recording = Color(red: 0.96, green: 0.29, blue: 0.27)
    static let mode = Color(red: 0.25, green: 0.25, blue: 0.27)
}

struct KeyboardView: View {
    let hasFullAccess: Bool
    @ObservedObject var transcriptionService: TranscriptionService
    @ObservedObject var context: KeyboardContext
    let onInsertText: (String) -> Void
    let onBackspace: () -> Void
    let onReturn: () -> Void
    let onNextKeyboard: () -> Void

    init(
        hasFullAccess: Bool,
        transcriptionService: TranscriptionService,
        context: KeyboardContext,
        onInsertText: @escaping (String) -> Void,
        onBackspace: @escaping () -> Void,
        onReturn: @escaping () -> Void,
        onNextKeyboard: @escaping () -> Void
    ) {
        self.hasFullAccess = hasFullAccess
        self.transcriptionService = transcriptionService
        self.context = context
        self.onInsertText = onInsertText
        self.onBackspace = onBackspace
        self.onReturn = onReturn
        self.onNextKeyboard = onNextKeyboard
    }

    var body: some View {
        ZStack {
            Color.clear
                .ignoresSafeArea()

            if !hasFullAccess {
                NoAccessView()
            } else {
                OverlayKeyboardView(
                    service: transcriptionService,
                    context: context,
                    onInsertText: onInsertText,
                    onBackspace: onBackspace,
                    onReturn: onReturn,
                    onNextKeyboard: onNextKeyboard
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct OverlayKeyboardView: View {
    @ObservedObject var service: TranscriptionService
    @ObservedObject var context: KeyboardContext

    let onInsertText: (String) -> Void
    let onBackspace: () -> Void
    let onReturn: () -> Void
    let onNextKeyboard: () -> Void

    @Environment(\.verticalSizeClass) private var verticalSizeClass

    @State private var page: KeyboardPage = .letters
    @State private var shiftState: ShiftState = .lower
    @State private var lastShiftTapTime: Date = .distantPast
    @State private var selectedEmojiCategory: EmojiCategory = .all

    private var compact: Bool {
        verticalSizeClass == .compact
    }

    private var keyHeight: CGFloat {
        compact ? 35 : 44
    }

    private var keyHorizontalSpacing: CGFloat {
        compact ? 4 : 5
    }

    private var keyRowSpacing: CGFloat {
        compact ? 5 : 6
    }

    private var cornerRadius: CGFloat {
        compact ? 6 : 7
    }

    private var topControlCornerRadius: CGFloat {
        compact ? 10 : 11
    }

    private var keyLabelYOffset: CGFloat {
        compact ? -0.6 : -1.0
    }

    private var sideKeyWidth: CGFloat {
        compact ? 44 : 50
    }

    private var modeKeyWidth: CGFloat {
        compact ? 56 : 64
    }

    private var globeKeyWidth: CGFloat {
        compact ? 40 : 46
    }

    private var emojiToggleKeyWidth: CGFloat {
        compact ? 40 : 46
    }

    private var returnKeyWidth: CGFloat {
        compact ? 84 : 96
    }

    private var topControlHeight: CGFloat {
        compact ? 36 : 44
    }

    private var middleRowEdgeHitWidth: CGFloat {
        compact ? 24 : 28
    }

    private var emojiCellSize: CGFloat {
        compact ? 29 : 34
    }

    private var emojiGridRows: [GridItem] {
        [
            GridItem(.fixed(emojiCellSize), spacing: keyRowSpacing),
            GridItem(.fixed(emojiCellSize), spacing: keyRowSpacing),
            GridItem(.fixed(emojiCellSize), spacing: keyRowSpacing),
            GridItem(.fixed(emojiCellSize), spacing: keyRowSpacing)
        ]
    }

    private var emojiGridHeight: CGFloat {
        emojiCellSize * 4 + keyRowSpacing * 3
    }

    private var categoryBarHeight: CGFloat {
        compact ? 24 : 26
    }

    private var emojiCategories: [EmojiCategory] {
        EmojiCategory.allCases
    }

    private var emojisByCategory: [EmojiCategory: [String]] {
        [
            .smileys: ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "🥲", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🥸", "🤩", "🥳", "😏", "😒", "😔", "😕", "🙁", "☹️", "😣", "😖", "😫", "😩", "🥺", "😭", "😤", "😠", "😡", "🤯", "😳", "🥵", "🥶", "😱", "😰", "😥", "😓", "🤗", "🫠", "🫣", "🫡"],
            .people: ["👍", "👎", "👏", "🙌", "🤝", "🙏", "👋", "🤙", "👌", "✌️", "🤞", "🤟", "🤘", "🫶", "👊", "🤛", "🤜", "🫱", "🫲", "🖐️", "✋", "🫸", "🫷", "🤌", "☝️", "👇", "👈", "👉", "✍️", "💪", "🧑", "👩", "👨", "🧒", "👶", "🧔", "👩‍⚕️", "👨‍💻", "🧑‍🎓", "👮", "🕵️", "👷", "👩‍🍳", "👨‍🚀", "💃", "🕺", "🧘", "🏃", "🚶", "🧍"],
            .animals: ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🦆", "🦅", "🦉", "🦇", "🐺", "🦄", "🐝", "🪲", "🐞", "🦋", "🐢", "🐍", "🦎", "🐙", "🦑", "🐬", "🐳", "🦈", "🐊", "🦌", "🐘", "🦒", "🦘", "🌵", "🌴", "🌲", "🌸", "🌼", "🌻"],
            .food: ["🍎", "🍏", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍒", "🥭", "🍍", "🥥", "🥑", "🥕", "🌽", "🥦", "🧄", "🧅", "🥔", "🍅", "🍞", "🥐", "🥨", "🧀", "🥚", "🥞", "🧇", "🥓", "🍗", "🍖", "🌭", "🍔", "🍟", "🍕", "🌮", "🌯", "🥙", "🍜", "🍝", "🍣", "🍛", "🍤", "🍩", "🍪", "🍫", "🍿", "☕️", "🍵", "🥤", "🧋", "🍺", "🍷"],
            .activities: ["⚽️", "🏀", "🏈", "⚾️", "🎾", "🏐", "🏉", "🥏", "🎱", "🏓", "🏸", "🥊", "🥋", "🥅", "⛳️", "🎣", "🤿", "🛹", "🛼", "🚴", "🏃", "🏋️", "🤸", "🧘", "🎯", "🎮", "🕹️", "🎲", "🧩", "♟️", "🎹", "🥁", "🎸", "🎺", "🎻", "🎤", "🎧", "🎬", "🎨", "🧵", "📚", "🧪", "🧘‍♀️", "🏆"],
            .travel: ["🚗", "🚕", "🚌", "🚎", "🚓", "🚑", "🚒", "🚐", "🚚", "🚜", "🏎️", "🚂", "🚆", "🚇", "🚊", "✈️", "🛫", "🛬", "🚁", "🛥️", "🚤", "⛵️", "🚢", "🛴", "🚲", "🛼", "🛹", "🛻", "⛽️", "🗺️", "🧭", "🏠", "🏡", "🏢", "🏨", "🏝️", "🏖️", "🏔️", "🌋", "🗽", "🌉", "🌃", "🌆", "🌌", "🛣️", "🛤️"],
            .objects: ["💡", "🔦", "🕯️", "📱", "💻", "⌚️", "📷", "🎥", "🎧", "⌨️", "🖱️", "🖨️", "📦", "🔋", "🔌", "🧲", "🧪", "🧬", "🧠", "🔭", "🪐", "🛠️", "🔧", "🔨", "⚙️", "🪛", "🔩", "🔐", "🧯", "🧰", "🧸", "🎁", "🛒", "💰", "📎", "📌", "📖", "📚", "📝", "✂️", "🔑", "🚪", "🪑", "🛏️", "🧼", "🪥"],
            .symbols: ["❤️", "🩷", "🧡", "💛", "💚", "🩵", "💙", "💜", "🤍", "🖤", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "❤️‍🔥", "❤️‍🩹", "💟", "💌", "☮️", "✝️", "☪️", "☸️", "✡️", "🔯", "🕉️", "☯️", "☦️", "🛐", "⛎", "♈️", "♉️", "♊️", "♋️", "♌️", "♍️", "♎️", "♏️", "♐️", "♑️", "♒️", "♓️", "🆘", "✅", "❌", "⚠️", "🚫", "♻️", "™️"],
            .flags: ["🏳️", "🏴", "🏁", "🚩", "🏳️‍🌈", "🏳️‍⚧️", "🇺🇸", "🇨🇦", "🇲🇽", "🇧🇷", "🇦🇷", "🇬🇧", "🇮🇪", "🇫🇷", "🇩🇪", "🇮🇹", "🇪🇸", "🇵🇹", "🇳🇱", "🇸🇪", "🇳🇴", "🇫🇮", "🇩🇰", "🇵🇱", "🇺🇦", "🇹🇷", "🇸🇦", "🇦🇪", "🇮🇳", "🇵🇰", "🇧🇩", "🇨🇳", "🇯🇵", "🇰🇷", "🇹🇭", "🇻🇳", "🇦🇺", "🇳🇿", "🇿🇦", "🇪🇬", "🇳🇬", "🇰🇪"]
        ]
    }

    private var displayedEmojis: [String] {
        if selectedEmojiCategory == .all {
            var ordered: [String] = []
            var seen = Set<String>()
            for category in emojiCategories where category != .all {
                for emoji in emojisByCategory[category] ?? [] where !seen.contains(emoji) {
                    seen.insert(emoji)
                    ordered.append(emoji)
                }
            }
            return ordered
        }
        return emojisByCategory[selectedEmojiCategory] ?? []
    }

    var body: some View {
        VStack(spacing: keyRowSpacing) {
            if service.state == .recording || page != .emoji {
                topControls
            }

            switch page {
            case .letters:
                lettersPage
            case .numbers:
                numbersPage
            case .symbols:
                symbolsPage
            case .emoji:
                emojiPage
            }
        }
        .padding(.horizontal, compact ? 6 : 8)
        .padding(.top, compact ? 3 : 4)
        .padding(.bottom, 0)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .ignoresSafeArea(.container, edges: .bottom)
    }

    @ViewBuilder
    private var topControls: some View {
        if service.state == .recording {
            recordingTopControls
        } else {
            idleTopControls
        }
    }

    private var idleTopControls: some View {
        HStack(spacing: keyHorizontalSpacing) {
            Button {
                service.setBackgroundModeEnabled(!service.backgroundModeEnabled)
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: service.backgroundModeEnabled ? "waveform.and.mic" : "mic.slash")
                        .font(.system(size: compact ? 11 : 12, weight: .semibold))
                    Text(service.backgroundModeEnabled ? "BG Mic On" : "BG Mic Off")
                        .font(.system(size: compact ? 11 : 12, weight: .semibold))
                        .lineLimit(1)
                }
                .foregroundColor(KeyboardPalette.text)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .buttonStyle(TopControlButtonStyle(fill: KeyboardPalette.mode, cornerRadius: topControlCornerRadius))
            .frame(width: compact ? 104 : 118)
            .frame(height: topControlHeight)

            Button {
                cycleKeyboardMode()
            } label: {
                Text("Modes")
                    .font(.system(size: compact ? 11 : 12, weight: .semibold))
                    .foregroundColor(KeyboardPalette.secondaryText)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .buttonStyle(TopControlButtonStyle(fill: KeyboardPalette.mode, cornerRadius: topControlCornerRadius))
            .frame(width: compact ? 64 : 74)
            .frame(height: topControlHeight)

            Button {
                handleSpeakTap()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "mic.fill")
                        .font(.system(size: compact ? 11 : 12, weight: .semibold))
                    Text("Speak")
                        .font(.system(size: compact ? 19 : 20, weight: .semibold))
                        .lineLimit(1)
                }
                .foregroundColor(KeyboardPalette.text)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .disabled(service.state == .processing)
            .buttonStyle(TopControlButtonStyle(fill: KeyboardPalette.key, cornerRadius: topControlCornerRadius))
            .frame(height: topControlHeight)
            .opacity(service.state == .processing ? 0.55 : 1.0)
        }
        .frame(height: topControlHeight)
    }

    private var recordingTopControls: some View {
        HStack(spacing: keyHorizontalSpacing) {
            Button {
                service.cancelRecording()
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "xmark")
                        .font(.system(size: compact ? 12 : 13, weight: .bold))
                    Text("Cancel")
                        .font(.system(size: compact ? 12 : 13, weight: .semibold))
                }
                .foregroundColor(KeyboardPalette.text)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .buttonStyle(TopControlButtonStyle(fill: KeyboardPalette.mode, cornerRadius: topControlCornerRadius))
            .frame(width: compact ? 86 : 98)
            .frame(height: topControlHeight)

            ZStack {
                Capsule(style: .continuous)
                    .fill(KeyboardPalette.mode)
                    .overlay(
                        Capsule(style: .continuous)
                            .stroke(KeyboardPalette.keyStroke, lineWidth: 1)
                    )

                RecordingWaveform(level: service.audioLevel, active: true, compact: compact)
                    .padding(.horizontal, compact ? 10 : 14)
            }
            .frame(height: topControlHeight)

            Button {
                service.stopRecording()
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "stop.fill")
                        .font(.system(size: compact ? 11 : 12, weight: .bold))
                    Text("Stop")
                        .font(.system(size: compact ? 12 : 13, weight: .semibold))
                }
                .foregroundColor(KeyboardPalette.text)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .buttonStyle(TopControlButtonStyle(fill: KeyboardPalette.recording, cornerRadius: topControlCornerRadius))
            .frame(width: compact ? 78 : 90)
            .frame(height: topControlHeight)
        }
        .frame(height: topControlHeight)
    }

    private var lettersPage: some View {
        VStack(spacing: keyRowSpacing) {
            characterRow(["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"])
            middleLetterRow(["a", "s", "d", "f", "g", "h", "j", "k", "l"], edgeHitWidth: middleRowEdgeHitWidth)

            HStack(spacing: keyHorizontalSpacing) {
                functionKey(width: sideKeyWidth, fill: KeyboardPalette.functionKey, action: handleShiftTap) {
                    Image(systemName: shiftIconName)
                        .font(.system(size: compact ? 16 : 18, weight: .semibold))
                        .foregroundColor(KeyboardPalette.text)
                }

                characterClusterRow(["z", "x", "c", "v", "b", "n", "m"])

                functionKey(width: sideKeyWidth, fill: KeyboardPalette.functionKey, action: onBackspace) {
                    Image(systemName: "delete.left")
                        .font(.system(size: compact ? 16 : 18, weight: .semibold))
                        .foregroundColor(KeyboardPalette.text)
                }
            }

            bottomRow(modeTitle: "123", modeAction: {
                page = .numbers
                shiftState = .lower
            })
        }
    }

    private var numbersPage: some View {
        VStack(spacing: keyRowSpacing) {
            characterRow(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"])
            characterRow(["-", "/", ":", ";", "(", ")", "$", "&", "@", "\""])

            HStack(spacing: keyHorizontalSpacing) {
                functionKey(width: modeKeyWidth, fill: KeyboardPalette.actionKey, action: {
                    page = .symbols
                }) {
                    Text("#+=")
                        .font(.system(size: compact ? 17 : 18, weight: .semibold))
                        .foregroundColor(KeyboardPalette.text)
                        .offset(y: keyLabelYOffset)
                }

                inputClusterRow([".", ",", "?", "!", "'"], fontSize: compact ? 20 : 22) { key in
                    onInsertText(key)
                }

                functionKey(width: sideKeyWidth, fill: KeyboardPalette.functionKey, action: onBackspace) {
                    Image(systemName: "delete.left")
                        .font(.system(size: compact ? 16 : 18, weight: .semibold))
                        .foregroundColor(KeyboardPalette.text)
                }
            }

            bottomRow(modeTitle: "ABC", modeAction: {
                page = .letters
                shiftState = .lower
            })
        }
    }

    private var symbolsPage: some View {
        VStack(spacing: keyRowSpacing) {
            characterRow(["[", "]", "{", "}", "#", "%", "^", "*", "+", "="])
            characterRow(["_", "\\", "|", "~", "<", ">", "€", "£", "¥", "•"])

            HStack(spacing: keyHorizontalSpacing) {
                functionKey(width: modeKeyWidth, fill: KeyboardPalette.actionKey, action: {
                    page = .numbers
                }) {
                    Text("123")
                        .font(.system(size: compact ? 17 : 18, weight: .semibold))
                        .foregroundColor(KeyboardPalette.text)
                        .offset(y: keyLabelYOffset)
                }

                inputClusterRow([".", ",", "?", "!", "'"], fontSize: compact ? 20 : 22) { key in
                    onInsertText(key)
                }

                functionKey(width: sideKeyWidth, fill: KeyboardPalette.functionKey, action: onBackspace) {
                    Image(systemName: "delete.left")
                        .font(.system(size: compact ? 16 : 18, weight: .semibold))
                        .foregroundColor(KeyboardPalette.text)
                }
            }

            bottomRow(modeTitle: "ABC", modeAction: {
                page = .letters
                shiftState = .lower
            })
        }
    }

    private var emojiPage: some View {
        VStack(spacing: keyRowSpacing) {
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHGrid(rows: emojiGridRows, spacing: keyHorizontalSpacing) {
                    ForEach(displayedEmojis, id: \.self) { emoji in
                        emojiKey(emoji)
                    }
                }
                .padding(.horizontal, 1)
            }
            .frame(height: emojiGridHeight)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: keyHorizontalSpacing) {
                    ForEach(emojiCategories) { category in
                        Button {
                            selectedEmojiCategory = category
                        } label: {
                            HStack(spacing: compact ? 4 : 5) {
                                Image(systemName: category.symbolName)
                                    .font(.system(size: compact ? 11 : 12, weight: .regular))
                                    .symbolRenderingMode(.monochrome)

                                Text(category.menuTitle)
                                    .font(.system(size: compact ? 10 : 11, weight: .medium))
                                    .lineLimit(1)
                            }
                            .foregroundColor(KeyboardPalette.text)
                            .padding(.horizontal, compact ? 8 : 10)
                            .frame(height: categoryBarHeight - (compact ? 4 : 6))
                            .background(
                                Capsule(style: .continuous)
                                    .fill(selectedEmojiCategory == category ? KeyboardPalette.mode : Color.clear)
                                    .overlay(
                                        Capsule(style: .continuous)
                                            .stroke(
                                                selectedEmojiCategory == category
                                                ? KeyboardPalette.keyStroke
                                                : KeyboardPalette.keyStroke.opacity(0.45),
                                                lineWidth: 0.8
                                            )
                                    )
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 1)
            }
            .frame(height: categoryBarHeight)

            bottomRow(modeTitle: "ABC", modeAction: {
                page = .letters
                shiftState = .lower
            })
        }
    }

    private func characterRow(_ keys: [String]) -> some View {
        ZStack {
            rowGapFallbackLayer(for: keys)

            HStack(spacing: keyHorizontalSpacing) {
                ForEach(keys, id: \.self) { key in
                    characterKey(key)
                }
            }
        }
        .frame(height: keyHeight)
    }

    private func middleLetterRow(_ keys: [String], edgeHitWidth: CGFloat) -> some View {
        ZStack {
            rowGapFallbackLayer(for: keys, horizontalInset: edgeHitWidth)

            HStack(spacing: keyHorizontalSpacing) {
                ForEach(keys, id: \.self) { key in
                    characterKey(key)
                }
            }
            .padding(.horizontal, edgeHitWidth)
        }
        .frame(height: keyHeight)
    }

    private func characterClusterRow(_ keys: [String]) -> some View {
        ZStack {
            rowGapFallbackLayer(for: keys)

            HStack(spacing: keyHorizontalSpacing) {
                ForEach(keys, id: \.self) { key in
                    characterKey(key)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: keyHeight)
    }

    private func inputClusterRow(
        _ keys: [String],
        fontSize: CGFloat,
        action: @escaping (String) -> Void
    ) -> some View {
        ZStack {
            GeometryReader { proxy in
                Color.clear
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onEnded { value in
                                insertNearestInput(
                                    from: keys,
                                    atX: value.location.x,
                                    totalWidth: proxy.size.width,
                                    action: action
                                )
                            }
                    )
            }

            HStack(spacing: keyHorizontalSpacing) {
                ForEach(keys, id: \.self) { key in
                    characterInputKey(
                        label: key,
                        action: { action(key) },
                        fontSize: fontSize
                    )
                }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: keyHeight)
    }

    private func rowGapFallbackLayer(for keys: [String], horizontalInset: CGFloat = 0) -> some View {
        GeometryReader { proxy in
            Color.clear
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onEnded { value in
                            insertNearestCharacter(
                                from: keys,
                                atX: value.location.x,
                                totalWidth: proxy.size.width,
                                horizontalInset: horizontalInset
                            )
                        }
                )
        }
    }

    private func insertNearestCharacter(
        from keys: [String],
        atX x: CGFloat,
        totalWidth: CGFloat,
        horizontalInset: CGFloat
    ) {
        guard !keys.isEmpty else { return }

        let usableWidth = max(1, totalWidth - (horizontalInset * 2))
        let availableX = x - horizontalInset
        let clampedX = min(max(availableX, 0), usableWidth)
        let keyCount = CGFloat(keys.count)
        let totalSpacing = keyHorizontalSpacing * CGFloat(max(keys.count - 1, 0))
        let keyWidth = (usableWidth - totalSpacing) / keyCount
        guard keyWidth > 0 else { return }

        let pitch = keyWidth + keyHorizontalSpacing
        let rawIndex = Int(round((clampedX - (keyWidth / 2)) / pitch))
        let index = min(max(rawIndex, 0), keys.count - 1)
        insertCharacter(keys[index])
    }

    private func insertNearestInput(
        from keys: [String],
        atX x: CGFloat,
        totalWidth: CGFloat,
        action: (String) -> Void
    ) {
        guard !keys.isEmpty else { return }

        let usableWidth = max(1, totalWidth)
        let clampedX = min(max(x, 0), usableWidth)
        let keyCount = CGFloat(keys.count)
        let totalSpacing = keyHorizontalSpacing * CGFloat(max(keys.count - 1, 0))
        let keyWidth = (usableWidth - totalSpacing) / keyCount
        guard keyWidth > 0 else { return }

        let pitch = keyWidth + keyHorizontalSpacing
        let rawIndex = Int(round((clampedX - (keyWidth / 2)) / pitch))
        let index = min(max(rawIndex, 0), keys.count - 1)
        action(keys[index])
    }

    private func characterKey(_ rawValue: String) -> some View {
        characterInputKey(
            label: displayedCharacter(for: rawValue),
            action: { insertCharacter(rawValue) },
            fontSize: compact ? 25 : 27
        )
    }

    private func characterInputKey(
        label: String,
        action: @escaping () -> Void,
        fontSize: CGFloat
    ) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: fontSize, weight: .regular))
                .minimumScaleFactor(0.8)
                .foregroundColor(KeyboardPalette.text)
                .offset(y: keyLabelYOffset)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        }
        .buttonStyle(
            CharacterKeyButtonStyle(
                fill: KeyboardPalette.key,
                cornerRadius: cornerRadius,
                previewText: label,
                compact: compact
            )
        )
        .frame(maxWidth: .infinity)
        .frame(height: keyHeight)
    }

    private func emojiKey(_ emoji: String) -> some View {
        Button {
            onInsertText(emoji)
        } label: {
            Text(emoji)
                .font(.system(size: compact ? 28 : 31))
                .frame(width: emojiCellSize, height: emojiCellSize)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                .contentShape(Rectangle())
        }
        .buttonStyle(EmojiGlyphButtonStyle())
        .frame(width: emojiCellSize, height: emojiCellSize)
    }

    private func bottomRow(modeTitle: String, modeAction: @escaping () -> Void) -> some View {
        HStack(spacing: keyHorizontalSpacing) {
            functionKey(width: modeKeyWidth, fill: KeyboardPalette.actionKey, action: modeAction) {
                Text(modeTitle)
                    .font(.system(size: compact ? 16 : 17, weight: .regular))
                    .foregroundColor(KeyboardPalette.text)
                    .offset(y: keyLabelYOffset)
            }

            functionKey(
                width: emojiToggleKeyWidth,
                fill: page == .emoji ? KeyboardPalette.functionKey : KeyboardPalette.actionKey,
                action: {
                    if page == .emoji {
                        page = .letters
                        shiftState = .lower
                    } else {
                        page = .emoji
                    }
                }
            ) {
                Image(systemName: "face.smiling")
                    .font(.system(size: compact ? 17 : 19, weight: .regular))
                    .symbolRenderingMode(.monochrome)
                    .foregroundColor(KeyboardPalette.text)
            }

            keyButton(fill: KeyboardPalette.key, action: {
                onInsertText(" ")
            }) {
                Text("space")
                    .font(.system(size: compact ? 19 : 21, weight: .regular))
                    .foregroundColor(KeyboardPalette.text)
                    .offset(y: keyLabelYOffset)
            }

            functionKey(width: returnKeyWidth, fill: KeyboardPalette.actionKey, action: onReturn) {
                Text(context.returnKeyTitle)
                    .font(.system(size: compact ? 16 : 18, weight: .regular))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .foregroundColor(KeyboardPalette.text)
                    .offset(y: keyLabelYOffset)
            }

            if context.needsInputModeSwitchKey {
                functionKey(width: globeKeyWidth, fill: KeyboardPalette.functionKey, action: onNextKeyboard) {
                    Image(systemName: "globe")
                        .font(.system(size: compact ? 16 : 18, weight: .regular))
                        .foregroundColor(KeyboardPalette.text)
                }
            }
        }
    }

    private func functionKey<Content: View>(
        width: CGFloat,
        fill: Color,
        action: @escaping () -> Void,
        @ViewBuilder content: () -> Content
    ) -> some View {
        keyButton(width: width, fill: fill, action: action) {
            content()
        }
    }

    private func keyButton<Content: View>(
        width: CGFloat? = nil,
        fill: Color,
        action: @escaping () -> Void,
        @ViewBuilder content: () -> Content
    ) -> some View {
        Button(action: action) {
            content()
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        }
        .buttonStyle(OverlayKeyButtonStyle(fill: fill, cornerRadius: cornerRadius))
        .frame(width: width)
        .frame(maxWidth: width == nil ? .infinity : nil)
        .frame(height: keyHeight)
    }

    private var shiftIconName: String {
        switch shiftState {
        case .lower:
            return "shift"
        case .upper:
            return "shift.fill"
        case .caps:
            return "capslock.fill"
        }
    }

    private func handleShiftTap() {
        let now = Date()
        let tappedTwice = now.timeIntervalSince(lastShiftTapTime) < 0.35

        switch shiftState {
        case .lower:
            if tappedTwice {
                shiftState = .caps
                lastShiftTapTime = .distantPast
            } else {
                shiftState = .upper
                lastShiftTapTime = now
            }
        case .upper:
            if tappedTwice {
                shiftState = .caps
                lastShiftTapTime = .distantPast
            } else {
                shiftState = .lower
                lastShiftTapTime = now
            }
        case .caps:
            shiftState = .lower
            lastShiftTapTime = .distantPast
        }
    }

    private func insertCharacter(_ rawValue: String) {
        if page == .letters {
            let output = shiftState == .lower ? rawValue.lowercased() : rawValue.uppercased()
            onInsertText(output)
            if shiftState == .upper {
                shiftState = .lower
            }
            return
        }

        onInsertText(rawValue)
    }

    private func displayedCharacter(for rawValue: String) -> String {
        guard page == .letters else { return rawValue }
        return shiftState == .lower ? rawValue.lowercased() : rawValue.uppercased()
    }

    private func cycleKeyboardMode() {
        switch page {
        case .letters:
            page = .numbers
        case .numbers:
            page = .symbols
        case .symbols:
            page = .emoji
        case .emoji:
            page = .letters
            shiftState = .lower
        }
    }

    private func handleSpeakTap() {
        switch service.state {
        case .idle:
            service.startRecording()
        case .recording:
            service.stopRecording()
        case .processing:
            break
        case .done, .error:
            service.startRecording()
        }
    }
}

private struct OverlayKeyButtonStyle: ButtonStyle {
    let fill: Color
    let cornerRadius: CGFloat

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(configuration.isPressed ? KeyboardPalette.keyPressed : fill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(KeyboardPalette.keyStroke, lineWidth: 0.8)
            )
            .shadow(color: Color.black.opacity(0.28), radius: 0, x: 0, y: 1)
    }
}

private struct CharacterKeyButtonStyle: ButtonStyle {
    let fill: Color
    let cornerRadius: CGFloat
    let previewText: String
    let compact: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(configuration.isPressed ? KeyboardPalette.keyPressed : fill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(KeyboardPalette.keyStroke, lineWidth: 0.8)
            )
            .shadow(color: Color.black.opacity(0.28), radius: 0, x: 0, y: 1)
            .overlay(alignment: .top) {
                if configuration.isPressed {
                    CharacterPreviewBubble(
                        text: previewText,
                        compact: compact,
                        fill: fill
                    )
                    .allowsHitTesting(false)
                    .offset(y: compact ? -44 : -53)
                    .transition(.identity)
                }
            }
            .transaction { transaction in
                transaction.animation = nil
            }
    }
}

private struct TopControlButtonStyle: ButtonStyle {
    let fill: Color
    let cornerRadius: CGFloat

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(configuration.isPressed ? KeyboardPalette.keyPressed : fill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(KeyboardPalette.keyStroke, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1.0)
    }
}

private struct EmojiGlyphButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                Circle()
                    .fill(configuration.isPressed ? Color.white.opacity(0.12) : Color.clear)
            )
            .scaleEffect(configuration.isPressed ? 0.93 : 1.0)
    }
}

private struct CharacterPreviewBubble: View {
    let text: String
    let compact: Bool
    let fill: Color

    private var bubbleWidth: CGFloat { compact ? 58 : 64 }
    private var bubbleHeight: CGFloat { compact ? 66 : 74 }
    private var bubbleCornerRadius: CGFloat { compact ? 10 : 11 }

    var body: some View {
        ConnectedPreviewBubbleShape(cornerRadius: bubbleCornerRadius)
            .fill(fill)
            .overlay(
                ConnectedPreviewBubbleShape(cornerRadius: bubbleCornerRadius)
                    .stroke(KeyboardPalette.keyStroke, lineWidth: 0.8)
            )
            .frame(width: bubbleWidth, height: bubbleHeight)
            .overlay(
                Text(text)
                    .font(.system(size: compact ? 42 : 48, weight: .regular))
                    .foregroundColor(KeyboardPalette.text)
                    .offset(y: compact ? -9 : -10.5)
            )
        .shadow(color: Color.black.opacity(0.28), radius: 1.2, x: 0, y: 1)
    }
}

private struct ConnectedPreviewBubbleShape: Shape {
    let cornerRadius: CGFloat

    func path(in rect: CGRect) -> Path {
        let width = rect.width
        let height = rect.height
        let topHeight = height * 0.62
        let stemWidth = width * 0.56
        let stemX = (width - stemWidth) / 2
        let stemBottomRadius = min(8, stemWidth * 0.18)
        let shoulder = min(6, (width - stemWidth) * 0.32)
        let radius = min(cornerRadius, topHeight * 0.24)

        var path = Path()

        path.move(to: CGPoint(x: radius, y: 0))
        path.addLine(to: CGPoint(x: width - radius, y: 0))
        path.addQuadCurve(
            to: CGPoint(x: width, y: radius),
            control: CGPoint(x: width, y: 0)
        )
        path.addLine(to: CGPoint(x: width, y: topHeight - radius))
        path.addQuadCurve(
            to: CGPoint(x: width - radius, y: topHeight),
            control: CGPoint(x: width, y: topHeight)
        )

        path.addLine(to: CGPoint(x: stemX + stemWidth + shoulder, y: topHeight))
        path.addQuadCurve(
            to: CGPoint(x: stemX + stemWidth, y: topHeight + shoulder),
            control: CGPoint(x: stemX + stemWidth, y: topHeight)
        )
        path.addLine(to: CGPoint(x: stemX + stemWidth, y: height - stemBottomRadius))
        path.addQuadCurve(
            to: CGPoint(x: stemX + stemWidth - stemBottomRadius, y: height),
            control: CGPoint(x: stemX + stemWidth, y: height)
        )
        path.addLine(to: CGPoint(x: stemX + stemBottomRadius, y: height))
        path.addQuadCurve(
            to: CGPoint(x: stemX, y: height - stemBottomRadius),
            control: CGPoint(x: stemX, y: height)
        )
        path.addLine(to: CGPoint(x: stemX, y: topHeight + shoulder))
        path.addQuadCurve(
            to: CGPoint(x: stemX - shoulder, y: topHeight),
            control: CGPoint(x: stemX, y: topHeight)
        )

        path.addLine(to: CGPoint(x: radius, y: topHeight))
        path.addQuadCurve(
            to: CGPoint(x: 0, y: topHeight - radius),
            control: CGPoint(x: 0, y: topHeight)
        )
        path.addLine(to: CGPoint(x: 0, y: radius))
        path.addQuadCurve(
            to: CGPoint(x: radius, y: 0),
            control: CGPoint(x: 0, y: 0)
        )

        path.closeSubpath()
        return path
    }
}

private struct RecordingWaveform: View {
    let level: Float
    let active: Bool
    let compact: Bool

    private let barCount = 11
    private var normalizedLevel: Double {
        min(max(Double(level), 0), 1)
    }
    private var shouldAnimate: Bool {
        active && normalizedLevel > 0.03
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.06, paused: !shouldAnimate)) { timeline in
            let timestamp = timeline.date.timeIntervalSinceReferenceDate
            HStack(spacing: compact ? 3 : 4) {
                ForEach(0..<barCount, id: \.self) { index in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(KeyboardPalette.text)
                        .frame(width: compact ? 4 : 5, height: barHeight(for: index, timestamp: timestamp))
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func barHeight(for index: Int, timestamp: TimeInterval) -> CGFloat {
        let center = Double(barCount - 1) / 2.0
        let distance = abs(Double(index) - center) / center
        let falloff = max(0.2, 1.0 - distance * 0.8)
        let idleHeight: CGFloat = compact ? 9 : 12
        let maxHeight: CGFloat = compact ? 26 : 32
        let baseHeight = idleHeight + (maxHeight - idleHeight) * CGFloat(0.16) * CGFloat(falloff)

        guard shouldAnimate else {
            return baseHeight
        }

        let wave = sin(timestamp * 8 + Double(index) * 0.8) * 0.5 + 0.5
        let energy = normalizedLevel * 0.75 + wave * 0.25
        return idleHeight + (maxHeight - idleHeight) * CGFloat(energy) * CGFloat(falloff)
    }
}

private struct NoAccessView: View {
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "lock.fill")
                .font(.system(size: 20, weight: .medium))
                .foregroundColor(KeyboardPalette.secondaryText)

            Text("Full Access Required")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(KeyboardPalette.text)

            Text("Settings -> General -> Keyboard -> Overlay -> Allow Full Access")
                .font(.system(size: 11, weight: .regular))
                .foregroundColor(KeyboardPalette.secondaryText)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
        }
    }
}
