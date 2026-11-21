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

extension KeyedDecodingContainer {
    /// The value, or nil when it is missing, null or of another type: one odd field never breaks a resort file.
    func lenient<T: Decodable>(_ type: T.Type, _ key: Key) -> T? {
        (try? decodeIfPresent(type, forKey: key)) ?? nil
    }
}

/// A ski area a run or lift belongs to.
public struct SkiAreaRef: Decodable, Sendable, Hashable {
    public let id: String
    public let name: String?
}

/// Country, region and locality of a feature (OpenSkiData `places`).
public struct PlaceInfo: Decodable, Sendable, Hashable {
    public let country: String?
    public let region: String?
    public let locality: String?
}

public struct RunProps: Decodable, Sendable {
    public let id: FlexString?
    public let name: String?
    public let ref: String?
    public let label: String?
    public let kind: String?
    public let difficulty: String?
    public let color: String?
    public let oneway: Bool?
    public let status: String?
    public let grooming: String?
    public let lit: Bool?
    public let snowmaking: Bool?
    public let patrolled: Bool?
    public let gladed: Bool?
    public let skiAreas: [SkiAreaRef]?
    public let place: PlaceInfo?

    private enum CodingKeys: String, CodingKey {
        case id, name, ref, label, kind, difficulty, color, oneway, status
        case grooming, lit, snowmaking, patrolled, gladed, skiAreas, place
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(FlexString.self, .id)
        name = c.lenient(String.self, .name)
        ref = c.lenient(String.self, .ref)
        label = c.lenient(String.self, .label)
        kind = c.lenient(String.self, .kind)
        difficulty = c.lenient(String.self, .difficulty)
        color = c.lenient(String.self, .color)
        oneway = c.lenient(Bool.self, .oneway)
        status = c.lenient(String.self, .status)
        grooming = c.lenient(String.self, .grooming)
        lit = c.lenient(Bool.self, .lit)
        snowmaking = c.lenient(Bool.self, .snowmaking)
        patrolled = c.lenient(Bool.self, .patrolled)
        gladed = c.lenient(Bool.self, .gladed)
        skiAreas = c.lenient([SkiAreaRef].self, .skiAreas)
        place = c.lenient(PlaceInfo.self, .place)
    }
}

public struct LiftProps: Decodable, Sendable {
    public let id: FlexString?
    public let name: String?
    public let label: String?
    public let liftType: String?
    public let oneway: Bool?
    /// Ride time in seconds.
    public let duration: Double?
    public let status: String?
    public let stations: [LiftStation]?
    /// Persons per hour.
    public let capacity: Double?
    /// Seats per chair or cabin.
    public let occupancy: Double?
    public let bubble: Bool?
    public let heating: Bool?
    /// "up", "both" or "unknown" (see liftDirection in scripts/lib/ski.mjs).
    public let direction: String?
    public let skiAreas: [SkiAreaRef]?
    public let place: PlaceInfo?

    private enum CodingKeys: String, CodingKey {
        case id, name, label, liftType, oneway, duration, status, stations
        case capacity, occupancy, bubble, heating, direction, skiAreas, place
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(FlexString.self, .id)
        name = c.lenient(String.self, .name)
        label = c.lenient(String.self, .label)
        liftType = c.lenient(String.self, .liftType)
        oneway = c.lenient(Bool.self, .oneway)
        duration = c.lenient(Double.self, .duration)
        status = c.lenient(String.self, .status)
        stations = c.lenient([LiftStation].self, .stations)
        capacity = c.lenient(Double.self, .capacity)
        occupancy = c.lenient(Double.self, .occupancy)
        bubble = c.lenient(Bool.self, .bubble)
        heating = c.lenient(Bool.self, .heating)
        direction = c.lenient(String.self, .direction)
        skiAreas = c.lenient([SkiAreaRef].self, .skiAreas)
        place = c.lenient(PlaceInfo.self, .place)
    }
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
    /// For lift stations: the lift they belong to.
    public let liftId: FlexString?

    private enum CodingKeys: String, CodingKey { case id, label, name, spotType, liftId }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(FlexString.self, .id)
        label = c.lenient(String.self, .label)
        name = c.lenient(String.self, .name)
        spotType = c.lenient(String.self, .spotType)
        liftId = c.lenient(FlexString.self, .liftId)
    }
}

public struct Place: Decodable, Sendable, Hashable {
    public let name: String
    public let kind: String
    public let coordinates: [Double]
    public let elevation: Double?
}
