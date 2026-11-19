import SwiftUI

/// Map display choices: what is drawn on the ski map and how runs are coloured.
struct DisplaySettingsView: View {
    @ObservedObject var model: PlannerModel

    var body: some View {
        Form {
            Section {
                Toggle("Ski runs", isOn: $model.display.showRuns)
                Toggle("Lifts", isOn: $model.display.showLifts)
                Toggle("Cross-country", isOn: $model.display.showCrossCountry)
                Toggle("Touring & sled", isOn: $model.display.showTouring)
            } header: {
                Text("Show")
            }

            Section {
                Picker("Run colours", selection: $model.display.steepness) {
                    Text("Official difficulty").tag(false)
                    Text("Steepness").tag(true)
                }
                .pickerStyle(.inline)
                .labelsHidden()
            } header: {
                Text("Run colours")
            } footer: {
                if model.display.steepness {
                    SteepnessLegend()
                }
            }

            Section {
                Toggle("Ski areas in colour", isOn: $model.display.skiAreasInColour)
                Toggle("Route arrows", isOn: $model.display.routeArrows)
                Toggle("Route distances", isOn: $model.display.routeDistances)
            } header: {
                Text("Extra")
            }

            Section {
                Toggle("3D terrain", isOn: $model.show3D)
            } header: {
                Text("Terrain")
            } footer: {
                Text("Tilts the map to show the mountains. The elevation data is on the phone.")
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Map display")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Colour key for the steepness colouring, same classes as the web planner.
private struct SteepnessLegend: View {
    private let classes: [(String, Color)] = [
        ("< 10%", .green),
        ("10–25%", Color(red: 0.31, green: 0.52, blue: 0.88)),
        ("25–40%", Color(red: 0.90, green: 0.30, blue: 0.27)),
        ("> 40%", Color(white: 0.2)),
    ]

    var body: some View {
        HStack(spacing: 12) {
            ForEach(classes, id: \.0) { label, colour in
                HStack(spacing: 4) {
                    RoundedRectangle(cornerRadius: 3).fill(colour).frame(width: 12, height: 12)
                    Text(label)
                }
            }
        }
        .padding(.top, 4)
    }
}
