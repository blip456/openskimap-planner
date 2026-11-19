import SkiCore
import SwiftUI

/// The Saved panel: save the route on the map, and open, update or delete saved routes, grouped by folder.
struct SavedRoutesView: View {
    @ObservedObject var model: PlannerModel
    @ObservedObject var store: SavedRouteStore
    @State private var name = ""
    @State private var folder = SavedRoute.defaultFolder

    var body: some View {
        Form {
            Section {
                currentRoute
            } header: {
                Text("Current route")
            } footer: {
                Text("Saved on this iPhone only. Open a route below to plan with it again.")
            }

            if store.routes.isEmpty {
                ContentUnavailableView("No saved routes", systemImage: "bookmark",
                                       description: Text("Routes you save appear here, grouped by folder."))
            }

            ForEach(store.folders, id: \.self) { folderName in
                let routes = store.routes(in: folderName)
                if !routes.isEmpty {
                    Section(folderName) {
                        ForEach(routes) { route in
                            Button {
                                model.open(route)
                            } label: {
                                RouteRow(route: route, isOpen: route.id == model.openRouteID)
                            }
                            .buttonStyle(.plain)
                            .swipeActions {
                                Button(role: .destructive) {
                                    model.delete(route)
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Saved routes")
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder private var currentRoute: some View {
        if model.points.count < 2 {
            Text("Plan a route with a start and a destination to save it.")
                .foregroundStyle(.secondary)
        } else if model.openRouteID == nil {
            TextField("Name", text: $name)
            TextField("Folder", text: $folder)
            Button("Save route") {
                model.saveNew(name: name, folder: folder)
                name = ""
            }
        } else {
            LabeledContent("Open route", value: model.openRouteName)
            if model.hasUnsavedChanges {
                Label("Changed since you saved it", systemImage: "pencil.circle")
                    .foregroundStyle(.orange)
            }
            Button("Save changes") { model.saveChanges() }
                .disabled(!model.hasUnsavedChanges)
            TextField("Name for a copy", text: $name)
            TextField("Folder", text: $folder)
            Button("Save as new route") {
                model.saveNew(name: name.isEmpty ? "\(model.openRouteName) copy" : name, folder: folder)
                name = ""
            }
        }
    }
}

private struct RouteRow: View {
    let route: SavedRoute
    let isOpen: Bool

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(route.name)
                Text("\(route.points.count) points · \(route.updatedAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if isOpen {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .accessibilityLabel("Open")
            }
        }
        .contentShape(Rectangle())
    }
}
