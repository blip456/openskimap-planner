import SwiftUI

/// The panels opened from the bottom bar.
enum PlannerPanel: String, Identifiable {
    case route, saved, map
    var id: String { rawValue }
}

/// Full-screen offline map: search and map buttons on top, location button and the panel bar at the bottom.
struct ContentView: View {
    @ObservedObject var model: PlannerModel
    @State private var panel: PlannerPanel?
    @State private var searchOpen = false
    @State private var query = ""
    @FocusState private var searchFocused: Bool
    /// Incremented to ask the map to centre on the GPS position.
    @State private var locateRequest = 0

    private let searchResultLimit = 12

    var body: some View {
        switch model.state {
        case .loading:
            ProgressView("Loading offline map…")
        case .failed(let message):
            ContentUnavailableView("Offline data missing", systemImage: "exclamationmark.triangle",
                                   description: Text(message))
        case .ready:
            planner
        }
    }

    private var planner: some View {
        ZStack(alignment: .top) {
            MapCanvas(model: model, onTap: handleMapTap, locateRequest: locateRequest)
                .ignoresSafeArea()

            VStack(spacing: 8) {
                topBar
                if searchOpen, !query.isEmpty {
                    searchResults
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 8)
        }
        .overlay(alignment: .bottom) {
            // stacked, so the location button moves up when the error banner appears
            VStack(alignment: .trailing, spacing: 10) {
                locateButton
                    .padding(.trailing, 16)
                if let card = model.selection {
                    FeatureCardView(card: card,
                                    onAdd: { model.addSelectedSpot(as: $0) },
                                    onClose: { model.closeSelection() })
                        .id(card.id)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                } else if panel == nil, let error = model.routeError {
                    routeErrorBanner(error)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                panelBar
            }
            .animation(.spring(response: 0.35, dampingFraction: 0.85), value: model.routeError)
            .animation(.spring(response: 0.35, dampingFraction: 0.85), value: model.selection?.id)
        }
        .sheet(item: $panel) { panel in
            panelContent(panel)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground {
                    // each panel is one glass sheet, so the map shows through it
                    Color.clear
                        .glassBackground(in: RoundedRectangle(cornerRadius: 38, style: .continuous))
                        .ignoresSafeArea()
                }
        }
    }

    // MARK: - panel bar

    /// One long glass capsule with a button per panel; the open panel's button keeps a highlight pill.
    private var panelBar: some View {
        HStack(spacing: 0) {
            panelButton("Route", systemImage: "point.topleft.down.curvedto.point.bottomright.up", .route)
            panelButton("Saved", systemImage: "bookmark", .saved)
            panelButton("Map", systemImage: "map", .map)
        }
        .padding(6)
        .glassBackground(in: Capsule())
        .padding(.horizontal, 28)
        .padding(.bottom, 4)
    }

    private func panelButton(_ title: String, systemImage: String, _ target: PlannerPanel) -> some View {
        let selected = panel == target
        return Button {
            panel = target
        } label: {
            VStack(spacing: 3) {
                Image(systemName: systemImage)
                    .font(.system(size: 20, weight: .semibold))
                Text(title)
                    .font(.caption.weight(.semibold))
            }
            .foregroundStyle(selected ? Color.accentColor : Color.primary)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .contentShape(Capsule())
        }
        .buttonStyle(PillPressStyle(selected: selected))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    @ViewBuilder private func panelContent(_ panel: PlannerPanel) -> some View {
        switch panel {
        case .route:
            RouteSheet(model: model)
        case .saved:
            NavigationStack {
                SavedRoutesView(model: model, store: model.store)
            }
        case .map:
            NavigationStack {
                DisplaySettingsView(model: model)
            }
        }
    }

    /// Why the tapped points give no route (e.g. a point too far from any run), shown on the map itself.
    private func routeErrorBanner(_ message: String) -> some View {
        Button {
            panel = .route
        } label: {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.footnote.weight(.medium))
                .foregroundStyle(.primary)
                .multilineTextAlignment(.leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .glassBackground(in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 28)
    }

    // MARK: - location

    private var locateButton: some View {
        Button {
            locateRequest += 1
        } label: {
            Image(systemName: "location.fill")
                .font(.system(size: 19, weight: .semibold))
                .foregroundStyle(Color.accentColor)
                .frame(width: 52, height: 52)
                .glassBackground(in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Show my location")
    }

    // MARK: - top bar

    /// The search icon is a glass capsule that stretches to the right into the search field.
    private var topBar: some View {
        HStack(spacing: 10) {
            HStack(spacing: 0) {
                if searchOpen {
                    searchField
                } else {
                    Button(action: openSearch) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(.primary)
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Search")
                }
            }
            .frame(height: 44)
            .frame(maxWidth: searchOpen ? .infinity : 44, alignment: .leading)
            .glassBackground(in: Capsule())

            if !searchOpen {
                Spacer(minLength: 0)

                GlassIconButton(systemImage: "arrow.uturn.backward", accessibilityLabel: "Undo") {
                    model.undo()
                }
                .disabled(!model.canUndo)
                .opacity(model.canUndo ? 1 : 0.45)
                .transition(.opacity)

                GlassIconButton(systemImage: model.show3D ? "cube.fill" : "cube", accessibilityLabel: "3D terrain",
                                title: "3D", isOn: model.show3D) {
                    model.show3D.toggle()
                }
                .transition(.opacity)
            }
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.82), value: searchOpen)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.secondary)
            TextField("Runs, lifts, places", text: $query)
                .focused($searchFocused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .frame(maxWidth: .infinity)
            Button(action: closeSearch) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(.secondary)
                    .frame(width: 36, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close search")
        }
        .padding(.leading, 12)
        .padding(.trailing, 4)
        .transition(.opacity)
    }

    private var searchResults: some View {
        let hits = model.search(query, limit: searchResultLimit)
        return ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if hits.isEmpty {
                    Text("Nothing found for “\(query)”.")
                        .foregroundStyle(.secondary)
                        .padding(14)
                }
                ForEach(hits) { hit in
                    Button {
                        pick(hit)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(hit.name)
                                .foregroundStyle(.primary)
                            Text(hit.subtitle)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(maxHeight: 340)
        .glassBackground(in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    // MARK: - actions

    /// Like the web planner: a run or lift opens its info card; empty map adds a route point, or only closes an
    /// open card first.
    private func handleMapTap(_ tap: MapTap) {
        switch tap {
        case let .feature(id, spot):
            if !model.select(featureId: id, at: spot) { model.addPoint(spot) }
        case let .empty(spot):
            if model.selection != nil {
                model.closeSelection()
            } else {
                model.addPoint(spot)
            }
        }
    }

    private func openSearch() {
        searchOpen = true
        // focus once the capsule has started to stretch, so the keyboard does not interrupt the animation
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            searchFocused = true
        }
    }

    private func closeSearch() {
        searchFocused = false
        searchOpen = false
        query = ""
    }

    /// A search result becomes a route point and the map flies to it.
    private func pick(_ hit: SearchHit) {
        model.focus = hit.location
        model.addPoint(hit.location)
        closeSearch()
    }
}
