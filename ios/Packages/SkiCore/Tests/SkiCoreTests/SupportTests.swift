import XCTest
@testable import SkiCore

final class DistanceMarkerTests: XCTestCase {
    /// About 1.1 km due north (0.01° of latitude).
    private let shortRoute = [Pt(lon: 10.0, lat: 47.0), Pt(lon: 10.0, lat: 47.01)]

    func testSpacingGrowsWithRouteLength() {
        XCTAssertEqual(distanceMarkerSpacing(routeLength: 1_500), 100)
        XCTAssertEqual(distanceMarkerSpacing(routeLength: 4_000), 250)
        XCTAssertEqual(distanceMarkerSpacing(routeLength: 12_000), 500)
        XCTAssertEqual(distanceMarkerSpacing(routeLength: 40_000), 1_000)
    }

    func testMarkersAreEvenlySpacedAlongTheLine() {
        let markers = distanceMarkers(along: shortRoute)
        let length = haversine(shortRoute[0], shortRoute[1])
        XCTAssertEqual(markers.count, Int(length / 100))
        XCTAssertEqual(markers.map(\.distance), (1...markers.count).map { Double($0) * 100 })
        // the 500 m marker lies 500 m from the start
        XCTAssertEqual(haversine(shortRoute[0], markers[4].position), 500, accuracy: 0.5)
    }

    func testNoMarkersWithoutALine() {
        XCTAssertTrue(distanceMarkers(along: []).isEmpty)
        XCTAssertTrue(distanceMarkers(along: [Pt(lon: 10, lat: 47)]).isEmpty)
    }
}

final class PlanOptionsCodingTests: XCTestCase {
    func testRoundTrip() throws {
        var options = PlanOptions()
        options.difficulties = ["easy", "intermediate"]
        options.liftDown = true
        options.speeds = SpeedPreset.confident.speeds
        let decoded = try JSONDecoder().decode(PlanOptions.self, from: JSONEncoder().encode(options))
        XCTAssertEqual(decoded, options)
    }

    /// Routes saved before an option existed must still open, with the new option at its default.
    func testMissingKeysUseDefaults() throws {
        let decoded = try JSONDecoder().decode(PlanOptions.self, from: Data(#"{"difficulties":["novice"]}"#.utf8))
        var expected = PlanOptions()
        expected.difficulties = ["novice"]
        XCTAssertEqual(decoded, expected)
    }
}
