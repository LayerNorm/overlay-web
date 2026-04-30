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
    case all, smileys, people, animals, food, activities, travel, objects, symbols, flags
    var id: String { rawValue }

    var symbolName: String {
        switch self {
        case .all:        return "square.grid.2x2"
        case .smileys:    return "face.smiling"
        case .people:     return "person.2"
        case .animals:    return "pawprint"
        case .food:       return "fork.knife"
        case .activities: return "gamecontroller"
        case .travel:     return "car"
        case .objects:    return "lightbulb"
        case .symbols:    return "number"
        case .flags:      return "flag"
        }
    }

    var menuTitle: String {
        switch self {
        case .all:        return "All"
        case .smileys:    return "Smileys"
        case .people:     return "People"
        case .animals:    return "Animals"
        case .food:       return "Food"
        case .activities: return "Activity"
        case .travel:     return "Travel"
        case .objects:    return "Objects"
        case .symbols:    return "Symbols"
        case .flags:      return "Flags"
        }
    }
}

// Matches native iOS dark keyboard colours
private enum KP {
    static let key          = Color(white: 0.267)      // letter/char keys
    static let keyPressed   = Color(white: 0.360)
    static let fnKey        = Color(white: 0.178)      // function / mode keys
    static let stroke       = Color.black.opacity(0.30)
    static let text         = Color(white: 0.98)
    static let secondary    = Color(white: 0.70)
    static let recording    = Color(red: 0.96, green: 0.29, blue: 0.27)
    static let processingBg = Color(white: 0.178)
}

struct KeyboardView: View {
    let hasFullAccess: Bool
    @ObservedObject var transcriptionService: TranscriptionService
    @ObservedObject var context: KeyboardContext
    let onInsertText: (String) -> Void
    let onBackspace: () -> Void
    let onReturn: () -> Void
    let onNextKeyboard: () -> Void

    var body: some View {
        ZStack {
            Color.clear.ignoresSafeArea()
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

    // Whether we're in the recording / processing overlay
    private var isShowingRecordingOverlay: Bool {
        service.state == .recording || service.state == .processing
    }

    private var compact: Bool { verticalSizeClass == .compact }

    private var keyHeight: CGFloat  { compact ? 36 : 44 }
    private var keySpacingH: CGFloat { compact ? 5 : 6 }
    private var keySpacingV: CGFloat { compact ? 7 : 8 }
    private var radius: CGFloat     { compact ? 6 : 6 }
    private var topRadius: CGFloat  { compact ? 10 : 10 }
    private var labelOffsetY: CGFloat { compact ? -0.5 : -0.8 }
    private var sideKeyW: CGFloat   { compact ? 44 : 50 }
    private var modeKeyW: CGFloat   { compact ? 54 : 62 }
    private var globeKeyW: CGFloat  { compact ? 40 : 46 }
    private var returnKeyW: CGFloat { compact ? 82 : 94 }
    private var micKeyW: CGFloat    { compact ? 40 : 46 }
    private var accessoryH: CGFloat { compact ? 26 : 30 }
    private var accessorySpacing: CGFloat { compact ? 4 : 5 }
    private var horizPad: CGFloat   { compact ? 6 : 8 }
    private var topPad: CGFloat     { compact ? 4 : 5 }

    // Extended row height (includes half of spacing above + below) for better touch targets
    private var rowTouchHeight: CGFloat { keyHeight + keySpacingV }

    private var emojiCellSize: CGFloat  { compact ? 29 : 34 }
    private var emojiGridHeight: CGFloat { emojiCellSize * 4 + keySpacingV * 3 }
    private var categoryBarH: CGFloat   { compact ? 24 : 26 }

    private var emojisByCategory: [EmojiCategory: [String]] {[
        .smileys:    ["😀","😃","😄","😁","😆","😅","😂","🤣","🥲","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🥸","🤩","🥳","😏","😒","😔","😕","🙁","☹️","😣","😖","😫","😩","🥺","😭","😤","😠","😡","🤯","😳","🥵","🥶","😱","😰","😥","😓","🤗","🫠","🫣","🫡"],
        .people:     ["👍","👎","👏","🙌","🤝","🙏","👋","🤙","👌","✌️","🤞","🤟","🤘","🫶","👊","🤛","🤜","🫱","🫲","🖐️","✋","🫸","🫷","🤌","☝️","👇","👈","👉","✍️","💪","🧑","👩","👨","🧒","👶","🧔","👩‍⚕️","👨‍💻","🧑‍🎓","👮","🕵️","👷","👩‍🍳","👨‍🚀","💃","🕺","🧘","🏃","🚶","🧍"],
        .animals:    ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🐔","🐧","🦆","🦅","🦉","🦇","🐺","🦄","🐝","🪲","🐞","🦋","🐢","🐍","🦎","🐙","🦑","🐬","🐳","🦈","🐊","🦌","🐘","🦒","🦘","🌵","🌴","🌲","🌸","🌼","🌻"],
        .food:       ["🍎","🍏","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍒","🥭","🍍","🥥","🥑","🥕","🌽","🥦","🧄","🧅","🥔","🍅","🍞","🥐","🥨","🧀","🥚","🥞","🧇","🥓","🍗","🍖","🌭","🍔","🍟","🍕","🌮","🌯","🥙","🍜","🍝","🍣","🍛","🍤","🍩","🍪","🍫","🍿","☕️","🍵","🥤","🧋","🍺","🍷"],
        .activities: ["⚽️","🏀","🏈","⚾️","🎾","🏐","🏉","🥏","🎱","🏓","🏸","🥊","🥋","🥅","⛳️","🎣","🤿","🛹","🛼","🚴","🏃","🏋️","🤸","🧘","🎯","🎮","🕹️","🎲","🧩","♟️","🎹","🥁","🎸","🎺","🎻","🎤","🎧","🎬","🎨","🧵","📚","🧪","🧘‍♀️","🏆"],
        .travel:     ["🚗","🚕","🚌","🚎","🚓","🚑","🚒","🚐","🚚","🚜","🏎️","🚂","🚆","🚇","🚊","✈️","🛫","🛬","🚁","🛥️","🚤","⛵️","🚢","🛴","🚲","🛼","🛹","🛻","⛽️","🗺️","🧭","🏠","🏡","🏢","🏨","🏝️","🏖️","🏔️","🌋","🗽","🌉","🌃","🌆","🌌","🛣️","🛤️"],
        .objects:    ["💡","🔦","🕯️","📱","💻","⌚️","📷","🎥","🎧","⌨️","🖱️","🖨️","📦","🔋","🔌","🧲","🧪","🧬","🧠","🔭","🪐","🛠️","🔧","🔨","⚙️","🪛","🔩","🔐","🧯","🧰","🧸","🎁","🛒","💰","📎","📌","📖","📚","📝","✂️","🔑","🚪","🪑","🛏️","🧼","🪥"],
        .symbols:    ["❤️","🩷","🧡","💛","💚","🩵","💙","💜","🤍","🖤","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","❤️‍🔥","❤️‍🩹","💟","💌","☮️","✝️","☪️","☸️","✡️","🔯","🕉️","☯️","☦️","🛐","⛎","♈️","♉️","♊️","♋️","♌️","♍️","♎️","♏️","♐️","♑️","♒️","♓️","🆘","✅","❌","⚠️","🚫","♻️","™️"],
        .flags:      ["🏳️","🏴","🏁","🚩","🏳️‍🌈","🏳️‍⚧️","🇺🇸","🇨🇦","🇲🇽","🇧🇷","🇦🇷","🇬🇧","🇮🇪","🇫🇷","🇩🇪","🇮🇹","🇪🇸","🇵🇹","🇳🇱","🇸🇪","🇳🇴","🇫🇮","🇩🇰","🇵🇱","🇺🇦","🇹🇷","🇸🇦","🇦🇪","🇮🇳","🇵🇰","🇧🇩","🇨🇳","🇯🇵","🇰🇷","🇹🇭","🇻🇳","🇦🇺","🇳🇿","🇿🇦","🇪🇬","🇳🇬","🇰🇪"]
    ]}

    private var displayedEmojis: [String] {
        if selectedEmojiCategory == .all {
            var ordered: [String] = []
            var seen = Set<String>()
            for cat in EmojiCategory.allCases where cat != .all {
                for e in emojisByCategory[cat] ?? [] where !seen.contains(e) {
                    seen.insert(e); ordered.append(e)
                }
            }
            return ordered
        }
        return emojisByCategory[selectedEmojiCategory] ?? []
    }

    var body: some View {
        ZStack {
            // Recording / processing full-screen overlay
            if isShowingRecordingOverlay {
                recordingOverlay
                    .transition(.opacity.animation(.easeInOut(duration: 0.18)))
            } else {
                keyboardContent
                    .transition(.opacity.animation(.easeInOut(duration: 0.18)))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .ignoresSafeArea(.container, edges: .bottom)
    }

    // MARK: — Recording overlay (replaces keyboard while mic is active)

    private var recordingOverlay: some View {
        VStack(spacing: 0) {
            Spacer()

            // Waveform / processing area
            VStack(spacing: compact ? 12 : 16) {
                if service.state == .processing {
                    processingIndicator
                } else {
                    micWaveformArea
                }
            }
            .frame(maxWidth: .infinity)

            Spacer()

            // Cancel / Stop action row
            HStack(spacing: 0) {
                Button {
                    service.cancelRecording()
                } label: {
                    Text("Cancel")
                        .font(.system(size: compact ? 15 : 16, weight: .regular))
                        .foregroundColor(KP.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .buttonStyle(.plain)

                Rectangle()
                    .fill(KP.secondary.opacity(0.25))
                    .frame(width: 0.5)
                    .padding(.vertical, 10)

                Button {
                    service.stopRecording()
                } label: {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(KP.recording)
                            .frame(width: compact ? 10 : 12, height: compact ? 10 : 12)
                        Text("Done")
                            .font(.system(size: compact ? 15 : 16, weight: .semibold))
                            .foregroundColor(KP.text)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .buttonStyle(.plain)
            }
            .frame(height: compact ? 40 : 48)
            .background(KP.fnKey)
            .clipShape(RoundedRectangle(cornerRadius: topRadius, style: .continuous))
            .padding(.horizontal, horizPad)
            .padding(.bottom, compact ? 6 : 8)
        }
        .padding(.horizontal, horizPad)
        .padding(.top, topPad)
    }

    private var micWaveformArea: some View {
        VStack(spacing: compact ? 10 : 14) {
            ZStack {
                Circle()
                    .fill(KP.recording.opacity(0.15))
                    .frame(width: compact ? 52 : 62, height: compact ? 52 : 62)
                Circle()
                    .fill(KP.recording)
                    .frame(width: compact ? 36 : 44, height: compact ? 36 : 44)
                Image(systemName: "mic.fill")
                    .font(.system(size: compact ? 17 : 20, weight: .medium))
                    .foregroundColor(.white)
            }

            RecordingWaveform(level: service.audioLevel, active: true, compact: compact)
                .frame(height: compact ? 24 : 30)
                .frame(maxWidth: 160)

            Text("Listening…")
                .font(.system(size: compact ? 12 : 13, weight: .regular))
                .foregroundColor(KP.secondary)
        }
    }

    private var processingIndicator: some View {
        VStack(spacing: compact ? 10 : 14) {
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: KP.secondary))
                .scaleEffect(compact ? 1.0 : 1.2)
            Text("Processing…")
                .font(.system(size: compact ? 12 : 13, weight: .regular))
                .foregroundColor(KP.secondary)
        }
    }

    // MARK: — Normal keyboard content

    private var micCircleSize: CGFloat { compact ? 30 : 36 }

    private var keyboardContent: some View {
        ZStack(alignment: .topTrailing) {
            // Full keyboard layout at original height — spacing: 0 so rowTouchHeight
            // covers the inter-row gaps and every tap reaches the nearest key
            VStack(spacing: 0) {
                VStack(spacing: 0) {
                    switch page {
                    case .letters:  lettersPage
                    case .numbers:  numbersPage
                    case .symbols:  symbolsPage
                    case .emoji:    emojiPage
                    }
                }
                .padding(.horizontal, horizPad)
                .padding(.top, topPad)

                if context.needsInputModeSwitchKey {
                    accessoryRow
                        .padding(.horizontal, horizPad)
                        .padding(.top, accessorySpacing)
                }
            }

            // Floating mic button — overlaid at top-right, no height cost
            Button(action: handleMicTap) {
                ZStack {
                    Circle()
                        .fill(service.backgroundModeEnabled ? KP.recording.opacity(0.18) : KP.fnKey)
                    Image(systemName: bgMicIconName)
                        .font(.system(size: compact ? 13 : 15, weight: .medium))
                        .foregroundColor(service.backgroundModeEnabled ? KP.recording : KP.text)
                }
                .frame(width: micCircleSize, height: micCircleSize)
            }
            .buttonStyle(.plain)
            .padding(.top, topPad)
            .padding(.trailing, horizPad)
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.5).onEnded { _ in
                    service.setBackgroundModeEnabled(!service.backgroundModeEnabled)
                }
            )
        }
    }

    // MARK: — Accessory row (globe only — mic is now floating)

    private var accessoryRow: some View {
        HStack {
            Button(action: onNextKeyboard) {
                Image(systemName: "globe")
                    .font(.system(size: compact ? 16 : 18, weight: .regular))
                    .foregroundColor(KP.secondary)
            }
            .buttonStyle(.plain)
            .frame(width: compact ? 36 : 44, height: accessoryH)
            .contentShape(Rectangle())

            Spacer()
        }
        .frame(height: accessoryH)
    }

    private var bgMicIconName: String {
        service.backgroundModeEnabled ? "waveform.and.mic" : "mic"
    }

    private func handleMicTap() {
        switch service.state {
        case .idle, .done, .error:
            service.startRecording()
        case .recording:
            service.stopRecording()
        case .processing:
            break
        }
    }

    // MARK: — Letters page

    private var lettersPage: some View {
        VStack(spacing: 0) {
            characterRow(["q","w","e","r","t","y","u","i","o","p"])
            middleLetterRow(["a","s","d","f","g","h","j","k","l"])

            HStack(spacing: keySpacingH) {
                fnKey(width: sideKeyW, fill: KP.fnKey, action: handleShiftTap) {
                    Image(systemName: shiftIconName)
                        .font(.system(size: compact ? 16 : 18, weight: .semibold))
                        .foregroundColor(KP.text)
                }
                characterClusterRow(["z","x","c","v","b","n","m"])
                fnKey(width: sideKeyW, fill: KP.fnKey, action: onBackspace) {
                    Image(systemName: "delete.left")
                        .font(.system(size: compact ? 16 : 18, weight: .semibold))
                        .foregroundColor(KP.text)
                }
            }
            .frame(height: rowTouchHeight)

            bottomRow(modeTitle: "123", modeAction: { page = .numbers; shiftState = .lower })
                .frame(height: rowTouchHeight)
        }
    }

    // MARK: — Numbers page

    private var numbersPage: some View {
        VStack(spacing: 0) {
            characterRow(["1","2","3","4","5","6","7","8","9","0"])
            characterRow(["-","/",":",";","(",")",  "$","&","@","\""])

            HStack(spacing: keySpacingH) {
                fnKey(width: modeKeyW, fill: KP.fnKey, action: { page = .symbols }) {
                    Text("#+=").font(.system(size: compact ? 16 : 17, weight: .semibold))
                        .foregroundColor(KP.text).offset(y: labelOffsetY)
                }
                inputClusterRow([".",",","?","!","'"], fontSize: compact ? 20 : 22) { onInsertText($0) }
                fnKey(width: sideKeyW, fill: KP.fnKey, action: onBackspace) {
                    Image(systemName: "delete.left")
                        .font(.system(size: compact ? 16 : 18, weight: .semibold))
                        .foregroundColor(KP.text)
                }
            }
            .frame(height: rowTouchHeight)

            bottomRow(modeTitle: "ABC", modeAction: { page = .letters; shiftState = .lower })
                .frame(height: rowTouchHeight)
        }
    }

    // MARK: — Symbols page

    private var symbolsPage: some View {
        VStack(spacing: 0) {
            characterRow(["[","]","{","}","#","%","^","*","+","="])
            characterRow(["_","\\","|","~","<",">","€","£","¥","•"])

            HStack(spacing: keySpacingH) {
                fnKey(width: modeKeyW, fill: KP.fnKey, action: { page = .numbers }) {
                    Text("123").font(.system(size: compact ? 16 : 17, weight: .semibold))
                        .foregroundColor(KP.text).offset(y: labelOffsetY)
                }
                inputClusterRow([".",",","?","!","'"], fontSize: compact ? 20 : 22) { onInsertText($0) }
                fnKey(width: sideKeyW, fill: KP.fnKey, action: onBackspace) {
                    Image(systemName: "delete.left")
                        .font(.system(size: compact ? 16 : 18, weight: .semibold))
                        .foregroundColor(KP.text)
                }
            }
            .frame(height: rowTouchHeight)

            bottomRow(modeTitle: "ABC", modeAction: { page = .letters; shiftState = .lower })
                .frame(height: rowTouchHeight)
        }
    }

    // MARK: — Emoji page

    private var emojiColumns: Int { compact ? 10 : 10 }
    private var emojiScrollHeight: CGFloat { emojiGridHeight }

    private var emojiPage: some View {
        VStack(spacing: 0) {
            // Vertical-scrolling emoji grid — native iOS style
            ScrollView(.vertical, showsIndicators: false) {
                LazyVGrid(
                    columns: Array(repeating: GridItem(.flexible(), spacing: keySpacingH), count: emojiColumns),
                    spacing: keySpacingV
                ) {
                    ForEach(displayedEmojis, id: \.self) { emoji in
                        Button { onInsertText(emoji) } label: {
                            Text(emoji)
                                .font(.system(size: compact ? 26 : 29))
                                .frame(maxWidth: .infinity)
                                .frame(height: emojiCellSize)
                        }
                        .buttonStyle(EmojiGlyphStyle())
                    }
                }
                .padding(.vertical, compact ? 4 : 6)
            }
            .frame(height: emojiScrollHeight)

            // Icon-only category bar — matches iOS emoji keyboard
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 0) {
                    ForEach(EmojiCategory.allCases) { cat in
                        Button { selectedEmojiCategory = cat } label: {
                            VStack(spacing: 2) {
                                Image(systemName: cat.symbolName)
                                    .font(.system(size: compact ? 14 : 16, weight: .regular))
                                    .symbolRenderingMode(.monochrome)
                                    .foregroundColor(selectedEmojiCategory == cat ? KP.text : KP.secondary)
                                    .frame(width: compact ? 28 : 32, height: compact ? 20 : 22)

                                // Active indicator dot
                                Circle()
                                    .fill(selectedEmojiCategory == cat ? KP.secondary : .clear)
                                    .frame(width: 4, height: 4)
                            }
                            .frame(width: compact ? 32 : 36, height: categoryBarH)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 4)
            }
            .frame(height: categoryBarH)
            .padding(.bottom, compact ? 2 : 3)

            bottomRow(modeTitle: "ABC", modeAction: { page = .letters; shiftState = .lower })
                .frame(height: keyHeight)
        }
    }

    // MARK: — Shared bottom row

    private func bottomRow(modeTitle: String, modeAction: @escaping () -> Void) -> some View {
        HStack(spacing: keySpacingH) {
            fnKey(width: modeKeyW, fill: KP.fnKey, action: modeAction) {
                Text(modeTitle)
                    .font(.system(size: compact ? 16 : 17, weight: .regular))
                    .foregroundColor(KP.text)
                    .offset(y: labelOffsetY)
            }

            // Emoji toggle
            fnKey(
                width: globeKeyW,
                fill: page == .emoji ? KP.key : KP.fnKey,
                action: {
                    page = page == .emoji ? .letters : .emoji
                    if page == .letters { shiftState = .lower }
                }
            ) {
                Image(systemName: "face.smiling")
                    .font(.system(size: compact ? 17 : 19, weight: .regular))
                    .symbolRenderingMode(.monochrome)
                    .foregroundColor(KP.text)
            }

            // Space
            keyBtn(fill: KP.key, action: { onInsertText(" ") }) {
                Text("space")
                    .font(.system(size: compact ? 16 : 17, weight: .regular))
                    .foregroundColor(KP.text)
                    .offset(y: labelOffsetY)
            }

            // Return
            fnKey(width: returnKeyW, fill: KP.fnKey, action: onReturn) {
                Text(context.returnKeyTitle)
                    .font(.system(size: compact ? 15 : 16, weight: .regular))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .foregroundColor(KP.text)
                    .offset(y: labelOffsetY)
            }
        }
        .frame(maxHeight: .infinity)
        .contentShape(Rectangle())
    }

    // MARK: — Row builders

    private func characterRow(_ keys: [String]) -> some View {
        ZStack {
            rowFallback(keys: keys)
            HStack(spacing: keySpacingH) {
                ForEach(keys, id: \.self) { characterKey($0) }
            }
        }
        .frame(height: rowTouchHeight)
        .contentShape(Rectangle())
    }

    private func middleLetterRow(_ keys: [String]) -> some View {
        let inset: CGFloat = compact ? 24 : 28
        return ZStack {
            rowFallback(keys: keys, inset: inset)
            HStack(spacing: keySpacingH) {
                ForEach(keys, id: \.self) { characterKey($0) }
            }
            .padding(.horizontal, inset)
        }
        .frame(height: rowTouchHeight)
        .contentShape(Rectangle())
    }

    private func characterClusterRow(_ keys: [String]) -> some View {
        ZStack {
            rowFallback(keys: keys)
            HStack(spacing: keySpacingH) {
                ForEach(keys, id: \.self) { characterKey($0) }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: keyHeight)
        .contentShape(Rectangle())
    }

    private func inputClusterRow(_ keys: [String], fontSize: CGFloat, action: @escaping (String) -> Void) -> some View {
        ZStack {
            GeometryReader { g in
                Color.clear.contentShape(Rectangle())
                    .gesture(DragGesture(minimumDistance: 0).onEnded { v in
                        nearestInput(keys: keys, x: v.location.x, width: g.size.width, action: action)
                    })
            }
            HStack(spacing: keySpacingH) {
                ForEach(keys, id: \.self) { key in
                    charInputKey(label: key, fontSize: fontSize, action: { action(key) })
                }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: keyHeight)
    }

    // Transparent full-row tap fallback — maps any tap to the nearest key
    private func rowFallback(keys: [String], inset: CGFloat = 0) -> some View {
        GeometryReader { g in
            Color.clear.contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0).onEnded { v in
                    nearestCharacter(keys: keys, x: v.location.x, width: g.size.width, inset: inset)
                })
        }
    }

    // MARK: — Key builders

    private func characterKey(_ raw: String) -> some View {
        charInputKey(
            label: displayedChar(raw),
            fontSize: compact ? 24 : 26,
            action: { insertChar(raw) }
        )
    }

    private func charInputKey(label: String, fontSize: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: fontSize, weight: .regular))
                .minimumScaleFactor(0.8)
                .foregroundColor(KP.text)
                .offset(y: labelOffsetY)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .buttonStyle(CharKeyStyle(fill: KP.key, radius: radius, label: label, compact: compact))
        .frame(maxWidth: .infinity)
        .frame(height: keyHeight)
    }

    private func fnKey<C: View>(width: CGFloat, fill: Color, action: @escaping () -> Void, @ViewBuilder label: () -> C) -> some View {
        keyBtn(width: width, fill: fill, action: action) { label() }
    }

    private func keyBtn<C: View>(width: CGFloat? = nil, fill: Color, action: @escaping () -> Void, @ViewBuilder label: () -> C) -> some View {
        Button(action: action) {
            label().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .buttonStyle(FnKeyStyle(fill: fill, radius: radius))
        .frame(width: width)
        .frame(maxWidth: width == nil ? .infinity : nil)
        .frame(height: keyHeight)
    }

    // MARK: — Character helpers

    private var shiftIconName: String {
        switch shiftState {
        case .lower: return "shift"
        case .upper: return "shift.fill"
        case .caps:  return "capslock.fill"
        }
    }

    private func displayedChar(_ raw: String) -> String {
        guard page == .letters else { return raw }
        return shiftState == .lower ? raw.lowercased() : raw.uppercased()
    }

    private func insertChar(_ raw: String) {
        let out = page == .letters
            ? (shiftState == .lower ? raw.lowercased() : raw.uppercased())
            : raw
        onInsertText(out)
        if shiftState == .upper { shiftState = .lower }
    }

    private func handleShiftTap() {
        let now = Date()
        let doubleTap = now.timeIntervalSince(lastShiftTapTime) < 0.35
        switch shiftState {
        case .lower:
            shiftState = doubleTap ? .caps : .upper
            lastShiftTapTime = doubleTap ? .distantPast : now
        case .upper:
            shiftState = doubleTap ? .caps : .lower
            lastShiftTapTime = doubleTap ? .distantPast : now
        case .caps:
            shiftState = .lower
            lastShiftTapTime = .distantPast
        }
    }

    // MARK: — Nearest-key dispatch (background tap fallback)

    private func nearestCharacter(keys: [String], x: CGFloat, width: CGFloat, inset: CGFloat) {
        guard !keys.isEmpty else { return }
        let usable = max(1, width - inset * 2)
        let localX = min(max(x - inset, 0), usable)
        let spacing = keySpacingH * CGFloat(max(keys.count - 1, 0))
        let kw = (usable - spacing) / CGFloat(keys.count)
        guard kw > 0 else { return }
        let idx = min(max(Int(round((localX - kw / 2) / (kw + keySpacingH))), 0), keys.count - 1)
        insertChar(keys[idx])
    }

    private func nearestInput(keys: [String], x: CGFloat, width: CGFloat, action: (String) -> Void) {
        guard !keys.isEmpty else { return }
        let usable = max(1, width)
        let localX = min(max(x, 0), usable)
        let spacing = keySpacingH * CGFloat(max(keys.count - 1, 0))
        let kw = (usable - spacing) / CGFloat(keys.count)
        guard kw > 0 else { return }
        let idx = min(max(Int(round((localX - kw / 2) / (kw + keySpacingH))), 0), keys.count - 1)
        action(keys[idx])
    }
}

// MARK: — Button styles

private struct FnKeyStyle: ButtonStyle {
    let fill: Color
    let radius: CGFloat

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(configuration.isPressed ? KP.keyPressed : fill)
            )
            .shadow(color: .black.opacity(0.32), radius: 0, x: 0, y: 1)
    }
}

private struct CharKeyStyle: ButtonStyle {
    let fill: Color
    let radius: CGFloat
    let label: String
    let compact: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(configuration.isPressed ? KP.keyPressed : fill)
            )
            .shadow(color: .black.opacity(0.32), radius: 0, x: 0, y: 1)
            .overlay(alignment: .top) {
                if configuration.isPressed {
                    KeyPreviewBubble(text: label, compact: compact, fill: fill)
                        .allowsHitTesting(false)
                        .offset(y: compact ? -40 : -50)
                        .transition(.identity)
                }
            }
            .transaction { $0.animation = nil }
    }
}

private struct EmojiGlyphStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(Circle().fill(configuration.isPressed ? Color.white.opacity(0.12) : .clear))
            .scaleEffect(configuration.isPressed ? 0.92 : 1.0)
    }
}

// MARK: — Key preview bubble

private struct KeyPreviewBubble: View {
    let text: String
    let compact: Bool
    let fill: Color

    private var w: CGFloat { compact ? 54 : 60 }
    private var h: CGFloat { compact ? 62 : 70 }
    private var cr: CGFloat { compact ? 9 : 10 }

    var body: some View {
        PreviewShape(cornerRadius: cr)
            .fill(fill)
            .frame(width: w, height: h)
            .overlay(
                Text(text)
                    .font(.system(size: compact ? 38 : 44, weight: .regular))
                    .foregroundColor(KP.text)
                    .offset(y: compact ? -8 : -9)
            )
            .shadow(color: .black.opacity(0.26), radius: 1, x: 0, y: 1)
    }
}

private struct PreviewShape: Shape {
    let cornerRadius: CGFloat

    func path(in rect: CGRect) -> Path {
        let w = rect.width, h = rect.height
        let top = h * 0.62
        let sw = w * 0.56, sx = (w - sw) / 2
        let sbr = min(7.0, sw * 0.17)
        let sh = min(5.0, (w - sw) * 0.30)
        let r = min(cornerRadius, top * 0.22)

        var p = Path()
        p.move(to: CGPoint(x: r, y: 0))
        p.addLine(to: CGPoint(x: w - r, y: 0))
        p.addQuadCurve(to: CGPoint(x: w, y: r), control: CGPoint(x: w, y: 0))
        p.addLine(to: CGPoint(x: w, y: top - r))
        p.addQuadCurve(to: CGPoint(x: w - r, y: top), control: CGPoint(x: w, y: top))
        p.addLine(to: CGPoint(x: sx + sw + sh, y: top))
        p.addQuadCurve(to: CGPoint(x: sx + sw, y: top + sh), control: CGPoint(x: sx + sw, y: top))
        p.addLine(to: CGPoint(x: sx + sw, y: h - sbr))
        p.addQuadCurve(to: CGPoint(x: sx + sw - sbr, y: h), control: CGPoint(x: sx + sw, y: h))
        p.addLine(to: CGPoint(x: sx + sbr, y: h))
        p.addQuadCurve(to: CGPoint(x: sx, y: h - sbr), control: CGPoint(x: sx, y: h))
        p.addLine(to: CGPoint(x: sx, y: top + sh))
        p.addQuadCurve(to: CGPoint(x: sx - sh, y: top), control: CGPoint(x: sx, y: top))
        p.addLine(to: CGPoint(x: r, y: top))
        p.addQuadCurve(to: CGPoint(x: 0, y: top - r), control: CGPoint(x: 0, y: top))
        p.addLine(to: CGPoint(x: 0, y: r))
        p.addQuadCurve(to: CGPoint(x: r, y: 0), control: CGPoint(x: 0, y: 0))
        p.closeSubpath()
        return p
    }
}

// MARK: — Waveform

private struct RecordingWaveform: View {
    let level: Float
    let active: Bool
    let compact: Bool

    private let barCount = 11
    private var normalized: Double { min(max(Double(level), 0), 1) }
    private var shouldAnimate: Bool { active && normalized > 0.03 }

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.06, paused: !shouldAnimate)) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            HStack(spacing: compact ? 3 : 4) {
                ForEach(0..<barCount, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(KP.text)
                        .frame(width: compact ? 3 : 4, height: barH(i, t: t))
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func barH(_ i: Int, t: TimeInterval) -> CGFloat {
        let center = Double(barCount - 1) / 2.0
        let falloff = max(0.2, 1.0 - abs(Double(i) - center) / center * 0.8)
        let minH: CGFloat = compact ? 8 : 10
        let maxH: CGFloat = compact ? 22 : 28
        let base = minH + (maxH - minH) * CGFloat(0.16) * CGFloat(falloff)
        guard shouldAnimate else { return base }
        let wave = sin(t * 8 + Double(i) * 0.8) * 0.5 + 0.5
        let energy = normalized * 0.75 + wave * 0.25
        return minH + (maxH - minH) * CGFloat(energy) * CGFloat(falloff)
    }
}

// MARK: — No access

private struct NoAccessView: View {
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "lock.fill")
                .font(.system(size: 20, weight: .medium))
                .foregroundColor(KP.secondary)
            Text("Full Access Required")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(KP.text)
            Text("Settings → General → Keyboard → Overlay → Allow Full Access")
                .font(.system(size: 11, weight: .regular))
                .foregroundColor(KP.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
        }
    }
}
