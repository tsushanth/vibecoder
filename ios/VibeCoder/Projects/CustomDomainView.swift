import SwiftUI

struct CustomDomainView: View {
    let projectId: String
    @EnvironmentObject var authManager: AuthManager

    @State private var domain = ""
    @State private var deploymentId: String?
    @State private var domainStatus: DomainStatusResponse?
    @State private var isLoading = false
    @State private var isVerifying = false
    @State private var isRemoving = false
    @State private var errorMessage: String?
    @State private var successMessage: String?
    @State private var cnameTarget: String?
    @State private var verificationToken: String?

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    if isLoading {
                        ProgressView("Loading...")
                            .tint(.white)
                            .padding(.top, 60)
                    } else if let status = domainStatus, status.hasDomain {
                        existingDomainSection(status)
                    } else {
                        addDomainSection
                    }
                }
                .padding()
            }
            .background(Color.black.ignoresSafeArea())
            .navigationTitle("Custom Domain")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Done") { dismiss() }
                        .foregroundColor(.blue)
                }
            }
            .onAppear { loadDomainStatus() }
        }
    }

    // MARK: - Add Domain Section

    private var addDomainSection: some View {
        VStack(alignment: .leading, spacing: 20) {
            // Header
            VStack(alignment: .leading, spacing: 8) {
                Label("Connect Your Domain", systemImage: "globe")
                    .font(.title3)
                    .fontWeight(.semibold)
                    .foregroundColor(.white)

                Text("Use your own domain instead of the default vibebuild.cc subdomain.")
                    .font(.subheadline)
                    .foregroundColor(.white.opacity(0.6))
            }

            // Domain input
            VStack(alignment: .leading, spacing: 8) {
                Text("Domain")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.5))

                TextField("myapp.com", text: $domain)
                    .textFieldStyle(.plain)
                    .padding(12)
                    .background(Color(white: 0.12))
                    .cornerRadius(8)
                    .foregroundColor(.white)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                    .keyboardType(.URL)
            }

            // Error / Success messages
            if let error = errorMessage {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(.orange)
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.orange)
                }
            }

            if let success = successMessage {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                    Text(success)
                        .font(.caption)
                        .foregroundColor(.green)
                }
            }

            // Add button
            Button(action: addDomain) {
                HStack {
                    if isLoading {
                        ProgressView()
                            .tint(.white)
                            .scaleEffect(0.8)
                    }
                    Text("Add Domain")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(domain.isEmpty ? Color.gray : Color.blue)
                .foregroundColor(.white)
                .cornerRadius(10)
            }
            .disabled(domain.isEmpty || isLoading)

            // DNS instructions (shown after adding)
            if let cname = cnameTarget, let token = verificationToken {
                dnsInstructionsView(cnameTarget: cname, token: token)
            }
        }
    }

    // MARK: - Existing Domain Section

    private func existingDomainSection(_ status: DomainStatusResponse) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            // Domain info
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(status.domain ?? "")
                        .font(.title3)
                        .fontWeight(.semibold)
                        .foregroundColor(.white)

                    statusBadge(status.status ?? "pending")
                }
                Spacer()
                Image(systemName: "globe")
                    .font(.title)
                    .foregroundColor(.blue)
            }
            .padding()
            .background(Color(white: 0.1))
            .cornerRadius(12)

            // Actions based on status
            if status.status == "pending" || status.status == "dns_verified" {
                if let cname = status.cnameTarget, let token = status.txtValue {
                    dnsInstructionsView(cnameTarget: cname, token: token)
                }

                Button(action: verifyDomain) {
                    HStack {
                        if isVerifying {
                            ProgressView()
                                .tint(.white)
                                .scaleEffect(0.8)
                        }
                        Text("Verify Domain")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(10)
                }
                .disabled(isVerifying)
            }

            if status.status == "active" {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundColor(.green)
                    Text("SSL certificate active")
                        .font(.subheadline)
                        .foregroundColor(.green)
                }
            }

            // Success / Error messages
            if let success = successMessage {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                    Text(success)
                        .font(.caption)
                        .foregroundColor(.green)
                }
            }

            if let error = errorMessage {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(.orange)
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.orange)
                }
            }

            Divider()
                .background(Color.white.opacity(0.1))

            // Remove domain
            Button(action: removeDomain) {
                HStack {
                    if isRemoving {
                        ProgressView()
                            .tint(.red)
                            .scaleEffect(0.8)
                    }
                    Text("Remove Domain")
                        .fontWeight(.medium)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Color.red.opacity(0.15))
                .foregroundColor(.red)
                .cornerRadius(10)
            }
            .disabled(isRemoving)
        }
    }

    // MARK: - DNS Instructions

    private func dnsInstructionsView(cnameTarget: String, token: String) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("DNS Configuration")
                .font(.headline)
                .foregroundColor(.white)

            // CNAME record
            VStack(alignment: .leading, spacing: 6) {
                Text("Option 1: CNAME Record")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(.white.opacity(0.8))

                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Type: CNAME")
                            .font(.caption)
                            .foregroundColor(.white.opacity(0.5))
                        Text("Value:")
                            .font(.caption)
                            .foregroundColor(.white.opacity(0.5))
                        Text(cnameTarget)
                            .font(.caption)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundColor(.blue)
                    }
                    Spacer()
                    Button {
                        UIPasteboard.general.string = cnameTarget
                    } label: {
                        Image(systemName: "doc.on.doc")
                            .foregroundColor(.blue)
                    }
                }
                .padding(10)
                .background(Color(white: 0.08))
                .cornerRadius(8)
            }

            // TXT record
            VStack(alignment: .leading, spacing: 6) {
                Text("Option 2: TXT Verification")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(.white.opacity(0.8))

                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Host: _vibebuilder")
                            .font(.caption)
                            .foregroundColor(.white.opacity(0.5))
                        Text("Value:")
                            .font(.caption)
                            .foregroundColor(.white.opacity(0.5))
                        Text(token)
                            .font(.caption)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundColor(.blue)
                    }
                    Spacer()
                    Button {
                        UIPasteboard.general.string = token
                    } label: {
                        Image(systemName: "doc.on.doc")
                            .foregroundColor(.blue)
                    }
                }
                .padding(10)
                .background(Color(white: 0.08))
                .cornerRadius(8)
            }

            Text("DNS changes can take up to 48 hours to propagate, but usually take a few minutes.")
                .font(.caption)
                .foregroundColor(.white.opacity(0.4))
        }
        .padding()
        .background(Color(white: 0.06))
        .cornerRadius(12)
    }

    // MARK: - Status Badge

    private func statusBadge(_ status: String) -> some View {
        let (color, label): (Color, String) = {
            switch status {
            case "active": return (.green, "Active")
            case "dns_verified": return (.yellow, "DNS Verified")
            case "ssl_provisioning": return (.orange, "Provisioning SSL")
            case "failed": return (.red, "Failed")
            default: return (.gray, "Pending")
            }
        }()

        return HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
            Text(label)
                .font(.caption)
                .foregroundColor(color)
        }
    }

    // MARK: - Actions

    private func loadDomainStatus() {
        guard let userId = authManager.userId else { return }
        isLoading = true

        Task {
            do {
                // First get the deployment ID for this project
                let deployInfo = try await NetworkManager.shared.getDeploymentInfo(projectId: projectId)
                guard deployInfo.deployed, let subdomain = deployInfo.subdomain else {
                    await MainActor.run {
                        errorMessage = "Project must be deployed first"
                        isLoading = false
                    }
                    return
                }

                // Use subdomain as a proxy to find deployment — we need the deployment ID
                // The domain endpoints use deployment ID, so we'll store it
                // For now, use projectId as deploymentId since the routes accept it
                self.deploymentId = projectId

                let status = try await NetworkManager.shared.getCustomDomainStatus(
                    deploymentId: projectId,
                    userId: userId
                )

                await MainActor.run {
                    domainStatus = status
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    isLoading = false
                }
            }
        }
    }

    private func addDomain() {
        guard let userId = authManager.userId else { return }
        let cleanDomain = domain.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanDomain.isEmpty else { return }

        isLoading = true
        errorMessage = nil
        successMessage = nil

        Task {
            do {
                let response = try await NetworkManager.shared.addCustomDomain(
                    deploymentId: projectId,
                    userId: userId,
                    domain: cleanDomain
                )

                await MainActor.run {
                    cnameTarget = response.cnameTarget
                    verificationToken = response.verificationToken
                    successMessage = "Domain added! Configure your DNS records below."
                    isLoading = false
                    // Reload status
                    loadDomainStatus()
                }
            } catch let error as NetworkError {
                await MainActor.run {
                    errorMessage = error.errorDescription
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    isLoading = false
                }
            }
        }
    }

    private func verifyDomain() {
        guard let userId = authManager.userId else { return }
        isVerifying = true
        errorMessage = nil
        successMessage = nil

        Task {
            do {
                let response = try await NetworkManager.shared.verifyCustomDomain(
                    deploymentId: projectId,
                    userId: userId
                )

                await MainActor.run {
                    isVerifying = false
                    if response.status == "active" {
                        successMessage = "Domain verified and SSL provisioned!"
                    } else if response.status == "dns_verified" {
                        successMessage = "DNS verified! SSL provisioning in progress..."
                    } else {
                        errorMessage = response.message
                    }
                    loadDomainStatus()
                }
            } catch {
                await MainActor.run {
                    isVerifying = false
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    private func removeDomain() {
        guard let userId = authManager.userId else { return }
        isRemoving = true

        Task {
            do {
                _ = try await NetworkManager.shared.removeCustomDomain(
                    deploymentId: projectId,
                    userId: userId
                )

                await MainActor.run {
                    isRemoving = false
                    domainStatus = nil
                    domain = ""
                    cnameTarget = nil
                    verificationToken = nil
                    successMessage = "Domain removed"
                }
            } catch {
                await MainActor.run {
                    isRemoving = false
                    errorMessage = error.localizedDescription
                }
            }
        }
    }
}
