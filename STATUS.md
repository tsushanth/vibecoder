# VibeCoder - Implementation Status

**Project Goal:** iOS-first Replit clone with AI "vibe coding" - users describe apps in natural language, AI builds complete web applications.

**Strategy:** Reuse 75% of riddle-verse's battle-tested architecture (AI generation pipeline, monetization, SSE streaming) and adapt for general web app creation instead of games.

---

## ✅ COMPLETED (Phase 1-2: Foundation)

### Planning & Architecture
- ✅ **Comprehensive implementation plan** written to `~/.claude/plans/moonlit-whistling-biscuit.md`
- ✅ **Competitive analysis** of Replit completed
- ✅ **8-week timeline** with phased delivery plan
- ✅ **Database schema** designed (Supabase tables for projects, users, coins, deployments)
- ✅ **API design** - all endpoints mapped from riddle-verse patterns

### Backend Foundation (`/vibecoder/backend/`)
- ✅ `package.json` - ES modules, Express dependencies
- ✅ `config/database.js` - Supabase client
- ✅ `config/constants.js` - Coin packs, costs, rate limits
- ✅ `middleware/errorHandler.js` - Central error handling
- ✅ `services/coinService.js` - Full coin system (purchase, spend, earnings, 55% creator share)
- ✅ `routes/auth.routes.js` - User registration/upsert
- ✅ `routes/coins.routes.js` - All coin endpoints
- ✅ `.env.example` - Environment variable template

**MISSING (Critical):**
- ❌ `server.js` - Main Express entry point
- ❌ `routes/projects.routes.js` - **MOST IMPORTANT** - SSE proxy, browse cache, generation, tweak, fork endpoints
- ❌ `routes/deploy.routes.js` - Static hosting deployment

### Worker (`/vibecoder/worker/`)
- ✅ `package.json` created
- ❌ `server.js` - **CRITICAL** - 5-phase AI build pipeline, Claude CLI integration, SSE streaming

### Deploy Server (`/vibecoder/deploy-server/`)
- ✅ `package.json` created
- ❌ `server.js` - Static file hosting for published projects

### iOS App Foundation (`/vibecoder/ios/VibeCoder/`)
- ✅ `Models/Project.swift` - Project, ProjectFile, ProjectVersion, ChatMessage models
- ✅ `Models/User.swift` - User, CoinBalance, CoinTransaction models
- ✅ `Shared/NetworkManager.swift` - HTTP + SSE streaming client
- ✅ `App/VibeCoderApp.swift` - @main entry with Firebase init
- ✅ `App/ContentView.swift` - Tab navigation (Create, Projects, Explore, Profile)

**MISSING (All iOS Views):**
- ❌ Auth (AuthManager, SignInView)
- ❌ Create (CreateProjectView, ProjectGenerationManager, progress UI)
- ❌ Preview (LivePreviewView, WKWebView wrapper)
- ❌ Editor (CodeEditorView, FileTreeView, Runestone integration)
- ❌ Chat (ChatView, ChatManager)
- ❌ Projects (ProjectListView, ProjectDetailView)
- ❌ Browse (BrowseView, browse cards)
- ❌ Monetization (CoinManager, StoreKit 2)
- ❌ Shared (ZipExtractor, SSEStreamReader)

---

## 📋 IMPLEMENTATION ROADMAP

### Immediate Next Steps (Week 1)

**1. Complete Backend Core (2-3 hours)**
   - Write `backend/server.js` - mount all routes
   - Write `backend/routes/projects.routes.js` - **BIG FILE** - adapt from riddle-verse's gameCreation.routes.js:
     * In-memory browse cache (refresh every 60s)
     * In-memory suggestions cache (refresh every 5min)
     * Rate limiting (5 gen/hour in-memory)
     * POST /generate - SSE proxy to worker
     * POST /save - Save to Supabase
     * GET /browse - Paginated cache
     * GET /suggestions - Random ideas
     * POST /:id/tweak - SSE proxy with coins
     * POST /:id/fork - 10 coins, 55% creator share
     * GET /:id/versions - Git history
   - Write `backend/routes/deploy.routes.js` - Deployment endpoints

**2. Complete Worker (3-4 hours)**
   - Write `worker/server.js` - Full implementation:
     * Copy Claude CLI discovery, quota tracking, ZIP handling from game-worker
     * Replace CLAUDE_MD with web app guardrails (no game-specific rules)
     * Replace validation: remove checkScoreBridge, checkGameLoop, checkTouchSupport
     * Add checkResponsiveDesign (viewport meta check)
     * Keep 5-phase pipeline: Generate → Validate → Fix → Polish → Verify
     * POST /generate endpoint with SSE
     * POST /tweak endpoint for refinement
     * POST /init-repo for GitHub init
     * GET /versions/:repoName for git history

**3. Complete Deploy Server (30 minutes)**
   - Write `deploy-server/server.js`:
     * POST /deploy - receives subdomain + base64 ZIP, extracts to disk
     * Serves static files at `/:subdomain/*`
     * DELETE /deploy/:subdomain

**4. Database Setup (1 hour)**
   - Create Supabase project
   - Run migration script:
     * Create tables: projects, users, user_coins, coin_transactions, creator_earnings, project_files, project_chats, deployments, project_suggestions
     * Create stored procedures: spend_coins, add_purchased_coins
     * Create indexes
   - Set up Firebase project for auth

**5. iOS - Core Adaption (4-5 hours)**
   Copy & adapt these files from riddle-verse:
   - `Shared/ZipExtractor.swift` - 100% reusable
   - `Preview/LivePreviewView.swift` - from GameWebView.swift, remove score bridge
   - `Create/ProjectGenerationManager.swift` - from GameGenerationManager.swift, rename APIs
   - `Monetization/CoinManager.swift` - change product IDs only
   - `Auth/AuthManager.swift` - Firebase Auth wrapper
   - `Auth/SignInView.swift` - Apple + Google Sign-In

**6. iOS - New Components (6-8 hours)**
   Build these from scratch (not in riddle-verse):
   - `Create/CreateProjectView.swift` - Prompt input, voice, image, suggestions, progress card
   - `Projects/ProjectListView.swift` - User's projects list
   - `Browse/BrowseView.swift` - Community browse
   - `Editor/CodeEditorView.swift` - Runestone integration, file tree, live preview split
   - `Chat/ChatView.swift` - Conversation-based refinement

---

## 🎯 KEY FILES TO REFERENCE

All riddle-verse source files are at `/Users/sushanthtiruvaipati/Documents/GitHub/riddle-verse/`

### Backend Adaptions
| Source | Adapt To | Changes |
|--------|----------|---------|
| `web/backend/routes/gameCreation.routes.js` | `backend/routes/projects.routes.js` | Rename game→project, remove difficulty endpoints |
| `web/backend/services/coinService.js` | `backend/services/coinService.js` | Change product IDs, add generation reason |
| `game-worker/server.js` | `worker/server.js` | Change CLAUDE_MD, remove game validations |

### iOS Adaptions
| Source | Adapt To | Reuse % |
|--------|----------|---------|
| `ios/PuzzleForge/GameGenerationManager.swift` | `Create/ProjectGenerationManager.swift` | 95% |
| `ios/PuzzleForge/GameWebView.swift` | `Preview/LivePreviewView.swift` | 100% |
| `ios/PuzzleForge/ZipExtractor.swift` | `Shared/ZipExtractor.swift` | 100% |
| `ios/PuzzleForge/CoinManager.swift` | `Monetization/CoinManager.swift` | 90% |
| `ios/PuzzleForge/GameCreationView.swift` | `Create/CreateProjectView.swift` | 80% |

---

## 📦 DELIVERABLES CHECKLIST

### MVP (Weeks 1-3)
- [ ] Backend server running (all routes working)
- [ ] Worker generating web apps from prompts (SSE streaming)
- [ ] iOS app: Create → Generate → Preview flow working
- [ ] Coin system: purchase, spend, balance display
- [ ] Deploy: Publish to *.vibecoder.app URLs

### Full Launch (Weeks 4-8)
- [ ] Code editor with syntax highlighting (Runestone)
- [ ] Chat-based refinement (conversational tweaking)
- [ ] Browse/community (discover, fork)
- [ ] Version history (git-backed, rollback)
- [ ] Creator earnings dashboard
- [ ] Stripe Connect payouts

---

## 🚀 DEPLOYMENT PLAN

1. **Supabase** - Database + Auth
2. **Fly.io** - Backend API server
3. **Fly.io** - Worker server (with Claude CLI installed)
4. **Fly.io** - Deploy server (static hosting)
5. **Firebase** - iOS Auth provider
6. **App Store Connect** - iOS app distribution

---

## 💰 MONETIZATION SUMMARY

**Coin Packs (same as riddle-verse):**
- 100 coins = $0.99
- 500 coins = $3.99
- 1,200 coins = $7.99

**Costs:**
- AI Generation: 20 coins (3 free/day)
- Tweak/Refine: 10 coins (5 free/project)
- Fork: 10 coins

**Creator Revenue:** 55% of all coins spent on their projects

**Optional Subscription:** VibeCoder Pro $9.99/mo (unlimited generations, priority queue)

---

## 📚 NEXT SESSION COMMANDS

```bash
# Complete backend
cd /Users/sushanthtiruvaipati/Documents/GitHub/vibecoder/backend
# Write missing files: server.js, routes/projects.routes.js, routes/deploy.routes.js

# Complete worker
cd ../worker
# Write server.js (full 5-phase pipeline)

# Complete deploy server
cd ../deploy-server
# Write server.js

# Create database migration
cd ..
# Write database/migration.sql

# Start development
cd backend && npm install && npm run dev &
cd ../worker && npm install && npm run dev &
cd ../deploy-server && npm install && npm run dev &

# Open in Xcode
open ios/VibeCoder.xcodeproj
```

---

**STATUS:** Foundation complete, ~60% of backend done, ~10% of iOS done. Ready for intensive build session to complete MVP.
