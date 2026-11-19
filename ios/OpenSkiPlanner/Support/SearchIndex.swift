import Foundation
import SkiCore

/// One thing you can search for: a run, a lift, a ski area or a named place (village, peak, hut, …).
struct SearchHit: Identifiable, Hashable {
    let id: String
    let name: String
    let subtitle: String
    let location: Pt

    func matches(_ query: String) -> Bool {
        name.range(of: query, options: [.caseInsensitive, .diacriticInsensitive]) != nil
    }
}

/// Offline search index of a resort, like `buildSearchIndex` in planner/search.mjs.
enum SearchIndex {
    static func build(_ resort: ResortData) -> [SearchHit] {
        runs(resort.runs) + lifts(resort.lifts) + places(resort.places)
    }

    /// Runs with the same label, kind and difficulty are one hit, pinned at the highest start point.
    private static func runs(_ runs: [RunFeature]) -> [SearchHit] {
        var groups: [String: [RunFeature]] = [:]
        var order: [String] = []
        for run in runs {
            guard let label = run.properties.label, !label.isEmpty, !run.coordinates.isEmpty else { continue }
            let key = "\(label)|\(run.properties.kind ?? "")|\(run.properties.difficulty ?? "")"
            if groups[key] == nil { order.append(key) }
            groups[key, default: []].append(run)
        }
        return order.compactMap { key in
            guard let group = groups[key], let first = group.first,
                  let start = group.compactMap(\.coordinates.first).max(by: { $0.ele < $1.ele }) else { return nil }
            let difficulty = first.properties.difficulty.map { " · \(PisteLabels.shortName(of: $0))" } ?? ""
            return SearchHit(id: "run:\(key)", name: first.properties.label ?? "Run",
                             subtitle: "Run\(difficulty)", location: start)
        }
    }

    /// Lifts are pinned at the bottom station.
    private static func lifts(_ lifts: [LiftFeature]) -> [SearchHit] {
        lifts.compactMap { lift in
            guard let first = lift.coordinates.first, let last = lift.coordinates.last else { return nil }
            let p = lift.properties
            let type = (p.liftType ?? "lift").replacingOccurrences(of: "_", with: " ")
            let name = p.label.flatMap { $0.isEmpty ? nil : $0 } ?? "Unnamed \(type)"
            return SearchHit(id: "lift:\(p.id?.value ?? name)", name: name, subtitle: "Lift · \(type)",
                             location: first.ele <= last.ele ? first : last)
        }
    }

    private static func places(_ places: [Place]) -> [SearchHit] {
        places.enumerated().compactMap { i, place in
            guard place.coordinates.count >= 2 else { return nil }
            return SearchHit(id: "place:\(i)", name: place.name,
                             subtitle: place.kind.replacingOccurrences(of: "_", with: " "),
                             location: Pt(lon: place.coordinates[0], lat: place.coordinates[1], ele: place.elevation ?? 0))
        }
    }
}
