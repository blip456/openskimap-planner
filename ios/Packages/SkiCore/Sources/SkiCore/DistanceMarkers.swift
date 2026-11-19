import Foundation

/// A point on the route at a round distance from the start (shown as "500 m", "1 km", … on the map).
public struct DistanceMarker: Equatable, Sendable {
    public let position: Pt
    /// Metres from the start of the route.
    public let distance: Double
}

/// Spacing between distance markers: every 100 m, 250 m, 500 m or 1 km, growing with the route length
/// (same steps as the web planner).
public func distanceMarkerSpacing(routeLength: Double) -> Double {
    switch routeLength {
    case ..<2_000: return 100
    case ..<5_000: return 250
    case ..<20_000: return 500
    default: return 1_000
    }
}

/// Markers at every multiple of the spacing along the route line.
public func distanceMarkers(along coords: [Pt]) -> [DistanceMarker] {
    guard coords.count > 1 else { return [] }
    let segments = zip(coords, coords.dropFirst()).map { (a: $0, b: $1, length: haversine($0, $1)) }
    let spacing = distanceMarkerSpacing(routeLength: segments.reduce(0) { $0 + $1.length })

    var markers: [DistanceMarker] = []
    var travelled = 0.0
    var next = spacing
    for (a, b, length) in segments where length > 0 {
        while travelled + length >= next {
            let t = (next - travelled) / length
            let position = Pt(lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t)
            markers.append(DistanceMarker(position: position, distance: next))
            next += spacing
        }
        travelled += length
    }
    return markers
}
