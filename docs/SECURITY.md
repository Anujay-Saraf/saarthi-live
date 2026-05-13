# Security Notes

Saarthi Live is currently a prototype. It includes useful guardrails, but it is
not yet production hardened.

## Current Controls

- API keys stay in the FastAPI backend, not in the Expo app.
- `.env` files are ignored by Git.
- `backend/.env.example` documents required variables without secrets.
- CORS can be restricted with `SAARTHI_CORS_ORIGINS`.
- Optional API token auth can be enabled with `SAARTHI_API_TOKEN`.
- Optional consent enforcement can be enabled with `SAARTHI_REQUIRE_CONSENT`.
- Per-session in-memory rate limiting is controlled by `SAARTHI_RATE_LIMIT_PER_MINUTE`.
- Upload size is limited by `SAARTHI_MAX_UPLOAD_MB`.
- Resume/audio uploads use allowlists and basic unsafe marker screening.
- Logs redact common phone/email identifiers.
- Resume/context text is sanitized for prompt-injection markers.
- Metadata audit events can be written to JSONL.

## Before Public Production

- Add a real identity provider.
- Add durable tenant/session storage with encryption at rest.
- Add proper RBAC/admin tooling.
- Add a real malware scanner for uploads.
- Add retention/deletion workflows for audit and user data.
- Restrict CORS to known domains.
- Put backend behind HTTPS.
- Use managed secrets instead of local `.env`.

## Secret Handling

Never commit:

- `backend/.env`
- Sarvam API keys
- LiveKit API key or secret
- signing keys, keystores, or APK release credentials
