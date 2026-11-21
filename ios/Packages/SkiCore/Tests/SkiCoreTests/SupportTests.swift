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

final class LineStatsTests: XCTestCase {
    /// About 111 m due north, dropping 50 m.
    private let run = [Pt(lon: 10.0, lat: 47.0, ele: 1000), Pt(lon: 10.0, lat: 47.001, ele: 950)]

    func testRunStatistics() {
        let stats = lineStats(run, isLift: false)
        let horizontal = haversine(run[0], run[1])
        XCTAssertEqual(stats.horizontalLength, horizontal, accuracy: 0.01)
        XCTAssertEqual(stats.length, hypot(horizontal, 50), accuracy: 0.01)
        XCTAssertEqual(stats.vertical, 50)
        XCTAssertEqual(stats.descent, 50)
        XCTAssertEqual(stats.ascent, 0)
        XCTAssertEqual(stats.avgSlope ?? 0, 50 / horizontal, accuracy: 1e-9)
        XCTAssertEqual(stats.maxSlope ?? 0, 50 / horizontal, accuracy: 1e-9)
        XCTAssertEqual(stats.profile.count, 81)
        XCTAssertEqual(stats.profile.first?.elevation, 1000)
        XCTAssertEqual(stats.profile.last?.elevation ?? 0, 950, accuracy: 1e-9)
        XCTAssertNil(stats.duration)
    }

    func testLiftIsDescribedBottomToTopWithSpeeds() {
        let stats = lineStats(run, isLift: true, duration: 60)
        XCTAssertEqual(stats.eleStart, 950)
        XCTAssertEqual(stats.eleEnd, 1000)
        XCTAssertEqual(stats.speed ?? 0, stats.length / 60, accuracy: 1e-9)
        XCTAssertEqual(stats.verticalSpeed ?? 0, 50, accuracy: 1e-9) // 50 m in one minute
    }

    func testLineWithoutElevationHasOnlyLengths() {
        let flat = run.map { Pt(lon: $0.lon, lat: $0.lat) }
        let stats = lineStats(flat, isLift: false)
        XCTAssertEqual(stats.length, stats.horizontalLength)
        XCTAssertNil(stats.vertical)
        XCTAssertTrue(stats.profile.isEmpty)
    }
}

final class FeatureLookupTests: XCTestCase {
    func testFindsRunsAndLiftsByID() throws {
        let resort = try RoutingTests().loadResort()
        let lookup = FeatureLookup(resort)
        XCTAssertEqual(lookup.run(id: "r2")?.properties.label, "Red run")
        XCTAssertEqual(lookup.lift(id: "l1")?.properties.duration, 300)
        XCTAssertNil(lookup.run(id: "l1"))
    }
}
