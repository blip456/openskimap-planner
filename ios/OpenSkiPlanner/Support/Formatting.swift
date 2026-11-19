import Foundation
import OSLog

/// "850 m" below a kilometre, "3.2 km" above.
func formatDistance(_ metres: Double) -> String {
    metres < 1000 ? "\(Int(metres.rounded())) m" : String(format: "%.1f km", metres / 1000)
}

/// "45 min" or "1 h 20 min".
func formatDuration(_ seconds: Double) -> String {
    let minutes = Int((seconds / 60).rounded())
    return minutes < 60 ? "\(minutes) min" : "\(minutes / 60) h \(minutes % 60) min"
}

/// Label of a distance marker on the route: "250 m", "1 km", "2 km".
func formatMarkerDistance(_ metres: Double) -> String {
    metres < 1000 ? "\(Int(metres)) m" : "\(Int(metres / 1000)) km"
}

extension Array where Element: Equatable {
    /// Adds or removes an element so that `contains(element) == included`.
    mutating func set(_ element: Element, included: Bool) {
        if included {
            if !contains(element) { append(element) }
        } else {
            removeAll { $0 == element }
        }
    }
}

extension Logger {
    static let app = Logger(subsystem: Bundle.main.bundleIdentifier ?? "OpenSkiPlanner", category: "app")
}
