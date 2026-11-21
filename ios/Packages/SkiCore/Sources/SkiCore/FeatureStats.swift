import Foundation

/// One point of an elevation profile: metres from the start and elevation in metres.
public struct ProfilePoint: Sendable, Hashable {
    public let distance: Double
    public let elevation: Double
}

/// Statistics for the info card of a run or lift. Port of `lineStats` in planner/feature-info.mjs.
public struct LineStats: Sendable {
    /// Length along the slope or cable when elevations are known, otherwise the horizontal length.
    public var length: Double
    public var horizontalLength: Double
    /// Elevation figures; nil when the line has no elevations.
    public var eleStart: Double?
    public var eleEnd: Double?
    public var minEle: Double?
    public var maxEle: Double?
    public var vertical: Double?
    public var descent: Double?
    public var ascent: Double?
    /// Net height difference over horizontal length (0.25 = 25 %).
    public var avgSlope: Double?
    /// Steepest slope over any 30 m stretch; nil for lines shorter than that.
    public var maxSlope: Double?
    /// Evenly spaced elevation profile (81 points), empty without elevations.
    public var profile: [ProfilePoint] = []
    /// Lifts only: ride time (s), speed along the cable (m/s) and vertical speed (m/min).
    public var duration: Double?
    public var speed: Double?
    public var verticalSpeed: Double?
}

private let slopeWindow = 30.0 // m
private let profilePoints = 80

/// Lifts are described bottom → top, runs in their drawing direction.
public func lineStats(_ line: [Pt], isLift: Bool, duration: Double? = nil) -> LineStats {
    var c = line
    if isLift, let first = c.first, let last = c.last, first.ele > last.ele { c.reverse() }

    var dist = [0.0]
    for i in c.indices.dropFirst() { dist.append(dist[i - 1] + haversine(c[i - 1], c[i])) }
    let horizontal = dist.last ?? 0
    var stats = LineStats(length: horizontal, horizontalLength: horizontal)

    // Pt has no "unknown" elevation; a line at exactly 0 m everywhere has none.
    let ele = c.map(\.ele)
    if c.count > 1, ele.contains(where: { $0 != 0 }) {
        var inclined = 0.0
        var descent = 0.0
        var ascent = 0.0
        for i in c.indices.dropFirst() {
            let dz = ele[i] - ele[i - 1]
            inclined += hypot(dist[i] - dist[i - 1], dz)
            if dz < 0 { descent -= dz } else { ascent += dz }
        }
        let minEle = ele.min()!
        let maxEle = ele.max()!
        stats.length = inclined
        stats.eleStart = ele.first
        stats.eleEnd = ele.last
        stats.minEle = minEle
        stats.maxEle = maxEle
        stats.vertical = maxEle - minEle
        stats.descent = descent
        stats.ascent = ascent
        stats.avgSlope = horizontal > 0 ? abs(ele[ele.count - 1] - ele[0]) / horizontal : 0

        if horizontal >= slopeWindow {
            var steepest = 0.0
            var j = 0
            for i in c.indices {
                while j < c.count && dist[j] - dist[i] < slopeWindow { j += 1 }
                if j >= c.count { break }
                steepest = max(steepest, abs(ele[j] - ele[i]) / (dist[j] - dist[i]))
            }
            stats.maxSlope = steepest
        }

        var k = 0
        stats.profile = (0...profilePoints).map { s in
            let d = horizontal * Double(s) / Double(profilePoints)
            while k < dist.count - 2 && dist[k + 1] < d { k += 1 }
            let span = dist[k + 1] - dist[k]
            let t = span > 0 ? min(1, max(0, (d - dist[k]) / span)) : 0
            return ProfilePoint(distance: d, elevation: ele[k] + (ele[k + 1] - ele[k]) * t)
        }
    }

    if isLift, let duration, duration > 0 {
        stats.duration = duration
        stats.speed = stats.length / duration
        stats.verticalSpeed = stats.vertical.map { $0 / (duration / 60) }
    }
    return stats
}

/// Finds runs, lifts and lift stations by the `id` the ski map tiles carry, for the info card of a tapped feature.
public struct FeatureLookup: Sendable {
    private let runs: [String: RunFeature]
    private let lifts: [String: LiftFeature]
    private let spots: [String: SpotFeature]

    public init(_ resort: ResortData) {
        func index<P>(_ features: [LineFeature<P>], _ id: (P) -> FlexString?) -> [String: LineFeature<P>] {
            Dictionary(features.compactMap { f in id(f.properties).map { ($0.value, f) } },
                       uniquingKeysWith: { first, _ in first })
        }
        runs = index(resort.runs) { $0.id }
        lifts = index(resort.lifts) { $0.id }
        spots = index(resort.spots) { $0.id }
    }

    public func run(id: String) -> RunFeature? { runs[id] }
    public func lift(id: String) -> LiftFeature? { lifts[id] }
    public func spot(id: String) -> SpotFeature? { spots[id] }
}
