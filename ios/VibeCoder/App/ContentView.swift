//
//  ContentView.swift
//  VibeCoder
//
//  Tab shell for the redesigned 2.0 app. Auth is optional — users can
//  browse and read every lesson without signing in. Sign-in only gates
//  the optional Pro subscription perks (saved favorites, ad-free, etc.)
//  on the Account tab.
//

import SwiftUI

struct ContentView: View {
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            CatalogView()
                .tabItem { Label("Lessons", systemImage: "book.closed.fill") }
                .tag(0)

            ReplitStyleAccountView()
                .tabItem { Label("Account", systemImage: "person.circle") }
                .tag(1)
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
        .environmentObject(SubscriptionManager.shared)
}
