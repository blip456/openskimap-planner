import SkiCore
import SwiftUI

/// Display names and colours for piste difficulties, lift groups and speed presets (same as the web planner).
enum PisteLabels {
    /// Difficulties in the order the run filter shows them.
    static let difficulties = ["novice", "easy", "intermediate", "advanced", "expert", "freeride", "unknown"]

    /// "Blue (easy)": colour and OpenSkiData name, for the directions.
    static func name(of difficulty: String) -> String {
        switch difficulty {
        case "novice": return "Green (novice)"
        case "easy": return "Blue (easy)"
        case "intermediate": return "Red (intermediate)"
        case "advanced": return "Black (advanced)"
        case "expert": return "Black ◆◆ (expert)"
        case "freeride", "extreme": return "Freeride"
        default: return "No difficulty"
        }
    }

    /// "Blue": the colour only, for the run filter.
    static func shortName(of difficulty: String) -> String {
        switch difficulty {
        case "novice": return "Green"
        case "easy": return "Blue"
        case "intermediate": return "Red"
        case "advanced": return "Black"
        case "expert": return "Black ◆◆"
        case "freeride", "extreme": return "Freeride"
        default: return "Unknown"
        }
    }

    static func color(of difficulty: String?) -> Color {
        switch difficulty {
        case "novice": return Color(red: 0.18, green: 0.62, blue: 0.23)
        case "easy": return Color(red: 0.12, green: 0.44, blue: 0.84)
        case "intermediate": return Color(red: 0.85, green: 0.15, blue: 0.11)
        case "advanced", "expert": return .black
        case "freeride", "extreme": return Color(red: 0.94, green: 0.49, blue: 0)
        default: return .gray
        }
    }

    /// "Chairlift" for "chair_lift" (names as in planner/search.mjs).
    static func liftTypeName(_ liftType: String?) -> String {
        switch liftType {
        case "gondola": return "Gondola"
        case "cable_car": return "Cable car"
        case "mixed_lift": return "Gondola/chair combo"
        case "chair_lift": return "Chairlift"
        case "funicular": return "Funicular"
        case "railway": return "Railway"
        case "rack_railway": return "Rack railway"
        case "t-bar": return "T-bar"
        case "j-bar": return "J-bar"
        case "platter": return "Platter lift"
        case "drag_lift": return "Drag lift"
        case "rope_tow": return "Rope tow"
        case "magic_carpet": return "Magic carpet"
        case let other?: return other.replacingOccurrences(of: "_", with: " ").capitalized
        case nil: return "Lift"
        }
    }

    /// Lift groups of `PlanOptions.liftGroups`, in display order.
    static let liftGroups: [(key: String, name: String)] = [
        ("gondola", "Gondola / cable car"), ("chair_lift", "Chairlift"), ("rail", "Funicular / train"),
        ("tbar", "T-bar / J-bar / drag lift"), ("platter", "Platter"), ("rope_tow", "Rope tow"),
        ("magic_carpet", "Magic carpet"),
    ]
}

extension SpeedPreset {
    var label: String {
        switch self {
        case .beginner: return "Beginner"
        case .intermediate: return "Intermediate"
        case .confident: return "Confident"
        }
    }

    /// The preset whose speeds the options use, if any.
    init?(matching speeds: [String: Double]) {
        guard let preset = Self.allCases.first(where: { $0.speeds == speeds }) else { return nil }
        self = preset
    }
}

/// Role of a route point: green start, blue stops, red destination (same colours as the web planner).
enum RoutePointRole: String {
    case start, stop, end

    init(index: Int, count: Int) {
        if index == 0 {
            self = .start
        } else if index == count - 1 {
            self = .end
        } else {
            self = .stop
        }
    }

    var color: Color {
        switch self {
        case .start: return Color(red: 0.18, green: 0.62, blue: 0.23)
        case .stop: return Color(red: 0.12, green: 0.44, blue: 0.84)
        case .end: return Color(red: 0.85, green: 0.15, blue: 0.11)
        }
    }
}
