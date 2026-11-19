import Foundation

// Ski routing network built from OpenSkiData runs and lifts. Port of planner/graph.mjs.
//
// - Runs are directed downhill (OSM convention / oneway flag / elevation).
// - Lifts are directed uphill, split at intermediate stations.
// - Optional "ride down" edges for gondolas, cable cars, etc.
// - Short walking/skating links bridge small gaps between features.

public struct RouteError: LocalizedError, Sendable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

let maxSegment = 25.0 // m, runs are densified so gap links can attach anywhere
let snapDistance = 400.0 // m, max distance between a clicked point and the network
let climbSpeed = 0.12 // m/s vertical when walking uphill
let shortUnknownRun = 150.0 // m

struct Edge {
    enum Kind { case run, lift, link }

    var kind: Kind
    var from: Int
    var to: Int
    var index = 0
    var length: Double
    var dz: Double
    var coords: [Pt]
    var featureId: String? = nil
    var difficulty: String? = nil
    var runKind: String? = nil
    var liftType: String? = nil
    var liftGroup: String? = nil
    var ride: Double = 0
    var down = false
    var bidirectional = false
}

struct FeatureInfo {
    let label: String
    let name: String?
    let color: String?
    let liftType: String?
}

public final class SkiNetwork {
    public private(set) var nodes: [Pt] = []
    private var nodeFeatures: [Set<String>] = []
    private var nodeIndex: [String: Int] = [:]
    private(set) var edges: [Edge] = []
    private var out: [[Int]] = []
    private var features: [String: FeatureInfo] = [:]
    private var terminals: [Int] = []
    private var terminalSet: Set<Int> = []

    public init(runs: [RunFeature], lifts: [LiftFeature]) {
        for f in runs { addRun(f) }
        for f in lifts { addLift(f) }
        addLinks()
    }

    public convenience init(resort: ResortData) {
        self.init(runs: resort.runs, lifts: resort.lifts)
    }

    // MARK: - building

    private func node(_ c: Pt, _ featureId: String) -> Int {
        let key = String(format: "%.6f,%.6f", c.lon, c.lat)
        if let i = nodeIndex[key] {
            nodeFeatures[i].insert(featureId)
            return i
        }
        let i = nodes.count
        nodes.append(c)
        nodeFeatures.append([featureId])
        out.append([])
        nodeIndex[key] = i
        return i
    }

    private func addTerminal(_ n: Int) {
        if terminalSet.insert(n).inserted { terminals.append(n) }
    }

    @discardableResult
    private func addEdge(_ e: Edge) -> Int {
        var edge = e
        edge.index = edges.count
        edges.append(edge)
        out[edge.from].append(edge.index)
        return edge.index
    }

    private static func operating(_ status: String?) -> Bool { status == nil || status == "operating" }

    private static func densify(_ coords: [Pt]) -> [Pt] {
        guard var prev = coords.first else { return [] }
        var out = [prev]
        for i in 1..<max(1, coords.count) {
            let b = coords[i]
            let d = haversine(prev, b)
            let n = Int(floor(d / maxSegment))
            if n > 0 {
                for k in 1...n {
                    let t = Double(k) / Double(n + 1)
                    out.append(Pt(
                        lon: prev.lon + (b.lon - prev.lon) * t,
                        lat: prev.lat + (b.lat - prev.lat) * t,
                        ele: prev.ele + (b.ele - prev.ele) * t))
                }
            }
            out.append(b)
            prev = b
        }
        return out
    }

    private func addRun(_ f: RunFeature) {
        let p = f.properties
        guard Self.operating(p.status) else { return }
        guard let kind = p.kind, kind == "downhill" || kind == "connection" else { return }
        let coords = Self.densify(f.coordinates)
        guard coords.count >= 2 else { return }

        let difficulty = p.difficulty ?? "unknown"
        let featureId = p.id?.value ?? "run-\(edges.count)-\(nodes.count)"
        features[featureId] = FeatureInfo(label: p.label ?? "", name: p.name, color: p.color, liftType: nil)

        var forward = true
        var backward = false
        if kind == "connection" || p.oneway == false {
            backward = true
        } else if p.oneway != true && coords[0].ele + 5 < coords[coords.count - 1].ele {
            forward = false
            backward = true
        }

        var total = 0.0
        for i in 1..<coords.count { total += haversine(coords[i - 1], coords[i]) }
        // Short runs without a difficulty are usually station access paths or tiny connectors.
        let connector = difficulty == "unknown" && total < shortUnknownRun

        let ids = coords.map { node($0, featureId) }
        addTerminal(ids[0])
        addTerminal(ids[ids.count - 1])
        for i in 1..<ids.count {
            let a = ids[i - 1]
            let b = ids[i]
            if a == b { continue }
            let length = haversine(coords[i - 1], coords[i])
            let runKind = connector ? "connector" : kind
            if forward {
                addEdge(Edge(kind: .run, from: a, to: b, length: length,
                             dz: coords[i].ele - coords[i - 1].ele, coords: [coords[i - 1], coords[i]],
                             featureId: featureId, difficulty: difficulty, runKind: runKind))
            }
            if backward {
                addEdge(Edge(kind: .run, from: b, to: a, length: length,
                             dz: coords[i - 1].ele - coords[i].ele, coords: [coords[i], coords[i - 1]],
                             featureId: featureId, difficulty: difficulty, runKind: runKind))
            }
        }
    }

    private func addLift(_ f: LiftFeature) {
        let p = f.properties
        guard Self.operating(p.status) else { return }
        if p.liftType == "zip_line" { return }
        var coords = f.coordinates
        guard coords.count >= 2 else { return }
        if coords[0].ele > coords[coords.count - 1].ele + 5 { coords.reverse() }

        let featureId = p.id?.value ?? "lift-\(edges.count)-\(nodes.count)"
        features[featureId] = FeatureInfo(label: p.label ?? "", name: p.name, color: nil, liftType: p.liftType)

        // station positions along the lift line
        var stationIdx: Set<Int> = [0, coords.count - 1]
        for s in p.stations ?? [] {
            guard let sc = s.coordinates, let station = Pt(position: sc) else { continue }
            var best = 0
            var bestD = Double.infinity
            for (i, c) in coords.enumerated() {
                let d = haversine(c, station)
                if d < bestD {
                    bestD = d
                    best = i
                }
            }
            if bestD < 60 { stationIdx.insert(best) }
        }
        let stations = stationIdx.sorted()

        var cumulative = [0.0]
        for i in 1..<coords.count { cumulative.append(cumulative[i - 1] + haversine(coords[i - 1], coords[i])) }
        let total = cumulative[cumulative.count - 1]

        let nodeIds = stations.map { node(coords[$0], featureId) }
        nodeIds.forEach { addTerminal($0) }

        let liftType = p.liftType ?? "gondola"
        let group = liftTypeGroup[liftType] ?? "gondola"
        for a in 0..<stations.count {
            for b in (a + 1)..<max(a + 1, stations.count) {
                let i = stations[a]
                let j = stations[b]
                let length = cumulative[j] - cumulative[i]
                let fraction = total > 0 ? length / total : 1
                let segment = Array(coords[i...j])
                let ride: Double
                if let duration = p.duration, duration != 0 {
                    ride = duration * fraction
                } else {
                    ride = length / (liftSpeed[liftType] ?? 3)
                }
                addEdge(Edge(kind: .lift, from: nodeIds[a], to: nodeIds[b], length: length,
                             dz: coords[j].ele - coords[i].ele, coords: segment,
                             featureId: featureId, liftType: liftType, liftGroup: group, ride: ride, down: false))
                if !dragLiftTypes.contains(liftType) {
                    addEdge(Edge(kind: .lift, from: nodeIds[b], to: nodeIds[a], length: length,
                                 dz: coords[i].ele - coords[j].ele, coords: Array(segment.reversed()),
                                 featureId: featureId, liftType: liftType, liftGroup: group, ride: ride,
                                 down: true, bidirectional: p.oneway == false))
                }
            }
        }
    }

    /// Walking / skating links between features whose ends do not quite touch.
    private func addLinks(maxDistance: Double = 150) {
        let cell = maxDistance / 111_320
        var grid: [String: [Int]] = [:]
        func cellKey(_ lon: Double, _ lat: Double) -> String {
            "\(Int(floor(lon / cell))),\(Int(floor(lat / cell)))"
        }
        for (i, n) in nodes.enumerated() { grid[cellKey(n.lon, n.lat), default: []].append(i) }

        var done: Set<String> = []
        for t in terminals {
            let tp = nodes[t]
            let cx = Int(floor(tp.lon / cell))
            let cy = Int(floor(tp.lat / cell))
            // nearest node per feature, in insertion order
            var order: [String] = []
            var nearest: [String: (n: Int, d: Double)] = [:]
            for dx in -2...2 {
                for dy in -1...1 {
                    for n in grid["\(cx + dx),\(cy + dy)"] ?? [] {
                        if n == t { continue }
                        if !nodeFeatures[n].isDisjoint(with: nodeFeatures[t]) { continue }
                        let d = haversine(tp, nodes[n])
                        if d > maxDistance { continue }
                        for fid in nodeFeatures[n].sorted() {
                            if let cur = nearest[fid] {
                                if d < cur.d { nearest[fid] = (n, d) }
                            } else {
                                order.append(fid)
                                nearest[fid] = (n, d)
                            }
                        }
                    }
                }
            }
            for fid in order {
                guard let cur = nearest[fid] else { continue }
                let n = cur.n
                let d = cur.d
                let key = t < n ? "\(t)-\(n)" : "\(n)-\(t)"
                if done.contains(key) { continue }
                done.insert(key)
                let a = nodes[t]
                let b = nodes[n]
                addEdge(Edge(kind: .link, from: t, to: n, length: d, dz: b.ele - a.ele, coords: [a, b]))
                addEdge(Edge(kind: .link, from: n, to: t, length: d, dz: a.ele - b.ele, coords: [b, a]))
            }
        }
    }

    // MARK: - routing

    /// Time in seconds to travel one edge with the user's speeds.
    func edgeTime(_ e: Edge, _ o: PlanOptions, _ sp: [String: Double]) -> Double {
        func kmh(_ v: Double) -> Double { v / 3.6 }
        switch e.kind {
        case .lift:
            return o.liftWait + e.ride
        case .link:
            return e.length / kmh(sp["walk"] ?? 3) + max(0, e.dz) / climbSpeed
        case .run:
            if e.runKind == "connection" || e.runKind == "connector" {
                return e.dz > 1
                    ? e.length / kmh(sp["walk"] ?? 3) + e.dz / climbSpeed
                    : e.length / kmh(sp["connection"] ?? 8)
            }
            let key = e.difficulty == "extreme" ? "freeride" : (e.difficulty ?? "unknown")
            let speed = sp[key] ?? sp["unknown"] ?? 12
            return e.length / kmh(speed) + (e.dz > 2 ? e.dz / climbSpeed : 0)
        }
    }

    func cost(_ e: Edge, _ o: PlanOptions, _ sp: [String: Double], relaxed: Bool) -> Double {
        switch e.kind {
        case .run:
            if e.runKind == "connection" || e.runKind == "connector" {
                if e.runKind == "connection" && !o.includeConnections { return .infinity }
                return edgeTime(e, o, sp)
            }
            var time = edgeTime(e, o, sp)
            let difficulty = e.difficulty ?? "unknown"
            if o.difficulties.contains(difficulty) {
                if o.preferEasier { time *= 1 + 0.35 * Double(level(difficulty)) }
                return time
            }
            if !relaxed { return .infinity }
            let maxAllowed = max(-1, o.difficulties.map { difficultyLevel[$0] ?? 0 }.max() ?? -1)
            let over = max(1, level(difficulty) - maxAllowed)
            return time * pow(10, Double(over))
        case .lift:
            guard let group = e.liftGroup, o.liftGroups.contains(group) else { return .infinity }
            var time = edgeTime(e, o, sp)
            if e.down {
                if !e.bidirectional && !o.liftDown { return .infinity }
                if !o.liftDownGroups.contains(e.liftGroup ?? "") && !e.bidirectional { return .infinity }
                time = time * 2 + 300 // prefer skiing allowed runs when both are possible
            }
            if o.avoidDragLifts, let lt = e.liftType, dragLiftTypes.contains(lt) { time *= 4 }
            return time
        case .link:
            if e.length > o.linkDistance { return .infinity }
            return edgeTime(e, o, sp) * 2
        }
    }

    func nearestNode(_ p: Pt, wantOut: Bool) -> (node: Int, distance: Double) {
        var best = -1
        var bestD = Double.infinity
        for i in 0..<nodes.count {
            if wantOut && out[i].isEmpty { continue }
            let d = haversine(p, nodes[i])
            if d < bestD {
                bestD = d
                best = i
            }
        }
        return (best, bestD)
    }

    func dijkstra(_ source: Int, _ target: Int, _ costOf: (Edge) -> Double) -> [Edge]? {
        let n = nodes.count
        var dist = [Double](repeating: .infinity, count: n)
        var prev = [Int](repeating: -1, count: n)
        var heap = MinHeap()
        dist[source] = 0
        heap.push(source, 0)
        while let (u, du) = heap.pop() {
            if du > dist[u] { continue }
            if u == target { break }
            for ei in out[u] {
                let e = edges[ei]
                let c = costOf(e)
                if c == .infinity { continue }
                let nd = du + c
                if nd < dist[e.to] {
                    dist[e.to] = nd
                    prev[e.to] = ei
                    heap.push(e.to, nd)
                }
            }
        }
        if dist[target] == .infinity { return nil }
        var path: [Edge] = []
        var v = target
        while v != source {
            let e = edges[prev[v]]
            path.append(e)
            v = e.from
        }
        return path.reversed()
    }

    /// Route through the given points (start, stops…, destination).
    public func route(points: [Pt], options: PlanOptions = PlanOptions()) throws -> RouteResult {
        guard points.count >= 2 else { throw RouteError("Set at least a start and a destination.") }
        let sp = options.normalizedSpeeds()

        var snaps: [(node: Int, distance: Double)] = []
        for (i, p) in points.enumerated() {
            let s = nearestNode(p, wantOut: i < points.count - 1)
            if s.node < 0 || s.distance > snapDistance {
                throw RouteError("Point \(pointLetter(i)) is \(Int(s.distance.rounded())) m from the nearest run or lift. Click closer to the ski area.")
            }
            snaps.append(s)
        }

        var warnings: [String] = []
        var legEdges: [[Edge]] = []
        var relaxedUsed = false
        for i in 0..<(snaps.count - 1) {
            let from = snaps[i].node
            let to = snaps[i + 1].node
            if from == to {
                legEdges.append([])
                continue
            }
            var leg = dijkstra(from, to) { cost($0, options, sp, relaxed: false) }
            if leg == nil && options.useHarderRunsIfNeeded {
                leg = dijkstra(from, to) { cost($0, options, sp, relaxed: true) }
                if leg != nil { relaxedUsed = true }
            }
            guard let found = leg else {
                var permissive = PlanOptions()
                permissive.difficulties = difficultyOrder
                permissive.liftGroups = Array(liftGroups.keys)
                permissive.liftDown = true
                permissive.liftDownGroups = Array(liftGroups.keys)
                permissive.includeConnections = true
                permissive.linkDistance = 150
                let anyway = dijkstra(from, to) { cost($0, permissive, sp, relaxed: true) }
                let legName = "the leg \(pointLetter(i)) → \(pointLetter(i + 1))"
                if anyway == nil {
                    throw RouteError("No ski connection for \(legName): these ski areas are not linked by runs or lifts. You probably need a ski bus. Plan each area separately.")
                }
                throw RouteError("No route for \(legName) with your settings. Try allowing more runs or lifts, or turn on \"Ride lifts down\".")
            }
            legEdges.append(found)
        }

        // Steps are built per leg so a run is never merged across a stop; each step knows its leg.
        var steps: [RouteStep] = []
        for (leg, edgesOfLeg) in legEdges.enumerated() {
            for s in toSteps(edgesOfLeg, options, sp) {
                s.leg = leg
                steps.append(s)
            }
        }
        let allEdges = legEdges.flatMap { $0 }
        let allowed = Set(options.difficulties)
        let harder = steps.filter { $0.isRealRun && !allowed.contains($0.difficulty ?? "") }
        if relaxedUsed && !harder.isEmpty {
            var seen: [String] = []
            for s in harder {
                let item = "\(s.label) (\(s.difficulty ?? ""))"
                if !seen.contains(item) { seen.append(item) }
            }
            warnings.append("No route with only your chosen runs. This route uses harder runs: \(seen.joined(separator: ", ")).")
        }
        let unknown = steps.filter { $0.isRealRun && $0.difficulty == "unknown" }
        if !unknown.isEmpty && allowed.contains("unknown") {
            warnings.append("Some runs on this route have no difficulty in the map data. Check the piste map.")
        }
        let down = steps.filter { $0.type == .lift && $0.down }
        if !down.isEmpty {
            warnings.append("Rides a lift down: \(down.map(\.label).joined(separator: ", ")). Check that this is allowed.")
        }
        let walks = steps.filter { $0.type == .walk && $0.distance > 25 }
        if !walks.isEmpty {
            warnings.append("Includes \(walks.count == 1 ? "a short walk" : "\(walks.count) short walks") where the map data has a gap.")
        }
        for (i, s) in snaps.enumerated() where s.distance > 75 {
            warnings.append("Point \(pointLetter(i)) was moved \(Int(s.distance.rounded())) m to the nearest run or lift.")
        }

        var coords: [Pt] = []
        for e in allEdges {
            for c in e.coords {
                if let last = coords.last, last.lon == c.lon, last.lat == c.lat { continue }
                coords.append(c)
            }
        }

        var summary = RouteSummary.of(steps)
        summary.hardest = harder
            .map { $0.difficulty ?? "" }
            .sorted { level($0) > level($1) }
            .first
        let legs = legEdges.indices.map { i in
            LegSummary(index: i, from: pointLetter(i), to: pointLetter(i + 1),
                       summary: RouteSummary.of(steps.filter { $0.leg == i }))
        }

        return RouteResult(
            steps: steps, legs: legs, warnings: warnings, summary: summary,
            coordinates: coords, snapped: snaps.map { nodes[$0.node] })
    }

    // MARK: - steps

    func toSteps(_ edgesOfLeg: [Edge], _ o: PlanOptions, _ sp: [String: Double]) -> [RouteStep] {
        var steps: [RouteStep] = []
        for e in edgesOfLeg {
            let type: StepType
            switch e.kind {
            case .run: type = .run
            case .lift: type = .lift
            case .link: type = .walk
            }
            let key = "\(type.rawValue):\(e.featureId ?? ""):\(e.down ? "down" : "")"
            if steps.last?.key != key {
                let info = e.featureId.flatMap { features[$0] }
                let label: String
                if let l = info?.label, !l.isEmpty {
                    label = l
                } else {
                    switch type {
                    case .walk: label = "Walk / skate"
                    case .lift: label = "Unnamed \((info?.liftType ?? e.liftType ?? "lift").replacingOccurrences(of: "_", with: " "))"
                    case .run: label = "Unnamed run"
                    }
                }
                let step = RouteStep(
                    type: type, label: label,
                    names: type == .run ? splitNames(info?.name) : [],
                    featureId: e.featureId, difficulty: type == .run ? e.difficulty : nil,
                    runKind: e.runKind, color: info?.color, liftType: e.liftType,
                    down: e.down, eleStart: e.coords.first?.ele ?? 0)
                step.key = key
                steps.append(step)
            }
            let step = steps[steps.count - 1]
            step.distance += e.length
            step.duration += edgeTime(e, o, sp)
            step.eleEnd = e.coords.last?.ele ?? 0
            for c in e.coords {
                if let last = step.coordinates.last, last.lon == c.lon, last.lat == c.lat { continue }
                step.coordinates.append(c)
            }
        }
        return tidySteps(steps)
    }

    private func splitNames(_ name: String?) -> [String] {
        guard let name, !name.isEmpty else { return [] }
        return name.components(separatedBy: ",").enumerated().map { idx, part in
            idx == 0 ? part : String(part.drop(while: { $0 == " " || $0 == "\t" }))
        }
    }
}

// MARK: - result types

public enum StepType: String, Sendable {
    case run, lift, walk
}

/// One thing to do on the mountain: a run, a lift ride or a walk, merged from the map's segments.
public final class RouteStep {
    public let type: StepType
    public var label: String
    var names: [String]
    public var featureId: String?
    public var difficulty: String?
    public var runKind: String?
    public var color: String?
    public var liftType: String?
    public var down: Bool
    public var distance: Double = 0
    public var duration: Double = 0
    public var eleStart: Double
    public var eleEnd: Double = 0
    public var coordinates: [Pt] = []
    public var leg: Int = 0
    var key: String = ""

    init(type: StepType, label: String, names: [String], featureId: String?, difficulty: String?, runKind: String?,
         color: String?, liftType: String?, down: Bool, eleStart: Double) {
        self.type = type
        self.label = label
        self.names = names
        self.featureId = featureId
        self.difficulty = difficulty
        self.runKind = runKind
        self.color = color
        self.liftType = liftType
        self.down = down
        self.eleStart = eleStart
    }

    var isRealRun: Bool { type == .run && runKind == "downhill" }
}

public struct RouteSummary: Sendable {
    public var distance = 0.0
    public var runDistance = 0.0
    public var liftCount = 0
    public var duration = 0.0
    public var descent = 0.0
    public var ascent = 0.0
    /// Hardest run difficulty that is outside the chosen difficulties (nil when all runs were allowed).
    public var hardest: String? = nil

    static func of(_ steps: [RouteStep]) -> RouteSummary {
        var s = RouteSummary()
        for x in steps {
            s.distance += x.distance
            s.duration += x.duration
            if x.type == .run {
                s.runDistance += x.distance
                s.descent += max(0, x.eleStart - x.eleEnd)
            }
            if x.type == .lift {
                s.liftCount += 1
                if !x.down { s.ascent += max(0, x.eleEnd - x.eleStart) }
            }
        }
        return s
    }
}

public struct LegSummary: Sendable {
    public let index: Int
    public let from: String
    public let to: String
    public let summary: RouteSummary
}

public struct RouteResult {
    public let steps: [RouteStep]
    public let legs: [LegSummary]
    public let warnings: [String]
    public let summary: RouteSummary
    public let coordinates: [Pt]
    /// The route points after snapping to the network (A, B, C…).
    public let snapped: [Pt]
}

// MARK: - helpers

/// OpenStreetMap often splits one signed piste into several sections. Turn the raw per-section steps into what
/// you would follow on the mountain. A harder piece or a change in difficulty always stays its own step.
private let tinyRun = 80.0 // m
private let tinyLink = 60.0 // m

private func tidySteps(_ raw: [RouteStep]) -> [RouteStep] {
    func isRun(_ s: RouteStep?) -> Bool {
        guard let s else { return false }
        return s.type == .run && (s.runKind == "downhill" || s.runKind == "connection")
    }
    func isPiste(_ s: RouteStep?) -> Bool {
        guard let s else { return false }
        return s.type == .run && s.runKind == "downhill"
    }
    func isTinyLink(_ s: RouteStep) -> Bool {
        (s.runKind == "connector" || s.type == .walk) && s.distance < tinyLink
    }
    func isTinyUnnamed(_ s: RouteStep) -> Bool {
        isPiste(s) && s.names.isEmpty && s.distance < tinyRun
    }
    func sharesName(_ a: RouteStep, _ b: RouteStep) -> Bool {
        a.names.contains { b.names.contains($0) }
    }
    func append(_ into: RouteStep, _ s: RouteStep) {
        into.distance += s.distance
        into.duration += s.duration
        into.eleEnd = s.eleEnd
        into.coordinates.append(contentsOf: s.coordinates.dropFirst())
    }
    func prepend(_ into: RouteStep, _ s: RouteStep) {
        into.distance += s.distance
        into.duration += s.duration
        into.eleStart = s.eleStart
        into.coordinates = s.coordinates + Array(into.coordinates.dropFirst())
    }

    let steps = raw.filter { !($0.type == .walk && $0.distance < 3) }
    for s in steps where s.runKind == "connector" { s.label = "Short connection" }

    // 1. merge forward into the previous step
    var out: [RouteStep] = []
    for s in steps {
        guard let prev = out.last else {
            out.append(s)
            continue
        }
        let samePiste = isRun(prev) && isRun(s) && prev.runKind == s.runKind
            && prev.difficulty == s.difficulty && (prev.label == s.label || sharesName(prev, s))
        if samePiste {
            // prefer the plain piste name over a combined "A, B" section name
            if prev.names.count > 1 && s.names.count == 1 {
                prev.label = s.label
                prev.names = s.names
            }
            append(prev, s)
        } else if isPiste(prev) && isTinyUnnamed(s) && level(s.difficulty) <= level(prev.difficulty) {
            append(prev, s)
        } else if isPiste(prev) && isPiste(s) && s.distance < 30 && level(s.difficulty) <= level(prev.difficulty) {
            append(prev, s) // tiny section of another piste
        } else if isRun(prev) && isTinyLink(s) {
            append(prev, s)
        } else if (prev.runKind == "connector" || prev.type == .walk) && (s.runKind == "connector" || s.type == .walk) {
            prev.label = "Short connection"
            append(prev, s)
        } else {
            out.append(s)
        }
    }

    // 1b. an unnamed piece between two sections of the same piste belongs to that piste
    var i = out.count - 2
    while i >= 1 {
        let a = out[i - 1]
        let mid = out[i]
        let b = out[i + 1]
        let sandwiched = isPiste(a) && isPiste(b) && isPiste(mid) && mid.names.isEmpty
            && a.difficulty == b.difficulty && (a.label == b.label || sharesName(a, b))
            && level(mid.difficulty) <= level(a.difficulty) && mid.distance < 600
        if sandwiched {
            append(a, mid)
            append(a, b)
            out.removeSubrange(i...(i + 1))
        }
        i -= 1
    }

    // 2. fold leftover tiny connectors / unnamed pieces into the run that follows (e.g. after a lift)
    i = out.count - 2
    while i >= 0 {
        let s = out[i]
        let next = out[i + 1]
        let fold = isRun(next) && (isTinyLink(s) || (isTinyUnnamed(s) && level(s.difficulty) <= level(next.difficulty)))
        if fold {
            prepend(next, s)
            out.remove(at: i)
        }
        i -= 1
    }
    return out
}

/// Minimal binary heap with the same ordering behaviour as the JavaScript version.
struct MinHeap {
    private var items: [Int] = []
    private var prio: [Double] = []

    var count: Int { items.count }

    mutating func push(_ item: Int, _ p: Double) {
        items.append(item)
        prio.append(p)
        var i = items.count - 1
        while i > 0 {
            let parent = (i - 1) >> 1
            if prio[parent] <= prio[i] { break }
            items.swapAt(i, parent)
            prio.swapAt(i, parent)
            i = parent
        }
    }

    mutating func pop() -> (Int, Double)? {
        guard !items.isEmpty else { return nil }
        let top = (items[0], prio[0])
        let lastItem = items.removeLast()
        let lastPrio = prio.removeLast()
        if !items.isEmpty {
            items[0] = lastItem
            prio[0] = lastPrio
            var i = 0
            while true {
                let l = 2 * i + 1
                let r = l + 1
                var m = i
                if l < items.count && prio[l] < prio[m] { m = l }
                if r < items.count && prio[r] < prio[m] { m = r }
                if m == i { break }
                items.swapAt(i, m)
                prio.swapAt(i, m)
                i = m
            }
        }
        return top
    }
}
