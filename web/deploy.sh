#!/bin/bash
set -e

PROJECT_ID="summarizerproxy"
REGION="us-central1"
SERVICE_NAME="vibebuild-web"

echo "=== VibeBuild Web — Deploy to Cloud Run ==="

gcloud config set project ${PROJECT_ID}

# Deploy using Cloud Build (uploads current source, no local Docker needed)
gcloud run deploy ${SERVICE_NAME} \
  --source . \
  --region ${REGION} \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 40 \
  --set-build-env-vars "NEXT_PUBLIC_SUPABASE_URL=https://owvvrljdfnhntwedepkl.supabase.co,NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93dnZybGpkZm5obnR3ZWRlcGtsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMDA1NTEsImV4cCI6MjA4Njc3NjU1MX0.WjjwtJn03_5Ayd2Ed9WlQ-lIWiZiTrlfnCl-7nYCoGk,NEXT_PUBLIC_API_URL=https://vibecoder-api-917362189743.us-central1.run.app" \
  --set-env-vars "NODE_ENV=production"

SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} --region ${REGION} --format='value(status.url)')
echo ""
echo "=== Deployed successfully! ==="
echo "URL: ${SERVICE_URL}"
