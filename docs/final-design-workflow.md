# Saarthi Live <img src="../assets/peacock-feather-original.png" alt="Peacock feather" width="34" /> Final Design Workflow

## Product Goal

Saarthi Live gives users a multilingual AI conversation experience that can shift between a general assistant, resume-led interview, Hindi resume creation, and candidate profile analysis without mixing unrelated memories across flows.

## User-Facing Modes

```mermaid
flowchart LR
  H[Home] --> G[General AI Assistant]
  H --> U[Upload Resume]
  H --> C[Hindi Consultant Resume Builder]
  H --> P[Candidate Profile]
  U --> RI[Resume-led Live Interview]
  C --> D[Download Hindi and English Resume]
  C --> RI
  G --> P
  RI --> P
```

## End-To-End System Flow

```mermaid
flowchart TD
  User[User speaks or types] --> App[Expo App: Web or Mobile]
  App --> Route[FastAPI Route]
  Route --> AppSvc[Application Service]
  AppSvc --> Gov[Security and Audit Service]
  AppSvc --> Orch[Agent Orchestrator]
  Orch --> Graph[Conversation Graph]
  Orch --> STT[STT Interface]
  Orch --> LLM[LLM Interface]
  AppSvc --> TTS[TTS Interface]
  STT --> SarvamSTT[Sarvam saarAS STT]
  LLM --> SarvamM[Sarvam-m]
  TTS --> SarvamTTS[Sarvam bulbul TTS]
  SarvamSTT --> Orch
  SarvamM --> Orch
  SarvamTTS --> App
  Orch --> Response[Typed Response]
  Response --> App
```

## Backend SOLID Shape

```mermaid
flowchart TD
  Routes[api/routes_*.py] --> Services[services/application.py]
  Services --> Voice[VoiceApplicationService]
  Services --> Resume[ResumeApplicationService]
  Services --> Profile[ProfileApplicationService]
  Services --> System[SystemApplicationService]
  Voice --> Orchestrator[AgentOrchestrator]
  Orchestrator --> Graph[conversation_graph.py]
  Orchestrator --> LLMInterface[LLMService Protocol]
  Orchestrator --> STTInterface[SpeechToTextService Protocol]
  System --> TTSInterface[TextToSpeechService Protocol]
  Resume --> DocInterface[DocumentParserService Protocol]
  Resume --> UploadSec[UploadSecurityService Protocol]
  Voice --> Audit[AuditService Protocol]
  Resume --> Audit
  Profile --> Audit
  LLMInterface --> SarvamProvider[services/sarvam.py]
  STTInterface --> SarvamProvider
  TTSInterface --> SarvamProvider
```

## Interview State Machine

```mermaid
stateDiagram-v2
  [*] --> resume_loaded
  resume_loaded --> interview_started
  interview_started --> followup_question
  followup_question --> followup_question: candidate answers
  followup_question --> profile_signal_update: enough turns
  profile_signal_update --> followup_question: continue interview
  profile_signal_update --> close_session: user ends discussion
  close_session --> [*]
```

## Resume Upload Flow

```mermaid
sequenceDiagram
  participant User
  participant App
  participant API as routes_resume.py
  participant Service as ResumeApplicationService
  participant Parser as DocumentParserService
  participant LLM as LLMService
  participant Agent as ResumeAnalyzerAgent

  User->>App: Upload or paste resume
  App->>API: POST /resume/analyze
  API->>Service: analyze(file, text, actor)
  Service->>Parser: extract text
  Service->>Agent: build structured prompt
  Service->>LLM: complete(prompt)
  LLM-->>Service: JSON-like result
  Service->>Agent: parse and repair with Pydantic contract
  Service-->>API: ResumeAnalyzeResponse
  API-->>App: Resume ready for interview
```

## Hindi Resume Builder Flow

```mermaid
sequenceDiagram
  participant User
  participant App
  participant API as routes_resume.py
  participant Service as ResumeApplicationService
  participant Agent as ResumeBuilderAgent
  participant LLM as LLMService

  User->>App: Speaks or enters local profile details
  App->>API: POST /resume/build
  API->>Service: build(request, actor)
  Service->>Agent: create bilingual resume prompt
  Service->>LLM: complete(prompt)
  LLM-->>Service: structured resume data
  Service->>Agent: parse Hindi and English versions
  Service-->>API: ResumeAnalyzeResponse
  API-->>App: Download or start interview
```

## Candidate Profile Flow

```mermaid
sequenceDiagram
  participant App
  participant API as routes_profile.py
  participant Service as ProfileApplicationService
  participant Agent as CandidateProfileAgent
  participant LLM as LLMService

  App->>API: POST /candidate/profile
  API->>Service: build_candidate_profile(messages, resume_context)
  Service->>Agent: create profile prompt
  Service->>LLM: complete(prompt)
  LLM-->>Service: profile JSON
  Service->>Agent: parse cautious profile
  Service-->>API: CandidateProfileResponse
  API-->>App: Profile page updates
```

## Memory Boundaries

- General Assistant starts with fresh general memory.
- Resume-led interview starts with fresh interview memory.
- Resume context is carried into interview mode.
- Previous general assistant turns do not leak into interview history.
- Candidate Profile uses the current active discussion/interview memory.

## Security And Governance

```mermaid
flowchart TD
  Request[Incoming Request] --> Actor[require_actor]
  Actor --> Rate[Rate Limit]
  Actor --> Consent[Optional Consent]
  Actor --> Token[Optional API Token]
  Request --> Upload{Upload?}
  Upload -->|Yes| Size[Upload Size Limit]
  Upload -->|Yes| Type[File Allowlist]
  Upload -->|Yes| Screen[Unsafe Marker Screen]
  Request --> PII[PII Redacted Logs]
  Request --> Audit[Metadata Audit JSONL]
  Request --> PromptGuard[Prompt Injection Cleanup]
```

## Current Limitations

- Expo Go uses short audio chunks, not native LiveKit streaming.
- Full LiveKit realtime voice requires a development build.
- No encrypted database because conversations are not persisted.
- No external malware scanner yet.
- No full identity provider/RBAC console yet.


