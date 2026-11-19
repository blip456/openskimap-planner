import SkiCore
import SwiftUI

/// The Route panel: route points, summary, warnings, directions per leg and the way into the route settings.
struct RouteSheet: View {
    @ObservedObject var model: PlannerModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    pointsSection
                    if let error = model.routeError {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                            .font(.callout)
                    }
                    if let result = model.result {
                        SummaryGrid(summary: result.summary)
                        ForEach(result.warnings, id: \.self) { warning in
                            Label(warning, systemImage: "info.circle")
                                .font(.callout)
                                .foregroundStyle(.orange)
                        }
                        directions(result)
                    }
                    GlassNavigationRow(title: "Route settings", systemImage: "slider.horizontal.3") {
                        RouteSettingsView(model: model)
                    }
                }
                .padding()
            }
            .navigationTitle(model.resort?.name ?? "Ski route")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if let url = model.gpxURL {
                        ShareLink(item: url) {
                            Label("Export GPX", systemImage: "square.and.arrow.up")
                        }
                    }
                }
            }
        }
    }

    private var pointsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.openRouteName.isEmpty ? "Route" : model.openRouteName)
                        .font(.headline)
                    if model.hasUnsavedChanges {
                        Text("Changed since you saved it")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }
                Spacer()
                Button("Reverse") { model.reversePoints() }
                    .disabled(model.points.count < 2)
                Button("Clear", role: .destructive) { model.clearPoints() }
                    .disabled(model.points.isEmpty)
            }
            if model.points.isEmpty {
                Text("Tap the map to set the start, then the destination. Tap more to add stops.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            ForEach(Array(model.points.enumerated()), id: \.offset) { i, p in
                HStack {
                    Text(pointLetter(i))
                        .font(.caption.bold())
                        .foregroundStyle(.white)
                        .frame(width: 26, height: 26)
                        .background(Circle().fill(RoutePointRole(index: i, count: model.points.count).color))
                    Text(String(format: "%.5f, %.5f", p.lat, p.lon))
                        .font(.callout.monospacedDigit())
                    Spacer()
                    Button {
                        model.removePoint(at: i)
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove point \(pointLetter(i))")
                }
            }
        }
    }

    private func directions(_ result: RouteResult) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Directions").font(.headline)
            ForEach(result.legs, id: \.index) { leg in
                DisclosureGroup {
                    ForEach(Array(result.steps.enumerated()), id: \.offset) { _, step in
                        if step.leg == leg.index { StepRow(step: step) }
                    }
                } label: {
                    HStack {
                        Text("\(leg.from) → \(leg.to)").bold()
                        Spacer()
                        Text("\(formatDistance(leg.summary.distance)) · \(formatDuration(leg.summary.duration))")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}

private struct SummaryGrid: View {
    let summary: RouteSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Summary").font(.headline)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 8) {
                stat("Distance", formatDistance(summary.distance))
                stat("Time", formatDuration(summary.duration))
                stat("Descent", "\(Int(summary.descent.rounded())) m")
                stat("Ascent", "\(Int(summary.ascent.rounded())) m")
                stat("Lifts", "\(summary.liftCount)")
                stat("Runs", formatDistance(summary.runDistance))
            }
        }
    }

    private func stat(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.callout.bold())
        }
    }
}

private struct StepRow: View {
    let step: RouteStep

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            icon.frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.callout)
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder private var icon: some View {
        switch step.type {
        case .lift:
            Image(systemName: step.down ? "arrow.down" : "cablecar").foregroundStyle(.purple)
        case .walk:
            Image(systemName: "figure.walk").foregroundStyle(.gray)
        case .run:
            Image(systemName: "figure.skiing.downhill").foregroundStyle(PisteLabels.color(of: step.difficulty))
        }
    }

    private var title: String {
        step.type == .lift ? (step.down ? "Ride down: " : "Take lift: ") + step.label : step.label
    }

    private var subtitle: String {
        var parts: [String] = []
        if step.type == .run, let difficulty = step.difficulty { parts.append(PisteLabels.name(of: difficulty)) }
        parts.append(formatDistance(step.distance))
        parts.append(formatDuration(step.duration))
        return parts.joined(separator: " · ")
    }
}
