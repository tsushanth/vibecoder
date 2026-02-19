# VibeCoder

**An iOS-first "vibe coding" platform where users describe apps in natural language and AI builds them instantly.**

VibeCoder is a Replit clone for iOS that lets you create, edit, and deploy web applications directly from your iPhone or iPad using AI-powered code generation.

---

## 🎯 Key Features

- **AI "Vibe Coding"** - Describe what you want, AI builds it (5-phase iterative pipeline)
- **Native iOS App** - SwiftUI, optimized for mobile, works offline
- **Live Code Editor** - Syntax highlighting with Runestone
- **Instant Preview** - See your app running in real-time WKWebView
- **Chat-Based Refinement** - Conversational tweaking ("Add a delete button", "Make it dark mode")
- **One-Tap Deploy** - Publish to `https://<your-app>.vibecoder.app`
- **Community Browse** - Discover, fork, and customize others' apps
- **Creator Earnings** - 55% revenue share for app creators

---

## 🏗️ Architecture

```
┌─────────────┐      SSE        ┌─────────────┐     HTTP      ┌────────────┐
│  iOS App    │◄───────────────►│  Backend    │◄─────────────►│   Worker   │
│  (SwiftUI)  │                 │  (Express)  │               │  (Claude)  │
└─────────────┘                 └─────────────┘               └────────────┘
      │                                │                              │
      │ StoreKit 2                     │                              │
      ▼                                ▼                              ▼
┌─────────────┐                 ┌─────────────┐               ┌────────────┐
│  App Store  │                 │  Supabase   │               │   Deploy   │
│    (IAP)    │                 │   + Firebase│               │   Server   │
└─────────────┘                 └─────────────┘               └────────────┘
```

- **iOS App**: Native SwiftUI app with code editor, preview, chat UI
- **Backend**: Express.js API - SSE proxy, coin system, browse cache
- **Worker**: Claude Code CLI runner - 5-phase iterative builds (Generate → Validate → Fix → Polish → Verify)
- **Deploy Server**: Static file hosting for published apps
- **Supabase**: PostgreSQL database
- **Firebase**: iOS authentication

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Xcode 15+ (for iOS development)
- Supabase account (free tier works)
- Firebase project
- Claude Code CLI Pro subscription (for worker)
- Fly.io account (for deployment)

### 1. Database Setup

```bash
# Create Supabase project at https://supabase.com
# Run the migration script in Supabase SQL Editor
cat database_migration.sql | pbcopy
# Paste and run in Supabase dashboard
```

### 2. Firebase Setup

```bash
# Create Firebase project at https://console.firebase.google.com
# Enable Authentication > Sign-in providers: Apple, Google
# Download GoogleService-Info.plist to ios/VibeCoder/
# Get Firebase web config for backend
```

### 3. Backend Setup

```bash
cd backend
npm install

# Create .env file
cat > .env <<EOF
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
WORKER_URL=http://localhost:3456
WORKER_SECRET=vibecoder-worker-secret-2024
DEPLOY_SERVER_URL=http://localhost:4000
STRIPE_SECRET_KEY=sk_test_...
PORT=8080
EOF

# Start backend
npm run dev
```

### 4. Worker Setup

```bash
cd ../worker
npm install

# Create .env file
cat > .env <<EOF
WORKER_PORT=3456
WORKER_SECRET=vibecoder-worker-secret-2024
GITHUB_PAT=ghp_your_github_pat
GITHUB_ORG=YourGitHubOrg
EOF

# Ensure Claude Code CLI is installed and authenticated
claude --version  # Should show version

# Start worker
npm run dev
```

### 5. Deploy Server Setup

```bash
cd ../deploy-server
npm install

# Start deploy server
PORT=4000 npm start
```

### 6. iOS App Setup

```bash
cd ../ios

# Install dependencies
# Add Firebase to Podfile if needed, or use Swift Package Manager

# Open in Xcode
open VibeCoder.xcodeproj

# Update Constants.swift with your backend URL
# Add GoogleService-Info.plist to Xcode project
# Configure signing & capabilities
# Run on simulator or device
```

---

## 💰 Monetization

### Coin System

**Coin Packs:**
- 100 coins = $0.99
- 500 coins = $3.99 (5% bonus)
- 1,200 coins = $7.99 (20% bonus)

**Costs:**
- **AI Generation**: 20 coins (3 free per day)
- **Tweak/Refine**: 10 coins (5 free per project)
- **Fork/Customize**: 10 coins

### Creator Revenue Share

Creators earn **55% of all coins** spent on their projects:
- When someone forks your project
- When someone tweaks your project after free quota
- Minimum payout: 1,000 coins ($7 USD)
- Payout via Stripe Connect

### Optional Subscription

**VibeCoder Pro** - $9.99/month:
- Unlimited AI generations
- 20 free tweaks per project
- Priority build queue
- Remove ads

---

## 📁 Project Structure

```
vibecoder/
├── backend/                # Express.js API server
│   ├── config/            # Database, constants
│   ├── middleware/        # Error handling
│   ├── routes/            # API routes (projects, coins, deploy, auth)
│   ├── services/          # Business logic (coins, payouts)
│   └── server.js          # Entry point
├── worker/                # Claude Code CLI worker
│   └── server.js          # 5-phase AI build pipeline
├── deploy-server/         # Static hosting server
│   └── server.js          # Serves *.vibecoder.app
├── ios/VibeCoder/         # iOS app (SwiftUI)
│   ├── App/              # App entry, navigation
│   ├── Auth/             # Firebase Auth (Apple/Google sign-in)
│   ├── Create/           # Project creation + SSE progress UI
│   ├── Editor/           # Code editor (Runestone)
│   ├── Preview/          # WKWebView live preview
│   ├── Chat/             # Conversational refinement
│   ├── Projects/         # My projects list
│   ├── Browse/           # Community discover/fork
│   ├── Monetization/     # CoinManager (StoreKit 2)
│   ├── Shared/           # ZipExtractor, NetworkManager
│   └── Models/           # Data models
└── database_migration.sql # Supabase schema + stored procedures
```

---

## 🛠️ Development

### Run All Services

```bash
# Terminal 1 - Backend
cd backend && npm run dev

# Terminal 2 - Worker
cd worker && npm run dev

# Terminal 3 - Deploy Server
cd deploy-server && npm start

# Terminal 4 - iOS (Xcode)
open ios/VibeCoder.xcodeproj
# Build & run in Xcode
```

### API Endpoints

**Projects:**
```
POST   /api/projects/generate      # SSE: AI generates project
POST   /api/projects/save          # Save project to database
GET    /api/projects/browse        # Browse community (cached)
GET    /api/projects/suggestions   # Random project ideas
GET    /api/projects/my            # User's projects
GET    /api/projects/:id           # Get project with bundle
POST   /api/projects/:id/tweak     # SSE: Apply refinement
POST   /api/projects/:id/fork      # Fork project (10 coins)
GET    /api/projects/:id/versions  # Git version history
DELETE /api/projects/:id           # Delete project
```

**Coins:**
```
GET    /api/coins/balance          # Get coin balance
GET    /api/coins/store            # Coin pack pricing
POST   /api/coins/purchase         # Record IAP purchase
POST   /api/coins/spend            # Spend coins
GET    /api/coins/earnings         # Creator earnings
GET    /api/coins/transactions     # Transaction history
```

**Deploy:**
```
POST   /api/deploy/:projectId/deploy    # Deploy to subdomain
DELETE /api/deploy/:projectId/deploy    # Remove deployment
GET    /api/deploy/:projectId/deploy    # Get deployment status
```

---

## 🎨 Tech Stack

### Backend
- **Express.js** - API server
- **Supabase** - PostgreSQL database
- **Firebase** - Authentication
- **Stripe** - Payments + Creator payouts
- **Node.js** - Runtime

### Worker
- **Claude Code CLI** - AI code generation
- **Node.js** - Worker orchestration
- **GitHub API** - Version control

### iOS
- **SwiftUI** - UI framework
- **Runestone** - Code editor with syntax highlighting
- **WKWebView** - Live app preview
- **StoreKit 2** - In-app purchases
- **Firebase Auth** - Apple/Google sign-in
- **Compression** - ZIP handling

---

## 📋 Implementation Status

See [STATUS.md](./STATUS.md) for detailed progress tracking.

**Current Status:** Foundation complete (~60% backend, ~10% iOS)

---

## 🤝 Contributing

This is a private project. For questions or collaboration inquiries, contact the maintainer.

---

## 📄 License

Proprietary - All rights reserved.

---

## 🙏 Acknowledgments

Architecture and monetization strategy adapted from the battle-tested [riddle-verse](https://github.com/Kreative-Koala-LLC) game builder platform.

---

**Built with ❤️ using Claude Code**
