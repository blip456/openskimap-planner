import Foundation
import OSLog
import SkiCore
import SwiftUI

/// Everything the app shows: resort data, route points, options and the computed route.
/// All data comes from the app bundle (`Offline/`), so the app never needs a network connection.
@MainActor
final class PlannerModel: ObservableObject {
    enum LoadState: Equatable {
        case loading
        case ready
        case failed(String)
    }

    @Published private(set) var state: LoadState = .loading
    @Published private(set) var resort: ResortData?

    /// Route points in the order you set them (A, B, C…).
    @Published private(set) var points: [Pt] = []
    @Published var options = PlanOptions() {
        didSet { recalculate() }
    }
    @Published private(set) var result: RouteResult?
    @Published private(set) var routeError: String?
    /// The current route as a GPX file in the temporary folder (for the share sheet); nil without a route.
    @Published private(set) var gpxURL: URL?

    /// Set when the map should fly somewhere (search results).
    @Published var focus: Pt?
    @Published var show3D = false
    @Published var display = DisplaySettings.load() {
        didSet { display.save() }
    }

    /// Saved routes and the one currently open from them.
    let store = SavedRouteStore()
    @Published private(set) var openRouteID: UUID?
    @Published private(set) var openRouteName = ""

    private var network: SkiNetwork?
    private var searchIndex: [SearchHit] = []
    /// Earlier route points, newest last (undo).
    private var history: [[Pt]] = []
    private let historyLimit = 50

    var canUndo: Bool { !history.isEmpty }

    /// True when the open saved route differs from the route on the map.
    var hasUnsavedChanges: Bool {
        guard let id = openRouteID, let saved = store.route(id: id) else { return false }
        return saved.points != points || saved.options != options
    }

    // MARK: - loading

    func load() async {
        guard state == .loading else { return }
        do {
            let dir = try OfflineData.plannerDirectory()
            let index = try JSONDecoder().decode([ResortIndexEntry].self,
                                                 from: Data(contentsOf: dir.appendingPathComponent("resorts.json")))
            guard let first = index.first else { throw OfflineData.DataError.noResorts }
            let data = try Data(contentsOf: dir.appendingPathComponent("\(first.id).json"))
            // decoding and building the graph takes a moment for big resorts; keep the UI responsive
            let (resort, network, hits) = try await Task.detached(priority: .userInitiated) {
                let resort = try JSONDecoder().decode(ResortData.self, from: data)
                return (resort, SkiNetwork(resort: resort), SearchIndex.build(resort))
            }.value
            self.resort = resort
            self.network = network
            self.searchIndex = hits
            state = .ready
        } catch {
            Logger.app.error("Loading offline data failed: \(error)")
            state = .failed(error.localizedDescription)
        }
    }

    // MARK: - route points

    func addPoint(_ p: Pt) {
        changePoints { $0.append(p) }
    }

    func removePoint(at i: Int) {
        guard points.indices.contains(i) else { return }
        changePoints { $0.remove(at: i) }
    }

    func reversePoints() {
        guard points.count > 1 else { return }
        changePoints { $0.reverse() }
    }

    /// Clears the map for a new route; an open saved route is closed (not deleted).
    func clearPoints() {
        guard !points.isEmpty else { return }
        changePoints { $0.removeAll() }
        closeSavedRoute()
    }

    func undo() {
        guard let previous = history.popLast() else { return }
        points = previous
        recalculate()
    }

    private func changePoints(_ change: (inout [Pt]) -> Void) {
        history.append(points)
        if history.count > historyLimit { history.removeFirst() }
        change(&points)
        recalculate()
    }

    // MARK: - options

    func setDifficulty(_ difficulty: String, allowed: Bool) {
        options.difficulties.set(difficulty, included: allowed)
    }

    func setLiftGroup(_ group: String, allowed: Bool) {
        options.liftGroups.set(group, included: allowed)
    }

    // MARK: - saved routes

    func saveNew(name: String, folder: String) {
        guard points.count >= 2 else { return }
        let route = SavedRoute(id: UUID(), name: Self.cleanName(name), folder: Self.cleanFolder(folder),
                               resortId: resort?.id ?? "", points: points, options: options, updatedAt: Date())
        store.add(route)
        openRouteID = route.id
        openRouteName = route.name
    }

    /// Updates the open saved route with the route on the map.
    func saveChanges() {
        guard let id = openRouteID, var route = store.route(id: id) else { return }
        route.points = points
        route.options = options
        route.updatedAt = Date()
        store.update(route)
    }

    func open(_ route: SavedRoute) {
        history = []
        points = route.points
        options = route.options // recalculates the route
        openRouteID = route.id
        openRouteName = route.name
    }

    func delete(_ route: SavedRoute) {
        store.delete(id: route.id)
        if openRouteID == route.id { closeSavedRoute() }
    }

    private func closeSavedRoute() {
        openRouteID = nil
        openRouteName = ""
    }

    private static func cleanName(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Route \(Date().formatted(date: .abbreviated, time: .shortened))" : trimmed
    }

    private static func cleanFolder(_ folder: String) -> String {
        let trimmed = folder.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? SavedRoute.defaultFolder : trimmed
    }

    // MARK: - search

    func search(_ query: String, limit: Int) -> [SearchHit] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return [] }
        return Array(searchIndex.lazy.filter { $0.matches(q) }.prefix(limit))
    }

    // MARK: - routing

    /// Routing runs synchronously: a resort network routes in milliseconds, so the result is always in step with
    /// the points and options on screen.
    private func recalculate() {
        guard let network, points.count >= 2 else {
            result = nil
            routeError = nil
            gpxURL = nil
            return
        }
        do {
            let route = try network.route(points: points, options: options)
            result = route
            routeError = nil
            gpxURL = writeGPX(route)
        } catch {
            result = nil
            routeError = error.localizedDescription
            gpxURL = nil
        }
    }

    private func writeGPX(_ route: RouteResult) -> URL? {
        let name = "\(resort?.name ?? "Ski") route"
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(name.replacingOccurrences(of: "/", with: "-"))
            .appendingPathExtension("gpx")
        do {
            try routeToGpx(name: name, result: route).write(to: url, atomically: true, encoding: .utf8)
            return url
        } catch {
            Logger.app.error("Writing GPX failed: \(error)")
            return nil
        }
    }
}
