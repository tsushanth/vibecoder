# Deploy VibeCoder to Google Cloud Platform

This guide shows how to deploy all VibeCoder services to GCP using Cloud Run.

## Architecture on GCP

```
┌─────────────────┐
│  Cloud Run      │
│  - Backend API  │  ← https://vibecoder-api.run.app
│  - Worker       │  ← https://vibecoder-worker.run.app
│  - Deploy Server│  ← https://vibecoder-deploy.run.app
└─────────────────┘
         │
         ├─── Cloud SQL (PostgreSQL) or Supabase
         ├─── Firebase (Auth)
         └─── Cloud Storage (project bundles)
```

## Prerequisites

1. **GCP Account** with billing enabled
2. **gcloud CLI** installed
3. **Supabase account** (for database) OR Cloud SQL
4. **Firebase project** (for authentication)
5. **GitHub PAT** (for version control)

## 1. Setup GCP Project

```bash
# Install gcloud CLI (if not installed)
# https://cloud.google.com/sdk/docs/install

# Login
gcloud auth login

# Create project
gcloud projects create vibecoder-prod --name="VibeCoder"

# Set project
gcloud config set project vibecoder-prod

# Enable required APIs
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  containerregistry.googleapis.com \
  secretmanager.googleapis.com
```

## 2. Setup Secrets

```bash
# Create secrets for sensitive data
echo "your-supabase-url" | gcloud secrets create SUPABASE_URL --data-file=-
echo "your-supabase-anon-key" | gcloud secrets create SUPABASE_ANON_KEY --data-file=-
echo "vibecoder-worker-secret-2024" | gcloud secrets create WORKER_SECRET --data-file=-
echo "your-github-pat" | gcloud secrets create GITHUB_PAT --data-file=-
echo "your-stripe-key" | gcloud secrets create STRIPE_SECRET_KEY --data-file=-
```

## 3. Deploy Backend API

### Create Dockerfile

```dockerfile
# backend/Dockerfile
FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "server.js"]
```

### Deploy to Cloud Run

```bash
cd /Users/sushanthtiruvaipati/Documents/GitHub/vibecoder/backend

# Build and deploy
gcloud run deploy vibecoder-api \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --timeout 600 \
  --set-secrets="SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_ANON_KEY=SUPABASE_ANON_KEY:latest,WORKER_SECRET=WORKER_SECRET:latest,STRIPE_SECRET_KEY=STRIPE_SECRET_KEY:latest" \
  --set-env-vars="NODE_ENV=production,WORKER_URL=https://vibecoder-worker.run.app,DEPLOY_SERVER_URL=https://vibecoder-deploy.run.app"

# Get the URL
gcloud run services describe vibecoder-api --region us-central1 --format 'value(status.url)'
```

## 4. Deploy Worker

### Create Dockerfile with Claude CLI

```dockerfile
# worker/Dockerfile
FROM node:20-slim

# Install Claude CLI dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Claude CLI
RUN curl -fsSL https://raw.githubusercontent.com/anthropics/claude-code/main/install.sh | sh

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

ENV WORKER_PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "server.js"]
```

### Deploy

```bash
cd /Users/sushanthtiruvaipati/Documents/GitHub/vibecoder/worker

gcloud run deploy vibecoder-worker \
  --source . \
  --platform managed \
  --region us-central1 \
  --no-allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 900 \
  --max-instances 3 \
  --set-secrets="WORKER_SECRET=WORKER_SECRET:latest,GITHUB_PAT=GITHUB_PAT:latest" \
  --set-env-vars="NODE_ENV=production,WORKER_PORT=8080,GITHUB_ORG=VibeCoder"
```

## 5. Deploy Deploy Server

```bash
cd /Users/sushanthtiruvaipati/Documents/GitHub/vibecoder/deploy-server

# Create Dockerfile
cat > Dockerfile <<'EOF'
FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "server.js"]
EOF

gcloud run deploy vibecoder-deploy \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --set-env-vars="NODE_ENV=production,PORT=8080"
```

## 6. Update iOS App Configuration

Update the iOS app's NetworkManager to point to your Cloud Run URLs:

```swift
// ios/VibeCoder/Shared/NetworkManager.swift
private let baseURL = "https://vibecoder-api-XXXXX.run.app" // Replace with your URL
```

## 7. Configure Custom Domain (Optional)

### Setup Domain Mapping

```bash
# Map custom domain to backend
gcloud run domain-mappings create \
  --service vibecoder-api \
  --domain api.vibecoder.app \
  --region us-central1

# Get DNS records to add
gcloud run domain-mappings describe \
  --domain api.vibecoder.app \
  --region us-central1
```

Add the DNS records to your domain provider:
- Type: CNAME
- Name: api
- Value: ghs.googlehosted.com

## 8. Environment Variables Summary

### Backend (vibecoder-api)
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx
WORKER_URL=https://vibecoder-worker.run.app
WORKER_SECRET=vibecoder-worker-secret-2024
DEPLOY_SERVER_URL=https://vibecoder-deploy.run.app
STRIPE_SECRET_KEY=sk_live_xxx
NODE_ENV=production
PORT=8080
```

### Worker (vibecoder-worker)
```
WORKER_PORT=8080
WORKER_SECRET=vibecoder-worker-secret-2024
GITHUB_PAT=ghp_xxx
GITHUB_ORG=VibeCoder
NODE_ENV=production
```

### Deploy Server (vibecoder-deploy)
```
PORT=8080
NODE_ENV=production
```

## 9. Database Setup

### Option A: Supabase (Recommended for MVP)

1. Create project at https://supabase.com
2. Run SQL migration: `database_migration.sql`
3. Get URL and anon key from Settings > API
4. Already configured via secrets above

### Option B: Cloud SQL (For Production Scale)

```bash
# Create Cloud SQL instance
gcloud sql instances create vibecoder-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1

# Create database
gcloud sql databases create vibecoder --instance=vibecoder-db

# Get connection name
gcloud sql instances describe vibecoder-db --format='value(connectionName)'

# Update Cloud Run to connect via Cloud SQL Proxy
gcloud run services update vibecoder-api \
  --add-cloudsql-instances=PROJECT:REGION:vibecoder-db \
  --region us-central1
```

## 10. Monitoring & Logging

```bash
# View logs
gcloud run logs read vibecoder-api --limit 50

# View worker logs
gcloud run logs read vibecoder-worker --limit 50

# Monitor metrics in Cloud Console
open https://console.cloud.google.com/run?project=vibecoder-prod
```

## 11. Cost Estimation

**Cloud Run (Pay per use):**
- Backend: ~$5-20/month (1M requests)
- Worker: ~$10-50/month (depends on generation volume)
- Deploy Server: ~$1-5/month

**Supabase:**
- Free tier: 500MB database, 2GB bandwidth
- Pro: $25/month - 8GB database, 250GB bandwidth

**Firebase:**
- Free tier: 50K daily active users
- Blaze plan: Pay as you go

**Total estimated:** $15-100/month for MVP with moderate traffic

## 12. Quick Deploy Script

Create `deploy.sh`:

```bash
#!/bin/bash
set -e

echo "🚀 Deploying VibeCoder to GCP..."

# Deploy backend
echo "📦 Deploying backend..."
cd backend
gcloud run deploy vibecoder-api --source . --region us-central1 --quiet

# Deploy worker
echo "⚙️  Deploying worker..."
cd ../worker
gcloud run deploy vibecoder-worker --source . --region us-central1 --quiet

# Deploy deploy-server
echo "🌐 Deploying deploy server..."
cd ../deploy-server
gcloud run deploy vibecoder-deploy --source . --region us-central1 --quiet

echo "✅ Deployment complete!"
echo ""
echo "URLs:"
gcloud run services describe vibecoder-api --region us-central1 --format 'value(status.url)'
gcloud run services describe vibecoder-worker --region us-central1 --format 'value(status.url)'
gcloud run services describe vibecoder-deploy --region us-central1 --format 'value(status.url)'
```

Make executable: `chmod +x deploy.sh`

## Next Steps

1. ✅ Deploy all services to Cloud Run
2. ✅ Setup Supabase database
3. ✅ Configure Firebase authentication
4. ✅ Update iOS app with production URLs
5. ✅ Test end-to-end flow
6. ✅ Setup custom domain
7. ✅ Configure monitoring alerts
8. ✅ Setup CI/CD with Cloud Build

---

**Ready to deploy!** Run the commands above or use the quick deploy script.
