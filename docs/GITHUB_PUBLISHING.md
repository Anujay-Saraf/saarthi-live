# GitHub Publishing Checklist

Use this checklist before pushing Saarthi Live to GitHub.

## Keep

- `App.tsx`
- `app.json`
- `eas.json`
- `index.ts`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `README.md`
- `assets/`
- `backend/`
- `docs/`
- `appendix/README.md`
- `appendix/security-and-agent-architecture.md`

## Do Not Commit

These are ignored by `.gitignore`:

- `node_modules/`
- `.expo/`
- `backend/.venv/`
- `backend/.env`
- `*.log`
- `dist-web/`
- `appendix/build-artifacts/`
- `appendix/run-logs/`
- `appendix/generated-doc-assets/`
- `appendix/rejected-assets/`
- `*.apk`
- `*.aab`

## Final Checks

```powershell
cd C:\Users\anuja_9ipoxfr\Downloads\Projects\testvoice-agent
npx.cmd tsc --noEmit
backend\.venv\Scripts\python.exe -m unittest discover backend\tests
backend\.venv\Scripts\python.exe -m py_compile backend\token_server.py backend\services\application.py backend\services\agent_orchestrator.py backend\api\routes_voice.py backend\api\routes_resume.py backend\api\routes_profile.py backend\api\routes_system.py
git status --short
```

## First Push

```powershell
git add .
git status --short
git commit -m "Prepare Saarthi Live prototype"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

Before committing, inspect `git status --short` and confirm no `.env`, log,
venv, node_modules, or generated build folder appears.
