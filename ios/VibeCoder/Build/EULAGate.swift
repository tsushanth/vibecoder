//
//  EULAGate.swift
//  VibeCoder
//
//  First-build EULA modal. Apple's UGC guidelines (1.2) require an explicit
//  acceptance step before users can generate content that the platform
//  hosts. We store acceptance in UserDefaults so it's shown exactly once.
//

import SwiftUI

@MainActor
enum EULAStore {
    static let key = "vb_build_eula_accepted_v1"
    static var hasAccepted: Bool {
        get { UserDefaults.standard.bool(forKey: key) }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }
}

struct EULAGate: View {
    let onAccept: () -> Void
    let onDecline: () -> Void

    @Environment(\.dismiss) private var dismiss

    private let accent = Color(red: 1.0, green: 0.59, blue: 0.0)

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                Image(systemName: "sparkles")
                    .font(.system(size: 22))
                    .foregroundColor(accent)
                Text("Before You Build")
                    .font(.title2.weight(.bold))
                    .foregroundColor(.white)
                Spacer()
            }
            .padding(.top, 24)
            .padding(.horizontal, 24)
            .padding(.bottom, 16)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    bullet("VibeBuild generates personal web projects from your prompts. They're private to your account — not published publicly.")
                    bullet("You're responsible for the content of your prompts and the projects you generate.")
                    bullet("Don't request content that violates Apple's App Store guidelines: hate speech, sexual content, violence, harassment, illegal activity, or anything that infringes on others' rights or trademarks.")
                    bullet("Projects run in our sandboxed in-app browser. They can't install software, access your device data, or take payments.")
                    bullet("We may remove projects that violate these terms.")

                    Text("By tapping I Agree you accept these terms and our [Terms of Use](https://vibebuild.cc/terms) and [Privacy Policy](https://vibebuild.cc/privacy).")
                        .font(.system(size: 13))
                        .foregroundColor(.white.opacity(0.6))
                        .padding(.top, 8)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 16)
            }

            VStack(spacing: 10) {
                Button {
                    EULAStore.hasAccepted = true
                    onAccept()
                    dismiss()
                } label: {
                    Text("I Agree")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(RoundedRectangle(cornerRadius: 12).fill(accent))
                }

                Button {
                    onDecline()
                    dismiss()
                } label: {
                    Text("Not Now")
                        .font(.callout)
                        .foregroundColor(.white.opacity(0.6))
                        .padding(.vertical, 8)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.ignoresSafeArea())
        .preferredColorScheme(.dark)
    }

    @ViewBuilder
    private func bullet(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "circle.fill")
                .font(.system(size: 5))
                .foregroundColor(accent)
                .padding(.top, 8)
            Text(text)
                .font(.system(size: 15))
                .foregroundColor(.white.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
