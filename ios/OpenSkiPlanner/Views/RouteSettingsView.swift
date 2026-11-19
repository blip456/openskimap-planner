import SkiCore
import SwiftUI

/// Route settings as a native grouped form, with the run filter laid out like the web planner's.
struct RouteSettingsView: View {
    @ObservedObject var model: PlannerModel

    var body: some View {
        Form {
            Section {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 14) {
                    ForEach(PisteLabels.difficulties, id: \.self) { difficulty in
                        RunCheckbox(difficulty: difficulty,
                                    isOn: model.options.difficulties.contains(difficulty)) { allowed in
                            model.setDifficulty(difficulty, allowed: allowed)
                        }
                    }
                }
                .padding(.vertical, 4)
            } header: {
                Text("Runs")
            } footer: {
                Text("Runs you are allowed to ski.")
            }

            Section("Routing") {
                Toggle("Prefer easier runs", isOn: $model.options.preferEasier)
                Toggle("Use ski paths (connections)", isOn: $model.options.includeConnections)
            }

            Section("No route found?") {
                Picker("No route found?", selection: $model.options.useHarderRunsIfNeeded) {
                    Text("Use harder runs (with a warning)").tag(true)
                    Text("Show no route").tag(false)
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }

            Section("Lifts") {
                ForEach(PisteLabels.liftGroups, id: \.key) { group in
                    Toggle(group.name, isOn: Binding(
                        get: { model.options.liftGroups.contains(group.key) },
                        set: { model.setLiftGroup(group.key, allowed: $0) }))
                }
                Toggle("Avoid drag lifts", isOn: $model.options.avoidDragLifts)
                Toggle("Allow riding lifts down", isOn: $model.options.liftDown)
                Stepper(value: $model.options.liftWait, in: 0...600, step: 30) {
                    LabeledContent("Waiting per lift", value: "\(Int(model.options.liftWait)) s")
                }
            }

            Section {
                Picker("Skiing level", selection: speedPreset) {
                    ForEach(SpeedPreset.allCases, id: \.self) { preset in
                        Text(preset.label).tag(preset)
                    }
                }
                .pickerStyle(.segmented)
            } header: {
                Text("Speed")
            } footer: {
                Text("Sets the average speed used for times and for choosing between runs.")
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .navigationTitle("Route settings")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// The preset matching the current speeds, so a saved route opened with "Confident" speeds shows that preset.
    private var speedPreset: Binding<SpeedPreset> {
        Binding(
            get: { SpeedPreset(matching: model.options.speeds) ?? .beginner },
            set: { model.options.speeds = $0.speeds })
    }
}

/// Checkbox with the run colour, like the web planner's run filter.
private struct RunCheckbox: View {
    let difficulty: String
    let isOn: Bool
    let onChange: (Bool) -> Void

    var body: some View {
        Button {
            onChange(!isOn)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: isOn ? "checkmark.square.fill" : "square")
                    .font(.title3)
                    .foregroundStyle(isOn ? Color.accentColor : Color.secondary)
                RoundedRectangle(cornerRadius: 4)
                    .fill(PisteLabels.color(of: difficulty))
                    .frame(width: 16, height: 16)
                Text(PisteLabels.shortName(of: difficulty))
                    .foregroundStyle(.primary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(PisteLabels.name(of: difficulty))
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}
