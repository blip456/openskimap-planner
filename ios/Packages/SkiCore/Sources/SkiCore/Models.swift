import Foundation

/// Planner data for one resort, as written by `npm run build` (build/planner/<id>.json)
/// and copied into the app bundle by `scripts/export-ios.mjs`.
public struct ResortData: Decodable, Sendable {
    public let id: String
    public let name: String
    public let bbox: [Double]
    public let runs: [RunFeature]
    public let lifts: [LiftFeature]
    public let spots: [SpotFeature]
    public let places: [Place]
}

/// Entry of build/planner/resorts.json.
public struct ResortIndexEntry: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let bbox: [Double]
    public let center: [Double]
}

/// A GeoJSON feature whose geometry is a LineString (runs and lifts) or a Point (spots).
public struct LineFeature<Props: Decodable & Sendable>: Decodable, Sendable {
    public let coordinates: [Pt]
    public let properties: Props

    private enum CodingKeys: String, CodingKey { case geometry, properties }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let geom = try c.decode(RawGeometry.self, forKey: .geometry)
        coordinates = geom.points
        properties = try c.decode(Props.self, forKey: .properties)
    }
}

/// Accepts LineString (`[[lon,lat,ele]]`) and Point (`[lon,lat,ele]`) coordinates.
struct RawGeometry: Decodable {
    let type: String
    let points: [Pt]

    private enum CodingKeys: String, CodingKey { case type, coordinates }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = try c.decode(String.self, forKey: .type)
        if let line = try? c.decode([[Double]].self, forKey: .coordinates) {
            points = line.compactMap { Pt(position: $0) }
        } else if let single = try? c.decode([Double].self, forKey: .coordinates), let p = Pt(position: single) {
            points = [p]
        } else {
            points = []
        }
    }
}

public typealias RunFeature = LineFeature<RunProps>
public typealias LiftFeature = LineFeature<LiftProps>
public typealias SpotFeature = LineFeature<SpotProps>

/// Identifiers can be strings or numbers in the source data; keep them as strings.
public struct FlexString: Decodable, Hashable, Sendable {
    public let value: String

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { value = s }
        else if let i = try? c.decode(Int.self) { value = String(i) }
        else if let d = try? c.decode(Double.self) { value = String(d) }
        else { value = "" }
    }
}

public struct RunProps: Decodable, Sendable {
    public let id: FlexString?
    public let name: String?
    public let label: String?
    public let kind: String?
    public let difficulty: String?
    public let color: String?
    public let oneway: Bool?
    public let status: String?
}

public struct LiftProps: Decodable, Sendable {
    public let id: FlexString?
    public let name: String?
    public let label: String?
    public let liftType: String?
    public let oneway: Bool?
    public let duration: Double?
    public let status: String?
    public let stations: [LiftStation]?
}

public struct LiftStation: Decodable, Sendable {
    public let coordinates: [Double]?
    public let name: String?

    private enum CodingKeys: String, CodingKey { case coordinates, name, properties, geometry }

    public init(from decoder: Decoder) throws {
        // stations are GeoJSON points in the build: {geometry:{coordinates}, properties:{name}} or the flat form
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let geom = try? c.decode(PointGeometry.self, forKey: .geometry) {
            coordinates = geom.coordinates
        } else {
            coordinates = try? c.decode([Double].self, forKey: .coordinates)
        }
        if let props = try? c.decode(StationProps.self, forKey: .properties) {
            name = props.name
        } else {
            name = try? c.decode(String.self, forKey: .name)
        }
    }

    private struct PointGeometry: Decodable { let coordinates: [Double] }
    private struct StationProps: Decodable { let name: String? }
}

public struct SpotProps: Decodable, Sendable {
    public let id: FlexString?
    public let label: String?
    public let name: String?
    public let spotType: String?
}

public struct Place: Decodable, Sendable, Hashable {
    public let name: String
    public let kind: String
    public let coordinates: [Double]
    public let elevation: Double?
}
