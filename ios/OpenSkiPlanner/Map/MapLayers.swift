import Foundation
import MapLibre
import UIKit

/// Sources and layers the app adds on top of the bundled ski style, and the ski style layers it toggles.
enum MapIDs {
    static let routeLineSource = "route-line"
    static let routePointsSource = "route-points"
    static let routeDistancesSource = "route-distances"

    static let routeLine = "route-line-layer"
    static let routeArrows = "route-arrows"
    static let routeDistanceLabels = "route-distance-labels"
    static let routePointDots = "route-points-circle"
    static let routePointLetters = "route-points-letter"

    /// Layers of the ski style (scripts/lib/styles.mjs): runs start with `ski-run`, lifts with `ski-lift`.
    static let skiRunPrefix = "ski-run"
    static let skiLiftPrefix = "ski-lift"
    static let skiRunAreas = "ski-run-areas"
    static let crossCountryRuns = "ski-runs-nordic"
    static let touringRuns = "ski-runs-other"

    /// Ski areas in colour, from `<resort>.areas|halos|labels.geojson` (scripts/export-ios.mjs).
    static let skiAreaPrefix = "ski-area"
}

private let routeOrange = UIColor(red: 1.0, green: 0.42, blue: 0.0, alpha: 1)
private let labelFont = NSExpression(forConstantValue: ["Noto Sans Bold"])

extension MLNStyle {
    /// Route line with direction arrows, distance labels and the lettered route points (empty until a route exists).
    func addRouteLayers() {
        let empty = MLNShapeCollectionFeature(shapes: [])
        let line = MLNShapeSource(identifier: MapIDs.routeLineSource, shape: empty, options: nil)
        let points = MLNShapeSource(identifier: MapIDs.routePointsSource, shape: empty, options: nil)
        let distances = MLNShapeSource(identifier: MapIDs.routeDistancesSource, shape: empty, options: nil)
        [line, points, distances].forEach(addSource)

        let lineLayer = MLNLineStyleLayer(identifier: MapIDs.routeLine, source: line)
        lineLayer.lineColor = NSExpression(forConstantValue: routeOrange)
        lineLayer.lineWidth = NSExpression(forConstantValue: 6)
        lineLayer.lineCap = NSExpression(forConstantValue: "round")
        lineLayer.lineJoin = NSExpression(forConstantValue: "round")
        addLayer(lineLayer)

        let arrows = MLNSymbolStyleLayer(identifier: MapIDs.routeArrows, source: line)
        arrows.text = NSExpression(forConstantValue: "›")
        arrows.textFontNames = labelFont
        arrows.textFontSize = NSExpression(forConstantValue: 18)
        arrows.textColor = NSExpression(forConstantValue: UIColor.white)
        arrows.textHaloColor = NSExpression(forConstantValue: routeOrange)
        arrows.textHaloWidth = NSExpression(forConstantValue: 2)
        arrows.symbolPlacement = NSExpression(forConstantValue: "line")
        arrows.symbolSpacing = NSExpression(forConstantValue: 90)
        arrows.textAllowsOverlap = NSExpression(forConstantValue: true)
        addLayer(arrows)

        let distanceLabels = MLNSymbolStyleLayer(identifier: MapIDs.routeDistanceLabels, source: distances)
        distanceLabels.text = NSExpression(forKeyPath: "label")
        distanceLabels.textFontNames = labelFont
        distanceLabels.textFontSize = NSExpression(forConstantValue: 11)
        distanceLabels.textColor = NSExpression(forConstantValue: UIColor(white: 0.15, alpha: 1))
        distanceLabels.textHaloColor = NSExpression(forConstantValue: UIColor.white)
        distanceLabels.textHaloWidth = NSExpression(forConstantValue: 2)
        distanceLabels.textAllowsOverlap = NSExpression(forConstantValue: true)
        addLayer(distanceLabels)

        let dots = MLNCircleStyleLayer(identifier: MapIDs.routePointDots, source: points)
        dots.circleColor = NSExpression(mglJSONObject: [
            "match", ["get", "role"],
            RoutePointRole.start.rawValue, RoutePointRole.start.hex,
            RoutePointRole.end.rawValue, RoutePointRole.end.hex,
            RoutePointRole.stop.hex,
        ])
        dots.circleRadius = NSExpression(forConstantValue: 12)
        dots.circleStrokeColor = NSExpression(forConstantValue: UIColor.white)
        dots.circleStrokeWidth = NSExpression(forConstantValue: 2)
        addLayer(dots)

        let letters = MLNSymbolStyleLayer(identifier: MapIDs.routePointLetters, source: points)
        letters.text = NSExpression(forKeyPath: "letter")
        letters.textFontNames = labelFont
        letters.textFontSize = NSExpression(forConstantValue: 12)
        letters.textColor = NSExpression(forConstantValue: UIColor.white)
        letters.textAllowsOverlap = NSExpression(forConstantValue: true)
        addLayer(letters)
    }

    /// Ski areas in colour: a tinted outline per area, a halo around its runs and lifts, and its name.
    /// Fill, outline and halo go under the runs; the names on top of everything.
    func addSkiAreaLayers(directory: URL, resortId: String) {
        func source(_ suffix: String) -> MLNShapeSource {
            let url = directory.appendingPathComponent("\(resortId).\(suffix).geojson")
            let source = MLNShapeSource(identifier: "\(MapIDs.skiAreaPrefix)-\(suffix)", url: url, options: nil)
            addSource(source)
            return source
        }
        let areas = source("areas")
        let halos = source("halos")
        let labels = source("labels")
        let areaColor = NSExpression(mglJSONObject: ["get", "color"])

        let fill = MLNFillStyleLayer(identifier: "\(MapIDs.skiAreaPrefix)-fill", source: areas)
        fill.fillColor = areaColor
        fill.fillOpacity = NSExpression(forConstantValue: 0.12)

        let outline = MLNLineStyleLayer(identifier: "\(MapIDs.skiAreaPrefix)-outline", source: areas)
        outline.lineColor = areaColor
        outline.lineWidth = NSExpression(forConstantValue: 2)

        let halo = MLNLineStyleLayer(identifier: "\(MapIDs.skiAreaPrefix)-halo", source: halos)
        halo.lineColor = NSExpression(mglJSONObject: ["get", "halo"])
        halo.lineWidth = NSExpression(forConstantValue: 6)
        halo.lineCap = NSExpression(forConstantValue: "round")

        let names = MLNSymbolStyleLayer(identifier: "\(MapIDs.skiAreaPrefix)-label", source: labels)
        names.text = NSExpression(forKeyPath: "name")
        names.textFontNames = labelFont
        names.textFontSize = NSExpression(forConstantValue: 13)
        names.textColor = areaColor
        names.textHaloColor = NSExpression(forConstantValue: UIColor.white)
        names.textHaloWidth = NSExpression(forConstantValue: 2)

        for layer in [fill, outline, halo] {
            if let runs = self.layer(withIdentifier: MapIDs.skiRunAreas) {
                insertLayer(layer, below: runs)
            } else {
                addLayer(layer)
            }
        }
        addLayer(names)
    }

    /// Shows or hides layers to match the display settings.
    func apply(_ display: DisplaySettings) {
        for layer in layers {
            if let visible = Self.visibility(of: layer.identifier, display) {
                layer.isVisible = visible
            }
        }
    }

    /// nil for layers the display settings do not control (basemap, terrain, route line and points).
    private static func visibility(of id: String, _ display: DisplaySettings) -> Bool? {
        switch id {
        case MapIDs.crossCountryRuns: return display.showCrossCountry
        case MapIDs.touringRuns: return display.showTouring
        case MapIDs.routeArrows: return display.routeArrows
        case MapIDs.routeDistanceLabels: return display.routeDistances
        case _ where id.hasPrefix(MapIDs.skiAreaPrefix): return display.skiAreasInColour
        case _ where id.hasPrefix(MapIDs.skiRunPrefix): return display.showRuns
        case _ where id.hasPrefix(MapIDs.skiLiftPrefix): return display.showLifts
        default: return nil
        }
    }
}
