#!/bin/bash
set -e

echo "Switching to prod branch..."
git checkout prod

echo "Merging dev into prod..."
git merge dev

echo "Enter version tag (example: v1.0): "
read VERSION

echo "Creating version tag: $VERSION"
git tag -a "$VERSION" -m "Release $VERSION"

echo "Pushing prod branch and tags..."
git push origin prod --tags

echo "Switching back to dev branch..."
git checkout dev

echo "✅ Promotion to prod complete! Version: $VERSION"
