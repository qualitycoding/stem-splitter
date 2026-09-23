# Operations

- **Deploy:** push to `main` after G-002 (workflow `Deploy to GitHub Pages`), or run it manually via workflow_dispatch.
- **Rollback:** `git revert <sha> && git push` (redeploys previous state), or re-run the last good workflow run from the Actions tab.
- **Emergency off:** Settings → Pages → Unpublish, or disable the workflow.
- **Model host outage:** users can load a downloaded `.onnx` file via "Load model from disk" (SHA-256 checked).
- **Monitoring:** none server-side (static site, no telemetry by design). Issues via GitHub.
