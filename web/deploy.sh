#!/bin/bash
set -e

PROJECT_ID="summarizerproxy"
REGION="us-central1"
SERVICE_NAME="vibebuild-web"
REPO="vibecoder"
IMAGE="us-central1-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE_NAME}"

echo "=== VibeBuild Web — Deploy to Cloud Run ==="

# Ensure gcloud is pointed at the right project
gcloud config set project ${PROJECT_ID}

# Create Artifact Registry repo if it doesn't exist
gcloud artifacts repositories describe ${REPO} \
  --location=${REGION} 2>/dev/null || \
gcloud artifacts repositories create ${REPO} \
  --repository-format=docker \
  --location=${REGION} \
  --description="VibeCoder container images"

# Configure Docker auth for Artifact Registry
gcloud auth configure-docker us-central1-docker.pkg.dev --quiet

# Build the image with build args
echo "Building Docker image..."
docker build \
  --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://owvvrljdfnhntwedepkl.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93dnZybGpkZm5obnR3ZWRlcGtsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMDA1NTEsImV4cCI6MjA4Njc3NjU1MX0.WjjwtJn03_5Ayd2Ed9WlQ-lIWiZiTrlfnCl-7nYCoGk \
  --build-arg NEXT_PUBLIC_API_URL=https://vibecoder-api-917362189743.us-central1.run.app \
  -t ${IMAGE}:latest \
  .

# Push to Artifact Registry
echo "Pushing to Artifact Registry..."
docker push ${IMAGE}:latest

# Deploy to Cloud Run
echo "Deploying to Cloud Run..."
gcloud run deploy ${SERVICE_NAME} \
  --image ${IMAGE}:latest \
  --region ${REGION} \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --set-env-vars "NODE_ENV=production"

# Get the service URL
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} --region ${REGION} --format='value(status.url)')
echo ""
echo "=== Deployed successfully! ==="
echo "URL: ${SERVICE_URL}"
echo ""
echo "To map vibebuild.shop domain:"
echo "  gcloud run domain-mappings create --service ${SERVICE_NAME} --domain vibebuild.shop --region ${REGION}"
