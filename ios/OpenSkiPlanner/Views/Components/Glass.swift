import SwiftUI

extension View {
    /// Liquid Glass on iOS 26 and later, a thin material with a light border on older systems.
    func glassBackground<S: Shape>(in shape: S) -> some View {
        modifier(GlassBackground(shape: AnyShape(shape)))
    }
}

private struct GlassBackground: ViewModifier {
    let shape: AnyShape

    // `AnyView` keeps the two availability branches one type; a generic `some View` with `#available`
    // crashes the Swift 6.4 type checker.
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            return AnyView(content.glassEffect(.regular.interactive(), in: shape))
        }
        return AnyView(content
            .background(.ultraThinMaterial, in: shape)
            .overlay(shape.stroke(.white.opacity(0.35), lineWidth: 0.5))
            .shadow(color: .black.opacity(0.15), radius: 8, y: 2))
    }
}

/// Round glass button with an icon and an optional short title ("3D").
struct GlassIconButton: View {
    let systemImage: String
    let accessibilityLabel: String
    var title: String?
    var isOn = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.system(size: 17, weight: .semibold))
                if let title {
                    Text(title).font(.system(size: 15, weight: .bold))
                }
            }
            .foregroundStyle(isOn ? Color.accentColor : Color.primary)
            .padding(.horizontal, title == nil ? 12 : 14)
            .frame(minWidth: 44, minHeight: 44)
            .glassBackground(in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }
}

/// A full-width glass row that opens another page in the panel's navigation stack.
struct GlassNavigationRow<Destination: View>: View {
    let title: String
    let systemImage: String
    @ViewBuilder let destination: () -> Destination

    var body: some View {
        NavigationLink(destination: destination) {
            HStack {
                Label(title, systemImage: systemImage)
                    .font(.headline)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(14)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .glassBackground(in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

/// Pressing shows a rounded pill behind the button and shrinks it a little; the selected button keeps a softer pill.
struct PillPressStyle: ButtonStyle {
    var selected = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background {
                if configuration.isPressed || selected {
                    Capsule().fill(Color.primary.opacity(configuration.isPressed ? 0.20 : 0.12))
                }
            }
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }
}
