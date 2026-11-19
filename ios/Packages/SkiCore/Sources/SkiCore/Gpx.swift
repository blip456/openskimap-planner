import Foundation

/// GPX 1.1 export: track with elevation, a waypoint per route point (A, B, C…) and one per lift and run.
/// Port of toGpx() in planner/graph.mjs.
public func routeToGpx(name: String, result: RouteResult) -> String {
    func esc(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&apos;")
    }
    func pt(_ tag: String, _ c: Pt, _ inner: String = "") -> String {
        let ele = c.ele != 0 ? "<ele>\(String(format: "%.1f", c.ele))</ele>" : ""
        return "<\(tag) lat=\"\(String(format: "%.7f", c.lat))\" lon=\"\(String(format: "%.7f", c.lon))\">\(ele)\(inner)</\(tag)>"
    }

    let last = result.snapped.count - 1
    let pointWpts = result.snapped.enumerated().map { i, c -> String in
        let role = i == 0 ? " (start)" : (i == last ? " (destination)" : "")
        return pt("wpt", c, "<name>\(esc("\(pointLetter(i))\(role)"))</name><type>route point</type>")
    }

    var counters: [Int: Int] = [:]
    var wpts: [String] = []
    for s in result.steps where s.type != .walk && s.runKind != "connector" {
        let n = (counters[s.leg] ?? 0) + 1
        counters[s.leg] = n
        let what: String
        if s.type == .lift {
            what = "\(s.down ? "Ride down" : "Take lift"): \(s.label)"
        } else {
            what = "Run: \(s.label)\(s.difficulty.map { " (\($0))" } ?? "")"
        }
        let leg = "\(pointLetter(s.leg))→\(pointLetter(s.leg + 1))"
        if let first = s.coordinates.first {
            wpts.append(pt("wpt", first, "<name>\(esc("\(leg) \(n). \(what)"))</name><type>\(s.type.rawValue)</type>"))
        }
    }

    var lines: [String] = [
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<gpx version=\"1.1\" creator=\"OpenSki Planner (iOS)\" xmlns=\"http://www.topografix.com/GPX/1/1\">",
        "<metadata><name>\(esc(name))</name><desc>Data: OpenSkiData / OpenSkiMap.org, © OpenStreetMap contributors (ODbL)</desc></metadata>",
    ]
    lines += pointWpts
    lines += wpts
    lines.append("<trk><name>\(esc(name))</name><type>skiing</type><trkseg>")
    lines += result.coordinates.map { pt("trkpt", $0) }
    lines.append("</trkseg></trk>")
    lines.append("</gpx>")
    return lines.joined(separator: "\n") + "\n"
}
