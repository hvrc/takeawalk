#!/usr/bin/env bash
# Manual deploy to Cloud Run `takeawalk` in hvrc-web (walk.hvrc.place).
# Normally you don't need this: pushing to the `release` branch deploys
# automatically via the Cloud Build trigger `takeawalk-release-deploy`.
set -euo pipefail
cd "$(dirname "$0")"
gcloud run deploy takeawalk --source . --project hvrc-web --region us-east1 \
  --allow-unauthenticated --port 8080 --quiet \
  --set-secrets=ADMIN_PASSWORD=takeawalk-admin-password:latest,ADMIN_TOKEN_SECRET=takeawalk-admin-token-secret:latest \
  --set-env-vars=FIREBASE_API_KEY=AIzaSyC6H2bQh4-pIDFIB3iBFfStR8ctJkAAoLE
