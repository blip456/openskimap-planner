import Foundation

/// Difficulty levels in increasing order (same as planner/graph.mjs).
public let difficultyOrder = ["novice", "easy", "intermediate", "advanced", "expert", "freeride", "unknown"]

let difficultyLevel: [String: Int] = [
    "novice": 0, "easy": 1, "intermediate": 2, "advanced": 3, "expert": 4,
    "freeride": 5, "extreme": 5, "unknown": 2,
]

func level(_ d: String?) -> Int { difficultyLevel[d ?? ""] ?? 2 }

/// Average skiing speeds in km/h (including short stops).
public enum SpeedPreset: String, CaseIterable, Sendable {
    case beginner, intermediate, confident

    public var speeds: [String: Double] {
        switch self {
        case .beginner:
            return ["novice": 12, "easy": 14, "intermediate": 10, "advanced": 7, "expert": 5, "freeride": 5,
                    "unknown": 12, "connection": 8, "walk": 3]
        case .intermediate:
            return ["novice": 18, "easy": 22, "intermediate": 20, "advanced": 14, "expert": 10, "freeride": 10,
                    "unknown": 18, "connection": 12, "walk": 3.5]
        case .confident:
            return ["novice": 25, "easy": 32, "intermediate": 35, "advanced": 28, "expert": 22, "freeride": 18,
                    "unknown": 28, "connection": 15, "walk": 4]
        }
    }
}

/// Typical lift speeds (m/s) used when the data has no ride duration.
let liftSpeed: [String: Double] = [
    "gondola": 5, "cable_car": 8, "mixed_lift": 4.5, "chair_lift": 2.5, "funicular": 6, "railway": 6,
    "rack_railway": 4, "t-bar": 3, "j-bar": 3, "platter": 3, "drag_lift": 3, "rope_tow": 2, "magic_carpet": 0.8,
]

public let liftGroups: [String: [String]] = [
    "gondola": ["gondola", "cable_car", "mixed_lift"],
    "chair_lift": ["chair_lift"],
    "rail": ["funicular", "railway", "rack_railway", "cog_railway"],
    "tbar": ["t-bar", "j-bar", "drag_lift"],
    "platter": ["platter"],
    "rope_tow": ["rope_tow"],
    "magic_carpet": ["magic_carpet"],
]

let liftTypeGroup: [String: String] = {
    var map: [String: String] = [:]
    for (group, types) in liftGroups { for t in types { map[t] = group } }
    return map
}()

public let dragLiftTypes: Set<String> = ["t-bar", "j-bar", "platter", "rope_tow", "drag_lift", "magic_carpet"]

/// User settings for a route. Changing them never requires rebuilding the network.
public struct PlanOptions: Equatable, Sendable, Codable {
    public var difficulties: [String] = ["novice", "easy"]
    /// When no route exists with the chosen runs, allow harder runs (with a warning).
    public var useHarderRunsIfNeeded = true
    public var preferEasier = true
    public var liftGroups: [String] = ["gondola", "chair_lift", "rail", "tbar", "platter", "rope_tow", "magic_carpet"]
    public var avoidDragLifts = false
    public var liftDown = false
    public var liftDownGroups: [String] = ["gondola", "rail"]
    public var includeConnections = true
    public var linkDistance = 40.0
    public var liftWait = 120.0
    public var speeds: [String: Double] = SpeedPreset.beginner.speeds

    public init() {}

    private enum CodingKeys: String, CodingKey {
        case difficulties, useHarderRunsIfNeeded, preferEasier, liftGroups, avoidDragLifts, liftDown, liftDownGroups
        case includeConnections, linkDistance, liftWait, speeds
    }

    /// Missing keys fall back to the defaults, so routes saved by an older version still open after a new
    /// option is added.
    public init(from decoder: Decoder) throws {
        self.init()
        let c = try decoder.container(keyedBy: CodingKeys.self)
        difficulties = try c.decodeIfPresent([String].self, forKey: .difficulties) ?? difficulties
        useHarderRunsIfNeeded = try c.decodeIfPresent(Bool.self, forKey: .useHarderRunsIfNeeded) ?? useHarderRunsIfNeeded
        preferEasier = try c.decodeIfPresent(Bool.self, forKey: .preferEasier) ?? preferEasier
        liftGroups = try c.decodeIfPresent([String].self, forKey: .liftGroups) ?? liftGroups
        avoidDragLifts = try c.decodeIfPresent(Bool.self, forKey: .avoidDragLifts) ?? avoidDragLifts
        liftDown = try c.decodeIfPresent(Bool.self, forKey: .liftDown) ?? liftDown
        liftDownGroups = try c.decodeIfPresent([String].self, forKey: .liftDownGroups) ?? liftDownGroups
        includeConnections = try c.decodeIfPresent(Bool.self, forKey: .includeConnections) ?? includeConnections
        linkDistance = try c.decodeIfPresent(Double.self, forKey: .linkDistance) ?? linkDistance
        liftWait = try c.decodeIfPresent(Double.self, forKey: .liftWait) ?? liftWait
        speeds = try c.decodeIfPresent([String: Double].self, forKey: .speeds) ?? speeds
    }

    /// Speeds are clamped to 0.5…100 km/h, like the web planner.
    func normalizedSpeeds() -> [String: Double] {
        var s = SpeedPreset.beginner.speeds
        for (k, v) in speeds where s[k] != nil && v.isFinite {
            s[k] = min(100, max(0.5, v))
        }
        return s
    }
}
