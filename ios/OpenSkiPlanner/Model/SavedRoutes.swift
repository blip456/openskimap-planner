import Foundation
import OSLog
import SkiCore

/// A route saved on the phone: its points and planner settings, grouped in a folder (like the web planner).
struct SavedRoute: Codable, Identifiable, Equatable {
    static let defaultFolder = "My routes"

    var id: UUID
    var name: String
    var folder: String
    /// Resort the route was planned in; kept so routes stay attributable once the app holds several regions.
    var resortId: String
    var points: [Pt]
    var options: PlanOptions
    var updatedAt: Date
}

/// Saved routes in one JSON file in Application Support. Nothing leaves the phone.
@MainActor
final class SavedRouteStore: ObservableObject {
    @Published private(set) var routes: [SavedRoute] = []
    private let fileURL: URL

    init(fileURL: URL = SavedRouteStore.defaultFileURL) {
        self.fileURL = fileURL
        routes = Self.load(from: fileURL)
    }

    nonisolated static var defaultFileURL: URL {
        let dir = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                appropriateFor: nil, create: true)) ?? FileManager.default.temporaryDirectory
        return dir.appendingPathComponent("saved-routes.json")
    }

    /// Folders in the order they were first used, always starting with the default folder.
    var folders: [String] {
        var seen = [SavedRoute.defaultFolder]
        for route in routes where !seen.contains(route.folder) { seen.append(route.folder) }
        return seen
    }

    func route(id: UUID) -> SavedRoute? {
        routes.first { $0.id == id }
    }

    /// Routes of one folder, most recently changed first.
    func routes(in folder: String) -> [SavedRoute] {
        routes.filter { $0.folder == folder }.sorted { $0.updatedAt > $1.updatedAt }
    }

    func add(_ route: SavedRoute) {
        routes.append(route)
        persist()
    }

    func update(_ route: SavedRoute) {
        guard let i = routes.firstIndex(where: { $0.id == route.id }) else { return }
        routes[i] = route
        persist()
    }

    func delete(id: UUID) {
        routes.removeAll { $0.id == id }
        persist()
    }

    private static func load(from url: URL) -> [SavedRoute] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        do {
            return try JSONDecoder().decode([SavedRoute].self, from: Data(contentsOf: url))
        } catch {
            // Never let the next save overwrite routes we could not read: keep the file aside.
            let backup = url.deletingPathExtension()
                .appendingPathExtension("unreadable-\(Int(Date().timeIntervalSince1970)).json")
            try? FileManager.default.moveItem(at: url, to: backup)
            Logger.app.error("Saved routes could not be read; kept as \(backup.lastPathComponent, privacy: .public): \(error)")
            return []
        }
    }

    private func persist() {
        do {
            try JSONEncoder().encode(routes).write(to: fileURL, options: .atomic)
        } catch {
            Logger.app.error("Saving routes failed: \(error)")
        }
    }
}
