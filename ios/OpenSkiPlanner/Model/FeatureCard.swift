import Foundation
import SkiCore

/// The info card of a tapped run, lift or lift station (like the web planner's info cards).
struct FeatureCard: Identifiable {
    enum Kind { case run, lift }

    let id: String
    let kind: Kind
    let title: String
    /// "Blue (easy)" or "6-seat Chairlift".
    let subtitle: String
    /// Piste difficulty of a run, for its colour.
    let difficulty: String?
    let stats: LineStats
    /// Short facts: "Groomed (classic)", "Lit", "Ride both ways", …
    let facts: [String]
    /// Ski areas and locality, e.g. "Skigebiet Söllereck · Oberstdorf".
    let area: String?
    /// The feature's line, drawn highlighted on the map.
    let line: [Pt]
    /// Where the user tapped: the spot the Start / Stop / Destination buttons add.
    let tapped: Pt

    static func make(featureId: String, tapped: Pt, lookup: FeatureLookup) -> FeatureCard? {
        if let run = lookup.run(id: featureId) {
            return runCard(run, tapped)
        }
        if let lift = lookup.lift(id: featureId) {
            return liftCard(lift, tapped, station: nil)
        }
        if let spot = lookup.spot(id: featureId), let liftId = spot.properties.liftId?.value,
           let lift = lookup.lift(id: liftId) {
            return liftCard(lift, tapped, station: spot.properties.label ?? spot.properties.name)
        }
        return nil
    }

    private static func runCard(_ run: RunFeature, _ tapped: Pt) -> FeatureCard {
        let p = run.properties
        let difficulty = p.difficulty ?? "unknown"
        let stats = lineStats(run.coordinates, isLift: false)

        var facts: [String] = []
        if p.kind == "connection" { facts.append("Ski path") }
        if let note = steepnessNote(difficulty: difficulty, maxSlope: stats.maxSlope) { facts.append(note) }
        if let grooming = p.grooming { facts.append("Groomed (\(grooming.replacingOccurrences(of: "_", with: " ")))") }
        if p.oneway == true { facts.append("One way") }
        if p.lit == true { facts.append("Lit") }
        if p.snowmaking == true { facts.append("Snowmaking") }
        if p.patrolled == true { facts.append("Patrolled") }
        if p.gladed == true { facts.append("Gladed") }
        if let status = p.status, status != "operating" { facts.append("Status: \(status)") }

        return FeatureCard(
            id: p.id?.value ?? UUID().uuidString, kind: .run,
            title: nonEmpty(p.label) ?? "Unnamed run",
            subtitle: PisteLabels.name(of: difficulty), difficulty: difficulty,
            stats: stats, facts: facts, area: areaLine(p.skiAreas, p.place),
            line: run.coordinates, tapped: tapped)
    }

    private static func liftCard(_ lift: LiftFeature, _ tapped: Pt, station: String?) -> FeatureCard {
        let p = lift.properties
        let type = PisteLabels.liftTypeName(p.liftType)
        let seats = p.occupancy.map { "\(Int($0))-seat " } ?? ""

        var facts: [String] = []
        if let station { facts.append("Station: \(station)") }
        switch p.direction {
        case "both": facts.append("Ride both ways")
        case "up": facts.append("Up only")
        default: facts.append("Riding down not specified")
        }
        if let capacity = p.capacity { facts.append("\(Int(capacity)) persons/h") }
        if p.bubble == true { facts.append("Bubble") }
        if p.heating == true { facts.append("Heated") }
        if let status = p.status, status != "operating" { facts.append("Status: \(status)") }

        return FeatureCard(
            id: p.id?.value ?? UUID().uuidString, kind: .lift,
            title: nonEmpty(p.label) ?? "Unnamed \(type.lowercased())",
            subtitle: seats + type, difficulty: nil,
            stats: lineStats(lift.coordinates, isLift: true, duration: p.duration),
            facts: facts, area: areaLine(p.skiAreas, p.place),
            line: lift.coordinates, tapped: tapped)
    }

    /// Steepness classes of the web planner (< 10 %, 10–25 %, 25–40 %, > 40 %) against the official colour:
    /// flags a "blue" run whose steepest part is really red.
    private static func steepnessNote(difficulty: String, maxSlope: Double?) -> String? {
        guard let maxSlope else { return nil }
        let classes = ["green", "blue", "red", "black"]
        let measured = maxSlope < 0.10 ? 0 : (maxSlope < 0.25 ? 1 : (maxSlope < 0.40 ? 2 : 3))
        let official: Int
        switch difficulty {
        case "novice": official = 0
        case "easy": official = 1
        case "intermediate": official = 2
        case "advanced", "expert": official = 3
        default: return nil
        }
        guard measured > official else { return nil }
        return "Steepest part is \(classes[measured]) (\(Int((maxSlope * 100).rounded())) %)"
    }

    private static func areaLine(_ areas: [SkiAreaRef]?, _ place: PlaceInfo?) -> String? {
        let parts = (areas ?? []).compactMap(\.name).prefix(2) + [place?.locality ?? place?.region].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private static func nonEmpty(_ s: String?) -> String? {
        guard let s, !s.isEmpty else { return nil }
        return s
    }
}
