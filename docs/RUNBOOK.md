# Saarthi Live <img src="../assets/peacock-feather-original.png" alt="Peacock feather" width="34" /> Runbook

## 1. Start Backend

Open PowerShell:

```powershell
cd C:\Users\anuja_9ipoxfr\Downloads\Projects\testvoice-agent
npm run backend:token
```

Expected:

```text
Uvicorn running on http://0.0.0.0:8787
```

If port `8787` is already in use, backend is probably already running. Check:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

## 2. Start Web App

Open another PowerShell:

```powershell
cd C:\Users\anuja_9ipoxfr\Downloads\Projects\testvoice-agent
npx expo start --web --port 8084 -c
```

Open:

```text
http://localhost:8084
```

Backend URL in app:

```text
http://localhost:8787
```

## 3. Start Mobile App In Expo Go

Open another PowerShell:

```powershell
cd C:\Users\anuja_9ipoxfr\Downloads\Projects\testvoice-agent
npx expo start --host lan --port 8083 -c
```

Scan QR from Expo Go on Android.

Backend URL in mobile app:

```text
http://YOUR-LAPTOP-LAN-IP:8787
```

Find laptop IP:

```powershell
ipconfig
```

Use the IPv4 address from the active Wi-Fi/LAN adapter.

## 4. Test General AI Assistant

1. Open app.
2. Enter name.
3. Choose language.
4. Tap `General AI Assistant`.
5. Tap `Enter Voice Room`.
6. Speak naturally.
7. Pause for assistant turn.
8. Confirm the assistant replies in the same or natural code-mixed language.

Expected:

- General memory starts fresh.
- No resume/interview context appears.
- Assistant should not force interview behavior.

## 5. Test Upload Resume Interview

1. Go Home.
2. Tap `Upload Resume`.
3. Paste resume text or choose TXT/PDF/DOCX.
4. Wait for ready state.
5. Tap `Start Interview`.
6. Tap `Start Interview` or `Enter Voice Room` in live setup.
7. Speak answers.

Expected:

- Interview starts only after resume context exists.
- First question is resume/job relevant.
- Interview remains interview-only.
- General assistant memory does not appear inside this flow.

## 6. Test Hindi Consultant Resume Builder

1. Go Home.
2. Tap `Hindi Consultant Resume`.
3. Listen to the consultant prompt or tap replay.
4. Speak/enter details step by step.
5. Tap create resume.
6. Download resume or start interview.

Expected:

- Prompts are Hindi/Hinglish consultant style.
- Resume is generated in Hindi and English.
- Generated resume can start the same resume-led interview flow.

## 7. Test Candidate Profile

1. Run a general discussion or interview.
2. Complete at least 8 useful user turns.
3. Tap finish discussion or open Candidate Profile.
4. Tap Build Profile if needed.

Expected:

- Profile summarizes confidence, emotional state, stress signal, understanding depth, strengths, weaknesses, notes, and next deep questions.
- Profile uses only the active discussion/interview memory.

## 8. Verify Backend Quality

```powershell
cd C:\Users\anuja_9ipoxfr\Downloads\Projects\testvoice-agent
backend\.venv\Scripts\python.exe -m unittest discover backend\tests
npx.cmd tsc --noEmit
backend\.venv\Scripts\python.exe -c "import sys; sys.path.insert(0, 'backend'); import token_server; print(token_server.app.title)"
```

## 9. Common Issues

### Port 8787 Already In Use

Check backend:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

If healthy, do not start another backend.

### Mobile Cannot Reach Backend

- Confirm laptop and phone are on same network.
- Use laptop LAN IP, not `localhost`.
- Windows firewall may need to allow Python/Uvicorn on private networks.

### Web Shows Failed To Fetch

- Confirm backend is running.
- Confirm app backend URL is `http://localhost:8787`.
- Reload Expo web.

### Sarvam STT Timeout

- Speak shorter turns.
- Pause naturally.
- Avoid very long continuous recording.

### Expo Port Changes

If Expo says port is busy and moves from `8083` to another port, use the QR/code shown by Expo. Backend remains `8787`.

## 10. Shutdown

In each terminal:

```text
Ctrl+C
```

Do this for backend and Expo when testing is complete.


