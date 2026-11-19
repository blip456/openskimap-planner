// Command-line router used to check the Swift port against planner/graph.mjs.
//
//   skicore-route <planner.json> '<points JSON: [[lon,lat],...]>' ['<options JSON>']
//
// Prints one JSON object with the summary, warnings and the number of steps/track points.
import Foundation
import SkiCore

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("usage: skicore-route <planner.json> '<points>' ['<options>']\n".data(using: .utf8)!)
    exit(2)
}

let resort = try JSONDecoder().decode(ResortData.self, from: Data(contentsOf: URL(fileURLWithPath: args[1])))
let network = SkiNetwork(resort: resort)

let pointArray = try JSONSerialization.jsonObject(with: Data(args[2].utf8)) as? [[Double]] ?? []
let points = pointArray.map { Pt(lon: $0[0], lat: $0[1]) }

var options = PlanOptions()
if args.count > 3,
   let o = try JSONSerialization.jsonObject(with: Data(args[3].utf8)) as? [String: Any] {
    if let v = o["difficulties"] as? [String] { options.difficulties = v }
    if let v = o["harderRuns"] as? String { options.useHarderRunsIfNeeded = v == "fallback" }
    if let v = o["preferEasier"] as? Bool { options.preferEasier = v }
    if let v = o["liftGroups"] as? [String] { options.liftGroups = v }
    if let v = o["avoidDragLifts"] as? Bool { options.avoidDragLifts = v }
    if let v = o["liftDown"] as? Bool { options.liftDown = v }
    if let v = o["liftDownGroups"] as? [String] { options.liftDownGroups = v }
    if let v = o["includeConnections"] as? Bool { options.includeConnections = v }
    if let v = o["linkDistance"] as? Double { options.linkDistance = v }
    if let v = o["liftWait"] as? Double { options.liftWait = v }
    if let v = o["speeds"] as? [String: Double] { options.speeds = v }
}

do {
    let r = try network.route(points: points, options: options)
    let out: [String: Any] = [
        "distance": r.summary.distance,
        "duration": r.summary.duration,
        "runDistance": r.summary.runDistance,
        "descent": r.summary.descent,
        "ascent": r.summary.ascent,
        "liftCount": r.summary.liftCount,
        "hardest": r.summary.hardest ?? NSNull(),
        "steps": r.steps.count,
        "stepLabels": r.steps.map { "\($0.type.rawValue):\($0.label)" },
        "stepDistances": r.steps.map { ($0.distance * 10).rounded() / 10 },
        "warnings": r.warnings,
        "trackPoints": r.coordinates.count,
    ]
    let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys, .prettyPrinted])
    print(String(decoding: data, as: UTF8.self))
} catch let e as RouteError {
    print(try! String(decoding: JSONSerialization.data(withJSONObject: ["error": e.message], options: [.sortedKeys]), as: UTF8.self))
}
