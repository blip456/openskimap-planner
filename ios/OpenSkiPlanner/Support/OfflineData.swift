import Foundation
import SkiCore

/// Locates the offline data that `npm run ios:export` copied into the app bundle.
enum OfflineData {
    enum DataError: LocalizedError {
        case missing(String)
        case noResorts

        var errorDescription: String? {
            switch self {
            case .missing(let what):
                return "Offline map data is missing (\(what)). Run `npm run build` and `npm run ios:export`, then rebuild the app."
            case .noResorts:
                return "The offline data contains no resorts."
            }
        }
    }

    /// `Offline/` folder inside the app bundle.
    static func root() throws -> URL {
        guard let url = Bundle.main.url(forResource: "Offline", withExtension: nil) else {
            throw DataError.missing("Offline folder")
        }
        return url
    }

    static func plannerDirectory() throws -> URL {
        try root().appendingPathComponent("planner", isDirectory: true)
    }

    /// Copies the bundled style to Caches with every `__BUNDLE__` replaced by the real bundle path, so MapLibre can
    /// read the PMTiles, fonts and sprites from `file://` URLs. The bundle path changes on every install.
    static func localStyleURL(named name: String) throws -> URL {
        let source = try root().appendingPathComponent("styles/\(name).json")
        let text = try String(contentsOf: source, encoding: .utf8)
        let localized = text.replacingOccurrences(of: "__BUNDLE__", with: Bundle.main.bundlePath)
        let caches = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let target = caches.appendingPathComponent("\(name).json")
        try localized.write(to: target, atomically: true, encoding: .utf8)
        return target
    }
}
