import Charts
import SkiCore
import SwiftUI

/// Glass info card of a tapped run or lift: key figures, elevation profile, facts, and buttons to use the
/// tapped spot as start, stop or destination.
struct FeatureCardView: View {
    let card: FeatureCard
    let onAdd: (RoutePointRole) -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            StatsRow(items: statItems)
            if card.stats.profile.count > 1 {
                ElevationProfile(profile: card.stats.profile, tint: tint)
                    .frame(height: 56)
            }
            if !card.facts.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(card.facts, id: \.self) { fact in
                            Text(fact)
                                .font(.caption.weight(.medium))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(Capsule().fill(Color.primary.opacity(0.08)))
                        }
                    }
                }
            }
            if let area = card.area {
                Text(area)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            actions
        }
        .padding(16)
        .glassBackground(in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .padding(.horizontal, 16)
    }

    private var tint: Color {
        card.kind == .lift ? .purple : PisteLabels.color(of: card.difficulty)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: card.kind == .lift ? "cablecar.fill" : "figure.skiing.downhill")
                .font(.title3.weight(.semibold))
                .foregroundStyle(tint)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(card.title)
                    .font(.headline)
                    .lineLimit(2)
                Text(card.subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Button(action: onClose) {
                Image(systemName: "xmark.circle.fill")
                    .font(.title2)
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
        }
    }

    private var statItems: [(String, String)] {
        let s = card.stats
        var items: [(String, String)] = [("Length", formatDistance(s.length))]
        if let vertical = s.vertical { items.append(("Vertical", "\(Int(vertical.rounded())) m")) }
        switch card.kind {
        case .run:
            if let avg = s.avgSlope { items.append(("Avg slope", percent(avg))) }
            if let max = s.maxSlope { items.append(("Steepest", percent(max))) }
        case .lift:
            if let duration = s.duration {
                items.append(("Ride", duration < 90 ? "\(Int(duration)) s" : formatDuration(duration)))
            }
            if let speed = s.speed { items.append(("Speed", String(format: "%.1f m/s", speed))) }
        }
        return items
    }

    private func percent(_ slope: Double) -> String {
        "\(Int((slope * 100).rounded())) %"
    }

    private var actions: some View {
        HStack(spacing: 8) {
            actionButton("Start", role: .start)
            actionButton("Stop", role: .stop)
            actionButton("Destination", role: .end)
        }
    }

    private func actionButton(_ title: String, role: RoutePointRole) -> some View {
        Button {
            onAdd(role)
        } label: {
            HStack(spacing: 6) {
                Circle().fill(role.color).frame(width: 10, height: 10)
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(.primary)
            .frame(maxWidth: .infinity)
            .frame(height: 40)
            .background(Capsule().fill(Color.primary.opacity(0.08)))
            .contentShape(Capsule())
        }
        .buttonStyle(PillPressStyle())
        .accessibilityLabel("Use as \(title.lowercased())")
    }
}

/// Up to four key figures side by side.
private struct StatsRow: View {
    let items: [(String, String)]

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(items.prefix(4).enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.0)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(item.1)
                        .font(.callout.weight(.semibold))
                        .monospacedDigit()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

/// Small elevation profile, scaled to the feature's own height range.
private struct ElevationProfile: View {
    let profile: [ProfilePoint]
    let tint: Color

    var body: some View {
        let elevations = profile.map(\.elevation)
        let low = elevations.min() ?? 0
        let high = max(elevations.max() ?? 1, low + 1)
        Chart(profile, id: \.distance) { point in
            AreaMark(x: .value("Distance", point.distance),
                     yStart: .value("Base", low),
                     yEnd: .value("Elevation", point.elevation))
                .foregroundStyle(tint.opacity(0.2))
            LineMark(x: .value("Distance", point.distance), y: .value("Elevation", point.elevation))
                .foregroundStyle(tint)
                .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
        }
        .chartYScale(domain: low...high)
        .chartXAxis(.hidden)
        .chartYAxis {
            AxisMarks(position: .trailing, values: [low, high]) { value in
                AxisValueLabel {
                    if let metres = value.as(Double.self) { Text("\(Int(metres.rounded())) m") }
                }
            }
        }
        .accessibilityLabel("Elevation profile from \(Int(elevations.first ?? 0)) m to \(Int(elevations.last ?? 0)) m")
    }
}
