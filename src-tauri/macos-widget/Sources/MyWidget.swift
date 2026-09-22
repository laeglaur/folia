import AppIntents
import SwiftUI
import TauriWidgets
import WidgetKit

private let foliaAppGroup = "group.com.laeglaur.notebook"
private let foliaWidgetKind = "FoliaBlockWidgetV3"
private let foliaWidgetBlocksKey = "foliaWidgetBlocks"
private let foliaWidgetDebugKey = "foliaWidgetDebug"

struct FoliaWidgetStore: Decodable {
    let version: Int?
    let selectedBlockId: String?
    let blocks: [FoliaBlockSnapshot]
}

struct FoliaBlockSnapshot: Decodable, Identifiable, Hashable {
    let id: String
    let pageId: String
    let pageTitle: String
    let preview: String
    let createdAt: String
    let updatedAt: String
    let lines: [FoliaWidgetLine]
}

struct FoliaWidgetLine: Decodable, Hashable {
    let kind: String
    let text: String
    let runs: [FoliaWidgetRun]?
    let indent: Int?
    let checked: Bool?
    let ordinal: Int?
}

struct FoliaWidgetRun: Decodable, Hashable {
    let text: String
    let bold: Bool?
    let italic: Bool?
    let code: Bool?
    let highlight: Bool?
    let color: String?
    let backgroundColor: String?
}

private enum FoliaWidgetData {
    static func store() -> FoliaWidgetStore {
        guard
            let raw = TauriWidgetDataStore.readValue(forKey: foliaWidgetBlocksKey, appGroup: foliaAppGroup),
            let data = raw.data(using: .utf8),
            let decoded = try? JSONDecoder().decode(FoliaWidgetStore.self, from: data)
        else {
            return FoliaWidgetStore(version: 1, selectedBlockId: nil, blocks: [])
        }
        return decoded
    }

    static func selectedBlock(for blockId: String?) -> FoliaBlockSnapshot? {
        let current = store()
        if let id = blockId, !id.isEmpty, let block = current.blocks.first(where: { $0.id == id }) {
            return block
        }
        if let id = current.selectedBlockId, let block = current.blocks.first(where: { $0.id == id }) {
            return block
        }
        return current.blocks.first
    }

    static func debug(_ message: String) {
        TauriWidgetDataStore.writeValue(
            "\(ISO8601DateFormatter().string(from: Date())) \(message)",
            forKey: foliaWidgetDebugKey,
            appGroup: foliaAppGroup
        )
    }
}

struct FoliaBlockOptionsProvider: DynamicOptionsProvider {
    init() {}

    func results() async throws -> IntentItemCollection<String> {
        let blocks = FoliaWidgetData.store().blocks.prefix(80)
        let items = blocks.map { block in
            IntentItem(
                block.id,
                title: LocalizedStringResource(stringLiteral: block.preview.isEmpty ? "Untitled block" : block.preview),
                subtitle: LocalizedStringResource(stringLiteral: block.pageTitle)
            )
        }
        FoliaWidgetData.debug("options blocks=\(items.count)")
        return IntentItemCollection {
            IntentItemSection("Blocks", items: items)
        }
    }

    func defaultResult() async -> String? {
        FoliaWidgetData.store().selectedBlockId ?? FoliaWidgetData.store().blocks.first?.id
    }
}

struct FoliaBlockConfigurationIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "folia Block"
    static var description = IntentDescription("Choose which folia block this widget displays.")

    @Parameter(title: "Block", optionsProvider: FoliaBlockOptionsProvider())
    var blockId: String?

    init() {}

    init(blockId: String?) {
        self.blockId = blockId
    }
}

struct FoliaBlockEntry: TimelineEntry {
    let date: Date
    let block: FoliaBlockSnapshot?
    let family: WidgetFamily
}

struct FoliaBlockProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> FoliaBlockEntry {
        FoliaBlockEntry(date: Date(), block: sampleBlock, family: context.family)
    }

    func snapshot(for configuration: FoliaBlockConfigurationIntent, in context: Context) async -> FoliaBlockEntry {
        let store = FoliaWidgetData.store()
        let block = FoliaWidgetData.selectedBlock(for: configuration.blockId)
        FoliaWidgetData.debug("snapshot blocks=\(store.blocks.count) configured=\(configuration.blockId ?? "nil") selected=\(block?.id ?? "nil")")
        return FoliaBlockEntry(date: Date(), block: block, family: context.family)
    }

    func timeline(for configuration: FoliaBlockConfigurationIntent, in context: Context) async -> Timeline<FoliaBlockEntry> {
        let store = FoliaWidgetData.store()
        let block = FoliaWidgetData.selectedBlock(for: configuration.blockId)
        FoliaWidgetData.debug("timeline blocks=\(store.blocks.count) configured=\(configuration.blockId ?? "nil") selected=\(block?.id ?? "nil")")
        let entry = FoliaBlockEntry(date: Date(), block: block, family: context.family)
        let next = Calendar.current.date(byAdding: .minute, value: 10, to: Date()) ?? Date()
        return Timeline(entries: [entry], policy: .after(next))
    }

    func recommendations() -> [AppIntentRecommendation<FoliaBlockConfigurationIntent>] {
        FoliaWidgetData.store().blocks.prefix(6).map {
            AppIntentRecommendation(
                intent: FoliaBlockConfigurationIntent(blockId: $0.id),
                description: "\($0.preview.isEmpty ? "Untitled block" : $0.preview)"
            )
        }
    }

    private var sampleBlock: FoliaBlockSnapshot {
        FoliaBlockSnapshot(
            id: "sample",
            pageId: "sample",
            pageTitle: "Today",
            preview: "Plan the next page",
            createdAt: "",
            updatedAt: "",
            lines: [
                FoliaWidgetLine(kind: "task", text: "Polish widget rendering", runs: nil, indent: 0, checked: true, ordinal: nil),
                FoliaWidgetLine(kind: "task", text: "Choose a block from widget settings", runs: nil, indent: 0, checked: false, ordinal: nil),
                FoliaWidgetLine(kind: "bullet", text: "Keep the card readable on the desktop", runs: nil, indent: 0, checked: nil, ordinal: nil)
            ]
        )
    }
}

@main
struct MyWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: foliaWidgetKind,
            intent: FoliaBlockConfigurationIntent.self,
            provider: FoliaBlockProvider()
        ) { entry in
            FoliaBlockWidgetView(entry: entry)
        }
        .configurationDisplayName("folia Block")
        .description("Show a selected folia block on your desktop.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .containerBackgroundRemovable(false)
        .contentMarginsDisabled()
    }
}

private struct FoliaBlockWidgetView: View {
    @Environment(\.widgetRenderingMode) private var widgetRenderingMode

    let entry: FoliaBlockEntry

    private var usesFullColor: Bool {
        true
    }

    private var maxLines: Int {
        switch entry.family {
        case .systemSmall: return 7
        case .systemMedium: return 9
        case .systemLarge: return 20
        default: return 9
        }
    }

    private var padding: CGFloat {
        switch entry.family {
        case .systemSmall: return 14
        case .systemMedium: return 16
        case .systemLarge: return 18
        default: return 16
        }
    }

    var body: some View {
        ZStack {
            background
            if let block = entry.block {
                card(block)
            } else {
                emptyState
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .widgetAccentable(false)
        .containerBackground(for: .widget) {
            Color(red: 0.98, green: 0.965, blue: 0.925)
        }
    }

    private var background: some View {
        Group {
            if usesFullColor {
                ZStack {
                    Color(red: 0.98, green: 0.965, blue: 0.925)
                    LinearGradient(
                        colors: [
                            Color(red: 1.0, green: 0.992, blue: 0.962).opacity(0.95),
                            Color(red: 0.922, green: 0.952, blue: 0.892).opacity(0.84)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                }
            } else {
                Color.black.opacity(0.16)
            }
        }
    }

    private func card(_ block: FoliaBlockSnapshot) -> some View {
        VStack(alignment: .leading, spacing: entry.family == .systemSmall ? 8 : 10) {
            header(block)
            VStack(alignment: .leading, spacing: entry.family == .systemLarge ? 7 : 6) {
                ForEach(Array(block.lines.prefix(maxLines).enumerated()), id: \.offset) { _, line in
                    lineView(line)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .padding(padding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func header(_ block: FoliaBlockSnapshot) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("folia")
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundStyle(usesFullColor ? Color(red: 0.22, green: 0.42, blue: 0.34) : Color.primary)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(Capsule().fill(usesFullColor ? Color(red: 0.82, green: 0.9, blue: 0.76).opacity(0.9) : Color.primary.opacity(0.12)))
            Text(block.pageTitle)
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(usesFullColor ? Color(red: 0.34, green: 0.39, blue: 0.33) : Color.secondary)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
    }

    private func lineView(_ line: FoliaWidgetLine) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 7) {
            if let indent = line.indent, indent > 0 {
                Spacer().frame(width: CGFloat(min(indent, 4)) * 14)
            }
            marker(for: line)
            richText(for: line)
                .strikethrough(line.kind == "task" && line.checked == true, color: Color(red: 0.48, green: 0.55, blue: 0.48))
                .lineLimit(line.kind == "heading" ? 2 : line.kind == "code" ? 1 : 3)
                .padding(.horizontal, line.kind == "code" ? 6 : hasHighlight(line) ? 3 : 0)
                .padding(.vertical, line.kind == "code" ? 3 : hasHighlight(line) ? 1 : 0)
                .background(lineBackground(for: line))
                .clipShape(RoundedRectangle(cornerRadius: line.kind == "code" ? 6 : 4, style: .continuous))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func marker(for line: FoliaWidgetLine) -> some View {
        switch line.kind {
        case "task":
            ZStack {
                RoundedRectangle(cornerRadius: 4)
                    .fill(line.checked == true ? markerColor : Color.clear)
                RoundedRectangle(cornerRadius: 4)
                    .stroke(markerColor.opacity(line.checked == true ? 0.9 : 0.72), lineWidth: 1.2)
                if line.checked == true {
                    Image(systemName: "checkmark")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(Color.white)
                }
            }
            .frame(width: 14, height: 14)
            .offset(y: 1)
        case "bullet":
            Circle()
                .fill(markerColor)
                .frame(width: 5, height: 5)
                .frame(width: 14)
                .offset(y: -1)
        case "numbered":
            Text("\(line.ordinal ?? 1).")
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(markerColor)
                .frame(width: 18, alignment: .trailing)
        case "quote":
            RoundedRectangle(cornerRadius: 2)
                .fill(markerColor.opacity(0.82))
                .frame(width: 3, height: 17)
                .frame(width: 14, alignment: .leading)
        default:
            EmptyView().frame(width: 0)
        }
    }

    private var markerColor: Color {
        usesFullColor ? Color(red: 0.36, green: 0.48, blue: 0.34) : Color.primary.opacity(0.78)
    }

    private func richText(for line: FoliaWidgetLine) -> Text {
        let runs = (line.runs?.isEmpty == false ? line.runs : nil) ?? [
            FoliaWidgetRun(text: line.text, bold: nil, italic: nil, code: line.kind == "code", highlight: nil, color: nil, backgroundColor: nil)
        ]
        return runs.reduce(Text("")) { partial, run in
            partial + text(for: run, line: line)
        }
    }

    private func text(for run: FoliaWidgetRun, line: FoliaWidgetLine) -> Text {
        let preservesSpaces = line.kind == "code" || run.code == true
        let content = preservesSpaces ? run.text.replacingOccurrences(of: " ", with: "\u{00A0}") : run.text
        var value = Text(content)
            .font(font(for: line, run: run))
            .foregroundColor(foreground(for: line, run: run))
        if run.bold == true && line.kind != "heading" {
            value = value.bold()
        }
        if run.italic == true {
            value = value.italic()
        }
        return value
    }

    @ViewBuilder
    private func lineBackground(for line: FoliaWidgetLine) -> some View {
        if line.kind == "code" {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(usesFullColor ? Color.white.opacity(0.48) : Color.primary.opacity(0.10))
        } else if hasHighlight(line) {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(usesFullColor ? highlightColor(for: line).opacity(0.56) : Color.primary.opacity(0.12))
        } else {
            Color.clear
        }
    }

    private func hasHighlight(_ line: FoliaWidgetLine) -> Bool {
        line.runs?.contains(where: { $0.highlight == true || $0.backgroundColor != nil }) == true
    }

    private func highlightColor(for line: FoliaWidgetLine) -> Color {
        guard
            let background = line.runs?.first(where: { $0.backgroundColor != nil })?.backgroundColor,
            let parsed = color(hex: background)
        else {
            return Color(red: 1.0, green: 0.88, blue: 0.32)
        }
        return parsed
    }

    private func font(for line: FoliaWidgetLine, run: FoliaWidgetRun? = nil) -> Font {
        switch line.kind {
        case "heading":
            return .system(size: entry.family == .systemSmall ? 14 : 15, weight: .semibold, design: .rounded)
        case "code":
            return .system(size: entry.family == .systemSmall ? 10 : 11, weight: .regular, design: .monospaced)
        default:
            if run?.code == true {
                return .system(size: entry.family == .systemSmall ? 11 : 12, weight: .regular, design: .monospaced)
            }
            return .system(size: entry.family == .systemSmall ? 12 : 13, weight: run?.bold == true ? .semibold : .regular, design: .rounded)
        }
    }

    private func foreground(for line: FoliaWidgetLine, run: FoliaWidgetRun? = nil) -> Color {
        if usesFullColor, let colorValue = run?.color, let parsed = color(hex: colorValue) {
            return parsed
        }
        if !usesFullColor {
            if line.kind == "task" && line.checked == true {
                return Color.secondary
            }
            return Color.primary
        }
        if line.kind == "task" && line.checked == true {
            return Color(red: 0.46, green: 0.54, blue: 0.45)
        }
        if line.kind == "quote" || line.kind == "code" {
            return Color(red: 0.30, green: 0.38, blue: 0.30)
        }
        return Color(red: 0.12, green: 0.16, blue: 0.12)
    }

    private func color(hex: String) -> Color? {
        var raw = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.hasPrefix("#") {
            raw.removeFirst()
        }
        guard raw.count == 6, let value = UInt64(raw, radix: 16) else {
            return nil
        }
        let red = Double((value & 0xff0000) >> 16) / 255.0
        let green = Double((value & 0x00ff00) >> 8) / 255.0
        let blue = Double(value & 0x0000ff) / 255.0
        return Color(red: red, green: green, blue: blue)
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("folia")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(usesFullColor ? Color(red: 0.22, green: 0.42, blue: 0.34) : Color.primary)
            Text("Open folia once, then edit this widget and choose a block.")
                .font(.system(size: 12, weight: .regular, design: .rounded))
                .foregroundStyle(usesFullColor ? Color(red: 0.32, green: 0.38, blue: 0.31) : Color.secondary)
                .lineLimit(4)
        }
        .padding(padding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
