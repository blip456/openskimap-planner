import Foundation

/// Map display choices, kept between launches (the web planner keeps these in local storage).
struct DisplaySettings: Codable, Equatable {
    var showRuns = true
    var showLifts = true
    var showCrossCountry = false
    var showTouring = false
    /// false: runs coloured by official difficulty; true: by measured steepness.
    var steepness = false
    /// Ski areas drawn as coloured outlines with halos around their runs and lifts.
    var skiAreasInColour = false
    var routeArrows = true
    var routeDistances = true

    init() {}

    private enum CodingKeys: String, CodingKey {
        case showRuns, showLifts, showCrossCountry, showTouring, steepness, skiAreasInColour, routeArrows, routeDistances
    }

    /// Missing keys keep their defaults, so adding a setting never resets the others.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func value(_ key: CodingKeys, _ fallback: Bool) throws -> Bool {
            try c.decodeIfPresent(Bool.self, forKey: key) ?? fallback
        }
        let d = DisplaySettings()
        showRuns = try value(.showRuns, d.showRuns)
        showLifts = try value(.showLifts, d.showLifts)
        showCrossCountry = try value(.showCrossCountry, d.showCrossCountry)
        showTouring = try value(.showTouring, d.showTouring)
        steepness = try value(.steepness, d.steepness)
        skiAreasInColour = try value(.skiAreasInColour, d.skiAreasInColour)
        routeArrows = try value(.routeArrows, d.routeArrows)
        routeDistances = try value(.routeDistances, d.routeDistances)
    }

    private static let defaultsKey = "displaySettings"

    static func load(from defaults: UserDefaults = .standard) -> DisplaySettings {
        guard let data = defaults.data(forKey: defaultsKey),
              let settings = try? JSONDecoder().decode(DisplaySettings.self, from: data) else {
            return DisplaySettings()
        }
        return settings
    }

    func save(to defaults: UserDefaults = .standard) {
        defaults.set(try? JSONEncoder().encode(self), forKey: Self.defaultsKey)
    }
}
