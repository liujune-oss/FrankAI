---
description: Build and push the Gemini Chat PWA to GitHub (auto-deploys to Vercel)
---
// turbo-all

## Build Workflow

This workflow increments the build number in `version.json`, commits, and pushes to GitHub. Vercel will auto-deploy.

### Steps

1. Read the current version from `version.json` at `f:\FrankAI\gemini-chat-pwa\version.json`

2. Increment the **build** number by 1 (unless the user explicitly says to increment the major or minor version):
   - If user says "增加主版本" or "major": set `major += 1`, reset `minor = 0`, reset `build = 0`
   - If user says "增加小版本" or "minor": set `minor += 1`, reset `build = 0`
   - Otherwise (default): set `build += 1`

3. Write the updated version back to `f:\FrankAI\gemini-chat-pwa\version.json`

4. Run the following command to commit and push:
```powershell
cd f:\FrankAI\gemini-chat-pwa; git add -A; git commit -m "build: v{major}.{minor}.{build}"; git push
```

5. Report the new version number to the user: `v{major}.{minor}.{build}`
