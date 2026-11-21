import MapLibre
import SkiCore
import SwiftUI
import UIKit

/// What a tap on the map hit.
enum MapTap {
    /// A run, lift or lift station of the ski map (its OpenSkiData id) and the tapped spot.
    case feature(id: String, at: Pt)
    /// Anywhere else.
    case empty(Pt)
}

/// The offline map: MapLibre Native showing the bundled ski map (PMTiles, no network), the route and its points.
struct MapCanvas: UIViewRepresentable {
    @ObservedObject var model: PlannerModel
    /// Called for every tap on the map.
    var onTap: (MapTap) -> Void
    /// Each change centres the map on the GPS position and follows it.
    var locateRequest = 0

    func makeCoordinator() -> Coordinator {
        Coordinator(onTap: onTap)
    }

    func makeUIView(context: Context) -> MLNMapView {
        let styleName = Self.styleName(for: model.display)
        let map = MLNMapView(frame: .zero, styleURL: try? OfflineData.localStyleURL(named: styleName))
        map.delegate = context.coordinator
        map.automaticallyAdjustsContentInset = false
        map.logoView.isHidden = true
        if let bbox = model.resort?.bbox, bbox.count == 4 {
            map.setCenter(CLLocationCoordinate2D(latitude: (bbox[1] + bbox[3]) / 2, longitude: (bbox[0] + bbox[2]) / 2),
                          zoomLevel: 12, animated: false)
        }
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        tap.delegate = context.coordinator
        map.addGestureRecognizer(tap)
        context.coordinator.map = map
        context.coordinator.styleName = styleName
        return map
    }

    func updateUIView(_ map: MLNMapView, context: Context) {
        let coordinator = context.coordinator
        coordinator.onTap = onTap
        if locateRequest != coordinator.lastLocateRequest {
            coordinator.lastLocateRequest = locateRequest
            map.showsUserLocation = true
            map.userTrackingMode = .follow
        }
        coordinator.render(model)
    }

    /// The difficulty and steepness colourings are separate styles (`ios:export` copies both).
    static func styleName(for display: DisplaySettings) -> String {
        display.steepness ? "ski-basemap-steepness" : "ski-basemap"
    }

    // MARK: - coordinator

    final class Coordinator: NSObject, MLNMapViewDelegate, UIGestureRecognizerDelegate {
        var onTap: (MapTap) -> Void
        weak var map: MLNMapView?
        var styleName = ""
        var lastLocateRequest = 0

        /// Our sources and layers exist only once the style has loaded; until then `render` just remembers the model.
        private var styleReady = false
        private var model: PlannerModel?
        private var lastShow3D = false
        private var lastFocus: Pt?
        private var lastPointCount = 0

        init(onTap: @escaping (MapTap) -> Void) {
            self.onTap = onTap
        }

        @objc func handleTap(_ gesture: UITapGestureRecognizer) {
            guard let map, gesture.state == .ended else { return }
            let point = gesture.location(in: map)
            let c = map.convert(point, toCoordinateFrom: map)
            let tapped = Pt(lon: c.longitude, lat: c.latitude)
            if let id = featureId(near: point, on: map) {
                onTap(.feature(id: id, at: tapped))
            } else {
                onTap(.empty(tapped))
            }
        }

        /// Id of the run, lift or lift station under the finger. A fingertip is wide, so the search box is too;
        /// run areas (polygons) are left out, otherwise every tap inside a piste area would hit.
        private func featureId(near point: CGPoint, on map: MLNMapView) -> String? {
            guard let style = map.style else { return nil }
            let layers = Set(style.layers.map(\.identifier).filter {
                ($0.hasPrefix(MapIDs.skiRunPrefix) || $0.hasPrefix(MapIDs.skiLiftPrefix)) && $0 != MapIDs.skiRunAreas
            })
            let box = CGRect(x: point.x - 14, y: point.y - 14, width: 28, height: 28)
            return map.visibleFeatures(in: box, styleLayerIdentifiers: layers)
                .lazy.compactMap { $0.attribute(forKey: "id") as? String }.first
        }

        /// Taps must not block the map's own pan and zoom gestures.
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            true
        }

        /// Runs on every style load, including after switching between the difficulty and steepness styles.
        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            styleReady = true
            style.addRouteLayers()
            if let resortId = model?.resort?.id, let dir = try? OfflineData.plannerDirectory() {
                style.addSkiAreaLayers(directory: dir, resortId: resortId)
            }
            if let model { render(model) }
        }

        // MARK: rendering the model

        func render(_ model: PlannerModel) {
            self.model = model
            guard let map else { return }

            let wanted = MapCanvas.styleName(for: model.display)
            if wanted != styleName {
                styleName = wanted
                styleReady = false
                if let url = try? OfflineData.localStyleURL(named: wanted) { map.styleURL = url }
                return // continues in mapView(_:didFinishLoading:)
            }
            guard styleReady, let style = map.style else { return }

            style.apply(model.display)
            renderRoute(model, in: style)
            updateCamera(model, on: map)
        }

        private func renderRoute(_ model: PlannerModel, in style: MLNStyle) {
            let coords = model.result?.coordinates ?? []

            if let source = style.source(withIdentifier: MapIDs.selectionSource) as? MLNShapeSource {
                if let line = model.selection?.line, line.count > 1 {
                    var coordinates = line.map(\.coordinate)
                    source.shape = MLNPolylineFeature(coordinates: &coordinates, count: UInt(coordinates.count))
                } else {
                    source.shape = MLNShapeCollectionFeature(shapes: [])
                }
            }

            if let source = style.source(withIdentifier: MapIDs.routeLineSource) as? MLNShapeSource {
                if coords.count > 1 {
                    var line = coords.map(\.coordinate)
                    source.shape = MLNPolylineFeature(coordinates: &line, count: UInt(line.count))
                } else {
                    source.shape = MLNShapeCollectionFeature(shapes: [])
                }
            }

            if let source = style.source(withIdentifier: MapIDs.routeDistancesSource) as? MLNShapeSource {
                let markers = distanceMarkers(along: coords).map { marker in
                    point(at: marker.position, ["label": formatMarkerDistance(marker.distance)])
                }
                source.shape = MLNShapeCollectionFeature(shapes: markers)
            }

            if let source = style.source(withIdentifier: MapIDs.routePointsSource) as? MLNShapeSource {
                let points = model.points.enumerated().map { i, p in
                    point(at: p, ["role": RoutePointRole(index: i, count: model.points.count).rawValue,
                                  "letter": pointLetter(i)])
                }
                source.shape = MLNShapeCollectionFeature(shapes: points)
            }
        }

        private func point(at p: Pt, _ attributes: [String: Any]) -> MLNShape {
            let feature = MLNPointFeature()
            feature.coordinate = p.coordinate
            feature.attributes = attributes
            return feature
        }

        private func updateCamera(_ model: PlannerModel, on map: MLNMapView) {
            if model.show3D != lastShow3D {
                lastShow3D = model.show3D
                let camera = map.camera
                camera.pitch = model.show3D ? 60 : 0
                map.setCamera(camera, withDuration: 0.6, animationTimingFunction: nil)
            }

            if let focus = model.focus, focus != lastFocus {
                lastFocus = focus
                map.setCenter(focus.coordinate, zoomLevel: 15, animated: true)
            }

            // zoom to the whole route when a point is added (not when one is removed or the route is reversed)
            if model.points.count != lastPointCount {
                let added = model.points.count > lastPointCount
                lastPointCount = model.points.count
                if added, let coords = model.result?.coordinates, coords.count > 1 {
                    fit(coords, on: map)
                }
            }
        }

        private func fit(_ coords: [Pt], on map: MLNMapView) {
            let lats = coords.map(\.lat)
            let lons = coords.map(\.lon)
            let bounds = MLNCoordinateBounds(
                sw: CLLocationCoordinate2D(latitude: lats.min()!, longitude: lons.min()!),
                ne: CLLocationCoordinate2D(latitude: lats.max()!, longitude: lons.max()!))
            // bottom inset keeps the route clear of the panel bar and a half-open panel
            map.setVisibleCoordinateBounds(bounds, edgePadding: UIEdgeInsets(top: 80, left: 40, bottom: 320, right: 40),
                                           animated: true, completionHandler: nil)
        }
    }
}

private extension Pt {
    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
}
