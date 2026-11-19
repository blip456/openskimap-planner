import XCTest
@testable import SkiCore

/// Builds a tiny resort in JSON (same shape as build/planner/<id>.json) and routes through it.
final class RoutingTests: XCTestCase {
    static let resortJSON = """
    {
      "id": "test", "name": "Test", "bbox": [10.0, 47.0, 10.1, 47.1],
      "runs": [
        {"type":"Feature","geometry":{"type":"LineString","coordinates":[[10.000,47.000,1000],[10.000,47.0045,950]]},
         "properties":{"id":"r1","label":"Easy run","kind":"downhill","difficulty":"easy","oneway":true,"status":"operating","color":"#1f6fd6","name":"Easy run"}},
        {"type":"Feature","geometry":{"type":"LineString","coordinates":[[10.000,47.0045,950],[10.000,47.009,900]]},
         "properties":{"id":"r2","label":"Red run","kind":"downhill","difficulty":"intermediate","oneway":true,"status":"operating","color":"#d8251d","name":"Red run, Extra"}}
      ],
      "runAreas": [],
      "lifts": [
        {"type":"Feature","geometry":{"type":"LineString","coordinates":[[10.000,47.000,1000],[10.000,47.009,900]]},
         "properties":{"id":"l1","label":"Gondola One","liftType":"gondola","oneway":true,"duration":300,"status":"operating",
           "stations":[{"coordinates":[10.000,47.000,1000],"name":"Bottom"},{"coordinates":[10.000,47.009,900],"name":"Top"}]}}
      ],
      "spots": [],
      "places": [{"name":"Hut","kind":"hut","coordinates":[10.05,47.05],"elevation":1500}]
    }
    """

    func loadResort() throws -> ResortData {
        try JSONDecoder().decode(ResortData.self, from: Data(Self.resortJSON.utf8))
    }

    func testDecodesResort() throws {
        let r = try loadResort()
        XCTAssertEqual(r.runs.count, 2)
        XCTAssertEqual(r.lifts.count, 1)
        XCTAssertEqual(r.runs[0].coordinates.count, 2)
        XCTAssertEqual(r.lifts[0].properties.stations?.count, 2)
    }

    func testRoutesDownhillFromTopToBottomOnlyWithAllowedRuns() throws {
        let net = SkiNetwork(resort: try loadResort())
        // gondola up, then the easy run down; red run is not allowed by default (novice + easy)
        var options = PlanOptions()
        options.useHarderRunsIfNeeded = false
        let start = Pt(lon: 10.000, lat: 47.000, ele: 1000)
        let end = Pt(lon: 10.000, lat: 47.0045, ele: 950)
        let result = try net.route(points: [start, end], options: options)
        XCTAssertEqual(result.steps.count, 1)
        XCTAssertEqual(result.steps[0].type, .run)
        XCTAssertEqual(result.steps[0].label, "Easy run")
        XCTAssertGreaterThan(result.summary.distance, 400)
    }

    func testLiftAndRunRouteWithGpx() throws {
        let net = SkiNetwork(resort: try loadResort())
        var options = PlanOptions()
        options.difficulties = ["novice", "easy", "intermediate"]
        options.liftGroups = ["gondola"]
        // the gondola is drawn top → bottom in the data; the network orients it uphill (bottom at 47.009, 900 m),
        // so going from 47.009 up to 47.000 must take the lift
        let result = try net.route(points: [Pt(lon: 10.000, lat: 47.009, ele: 900),
                                            Pt(lon: 10.000, lat: 47.000, ele: 1000)], options: options)
        XCTAssertTrue(result.steps.contains { $0.type == .lift && !$0.down })
        XCTAssertGreaterThan(result.summary.ascent, 0, "lift should climb")
        let gpx = routeToGpx(name: "test", result: result)
        XCTAssertTrue(gpx.contains("<trkpt"))
        XCTAssertTrue(gpx.contains("Take lift: Gondola One"))
    }

    func testPointFarFromNetworkIsRejected() throws {
        let net = SkiNetwork(resort: try loadResort())
        XCTAssertThrowsError(try net.route(points: [Pt(lon: 10.5, lat: 47.5), Pt(lon: 10.0, lat: 47.0)]))
    }

    func testPointLetters() {
        XCTAssertEqual(pointLetter(0), "A")
        XCTAssertEqual(pointLetter(25), "Z")
        XCTAssertEqual(pointLetter(26), "AA")
    }
}
