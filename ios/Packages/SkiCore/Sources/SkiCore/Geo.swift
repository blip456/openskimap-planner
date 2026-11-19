import Foundation

/// A position: longitude, latitude and elevation in metres (0 when unknown).
public struct Pt: Hashable, Sendable, Codable {
    public var lon: Double
    public var lat: Double
    public var ele: Double

    public init(lon: Double, lat: Double, ele: Double = 0) {
        self.lon = lon
        self.lat = lat
        self.ele = ele
    }

    /// Builds a point from a GeoJSON position `[lon, lat, ele?]`.
    init?(position: [Double]) {
        guard position.count >= 2 else { return nil }
        self.init(lon: position[0], lat: position[1], ele: position.count > 2 ? position[2] : 0)
    }
}

private let earthRadius = 6_371_008.8

private func toRad(_ d: Double) -> Double { d * .pi / 180 }

/// Great-circle distance in metres (same formula as scripts/lib/geo.mjs).
public func haversine(_ a: Pt, _ b: Pt) -> Double {
    let dLat = toRad(b.lat - a.lat)
    let dLon = toRad(b.lon - a.lon)
    let s = pow(sin(dLat / 2), 2) + cos(toRad(a.lat)) * cos(toRad(b.lat)) * pow(sin(dLon / 2), 2)
    return 2 * earthRadius * asin(min(1, sqrt(s)))
}

/// Route points are lettered A, B, C… like the markers in the UI.
public func pointLetter(_ i: Int) -> String {
    if i < 26 { return String(UnicodeScalar(UInt8(65 + i))) }
    let first = String(UnicodeScalar(UInt8(64 + i / 26)))
    let second = String(UnicodeScalar(UInt8(65 + i % 26)))
    return first + second
}
