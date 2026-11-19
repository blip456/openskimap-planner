// swift-tools-version:5.9
import PackageDescription

// Pure Swift routing core: no UIKit / MapLibre, so it can be tested with `swift test` on macOS.
let package = Package(
    name: "SkiCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "SkiCore", targets: ["SkiCore"]),
        .executable(name: "skicore-route", targets: ["skicore-route"]),
    ],
    targets: [
        .target(name: "SkiCore"),
        .executableTarget(name: "skicore-route", dependencies: ["SkiCore"]),
        .testTarget(name: "SkiCoreTests", dependencies: ["SkiCore"]),
    ]
)
