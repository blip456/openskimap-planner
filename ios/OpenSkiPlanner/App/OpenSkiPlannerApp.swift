import SwiftUI

@main
struct OpenSkiPlannerApp: App {
    @StateObject private var model = PlannerModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .task { await model.load() }
        }
    }
}
