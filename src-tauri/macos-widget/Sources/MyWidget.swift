import WidgetKit
import SwiftUI
import TauriWidgets

// ─── Entry Point ─────────────────────────────────────────────────────────────
// This is the only file you need in your Widget Extension target.
// Adjust `appGroup` and `kind` to match your app's configuration.

@main
struct MyWidget: Widget {
    let kind = "FoliaBlockWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: kind,
            provider: TauriWidgetProvider(appGroup: "group.com.laeglaur.notebook")
        ) { entry in
            TauriWidgetView(entry: entry)
        }
        .configurationDisplayName("folia Block")
        .description("Show the selected folia block on your desktop.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}
