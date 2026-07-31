//
//  ContentView.swift
//  VibeCoder
//
//  Tab shell for the redesigned 2.0 app. Auth is optional — users can
//  browse and read every lesson without signing in. There is no paid
//  tier: everything in the catalog is free.
//

import SwiftUI

struct ContentView: View {
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            CatalogView()
                .tabItem { Label("Lessons", systemImage: "book.closed.fill") }
                .tag(0)

            BuildHomeView()
                .tabItem { Label("Build", systemImage: "sparkles") }
                .tag(1)

            ReplitStyleAccountView()
                .tabItem { Label("Account", systemImage: "person.circle") }
                .tag(2)
        }
        .preferredColorScheme(.dark)
        .onAppear {
            let appearance = UITabBarAppearance()
            appearance.configureWithOpaqueBackground()
            appearance.backgroundColor = UIColor.black
            UITabBar.appearance().standardAppearance = appearance
            UITabBar.appearance().scrollEdgeAppearance = appearance
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(AuthManager.shared)
}
