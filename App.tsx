import { StatusBar } from 'expo-status-bar';
import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type RecordingOptions,
  useAudioPlayer,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Speech from 'expo-speech';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type LanguageCode = 'hi' | 'en' | 'gu' | 'pa' | 'ta' | 'te' | 'bn' | 'mr' | 'kn' | 'ml' | 'od';
type Speaker = 'user' | 'agent' | 'system';
type LiveMode = 'ready' | 'listening' | 'thinking' | 'speaking' | 'ended';
type AppScreen = 'home' | 'live' | 'upload-resume' | 'create-resume' | 'candidate-profile';
type SessionMode = 'general' | 'interview';

type Language = {
  code: LanguageCode;
  label: string;
  nativeName: string;
  topic: string;
  greeting: string;
};

type Message = {
  id: number;
  speaker: Speaker;
  text: string;
  time: string;
};

type ResumeProfile = {
  role: string;
  summary: string;
  skills: string[];
  experience: string;
  interview_brief: string;
  resume_text: string;
  resume_text_hi?: string;
  resume_text_en?: string;
  source_note?: string;
};

type ResumeDraft = {
  name: string;
  work_type: string;
  location: string;
  experience: string;
  skills: string;
  projects: string;
  languages: string;
  extra_notes: string;
};

type ResumeVoiceStep = {
  field: keyof ResumeDraft;
  label: string;
  prompt: string;
  hint: string;
};

type CandidateProfile = {
  confidence: string;
  emotional_state: string;
  stress_signal: string;
  understanding_depth: string;
  strengths: string[];
  weaknesses: string[];
  interviewer_notes: string;
  next_deep_questions: string[];
};

const languages: Language[] = [
  {
    code: 'hi',
    label: 'Hindi',
    nativeName: '\u0939\u093f\u0928\u094d\u0926\u0940',
    topic: 'Kisan sahayata aur local services',
    greeting: 'Namaste. Main aapka sawal sunne ke liye taiyar hoon.',
  },
  {
    code: 'en',
    label: 'English',
    nativeName: 'English',
    topic: 'Community support and local services',
    greeting: 'Hello. I am ready to listen when you start.',
  },
  {
    code: 'gu',
    label: 'Gujarati',
    nativeName: '\u0a97\u0ac1\u0a9c\u0ab0\u0abe\u0aa4\u0ac0',
    topic: 'Local services and support',
    greeting: 'Namaste. Hu tamari vaat sambhalva taiyar chu.',
  },
  {
    code: 'pa',
    label: 'Punjabi',
    nativeName: '\u0a2a\u0a70\u0a1c\u0a3e\u0a2c\u0a40',
    topic: 'Local services and support',
    greeting: 'Sat sri akal. Main tuhadi gal sunan layi taiyar haan.',
  },
  {
    code: 'ta',
    label: 'Tamil',
    nativeName: '\u0ba4\u0bae\u0bbf\u0bb4\u0bcd',
    topic: 'Local services and support',
    greeting: 'Vanakkam. I am ready to listen when you start.',
  },
  {
    code: 'te',
    label: 'Telugu',
    nativeName: '\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41',
    topic: 'Local services and support',
    greeting: 'Namaste. I am ready to listen when you start.',
  },
  {
    code: 'bn',
    label: 'Bengali',
    nativeName: '\u09ac\u09be\u0982\u09b2\u09be',
    topic: 'Local services and support',
    greeting: 'Nomoskar. I am ready to listen when you start.',
  },
  {
    code: 'mr',
    label: 'Marathi',
    nativeName: '\u092e\u0930\u093e\u0920\u0940',
    topic: 'Local services and support',
    greeting: 'Namaskar. I am ready to listen when you start.',
  },
  {
    code: 'kn',
    label: 'Kannada',
    nativeName: '\u0c95\u0ca8\u0ccd\u0ca8\u0ca1',
    topic: 'Local services and support',
    greeting: 'Namaskara. I am ready to listen when you start.',
  },
  {
    code: 'ml',
    label: 'Malayalam',
    nativeName: '\u0d2e\u0d32\u0d2f\u0d3e\u0d33\u0d02',
    topic: 'Local services and support',
    greeting: 'Namaskaram. I am ready to listen when you start.',
  },
  {
    code: 'od',
    label: 'Odia',
    nativeName: '\u0b13\u0b21\u0b3c\u0b3f\u0b06',
    topic: 'Local services and support',
    greeting: 'Namaskar. I am ready to listen when you start.',
  },
];

const assistantSuggestions = ['Explain issue', 'Ask eligibility', 'Next action'];
const interviewSuggestions = ['Work example', 'Hardest challenge', 'Tools used'];
const bars = [1, 2, 3, 4, 5, 6, 7];
const enableSilencePrompts = false;
const silenceDelayMs = 7000;
const maxSilencePrompts = 2;
const livePauseTurnMs = 4500;
const noSpeechResetMs = 9000;
const minLiveSpeechMs = 1000;
const speechMeteringThreshold = -52;
const maxInterviewChunkSeconds = 24;
const candidateProfileTurnThreshold = 8;

const voiceRecordingOptions: RecordingOptions = {
  isMeteringEnabled: true,
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  android: {
    extension: '.m4a',
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
    sampleRate: 16000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.LOW,
    sampleRate: 16000,
    bitRateStrategy: 0,
    bitDepthHint: 16,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 32000,
  },
};

const getDefaultBackendUrl = () => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8787`;
  }

  return '';
};

const getClock = () =>
  new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());

const emptyResumeDraft: ResumeDraft = {
  name: '',
  work_type: '',
  location: '',
  experience: '',
  skills: '',
  projects: '',
  languages: '',
  extra_notes: '',
};

const resumeVoiceSteps: ResumeVoiceStep[] = [
  {
    field: 'name',
    label: 'नाम',
    prompt: 'Namaste. Sabse pehle apna poora naam batayein.',
    hint: 'Jaise: Mera naam Anuradha Sharma hai.',
  },
  {
    field: 'work_type',
    label: 'काम / भूमिका',
    prompt: 'Aap kis kaam ya role ke liye resume banana chahte hain?',
    hint: 'Jaise: plumber, carpenter, tuition teacher, assistant professor, content creator.',
  },
  {
    field: 'location',
    label: 'स्थान',
    prompt: 'Aap kis shehar ya area mein kaam karte hain?',
    hint: 'Jaise: Indore, Bhopal, Ahmedabad, ya remote.',
  },
  {
    field: 'experience',
    label: 'अनुभव',
    prompt: 'Apna total experience, zimmedariyan, aur kahan kaam kiya hai, batayein.',
    hint: 'Saal, dukaan/company/school/clients, aur daily kaam ka zikr karein.',
  },
  {
    field: 'skills',
    label: 'कौशल',
    prompt: 'Aapke main skills kya hain?',
    hint: 'Tools, subject, machine, technique, software, ya special kaam batayein.',
  },
  {
    field: 'projects',
    label: 'काम के उदाहरण',
    prompt: 'Apne ek ya do real kaam ke example batayein.',
    hint: 'Kya kiya, kiske liye kiya, aur result kya raha.',
  },
  {
    field: 'languages',
    label: 'भाषाएँ',
    prompt: 'Aap kaunsi bhashayen bol sakte hain ya kaam mein use kar sakte hain?',
    hint: 'Jaise: Hindi, English, Gujarati, Punjabi, Tamil.',
  },
  {
    field: 'extra_notes',
    label: 'अतिरिक्त जानकारी',
    prompt: 'Koi aur baat jo resume mein add karni ho?',
    hint: 'Achievement, certificate, availability, salary expectation, ya preference batayein.',
  },
];

const createMessage = (speaker: Speaker, text: string): Message => ({
  id: Date.now() + Math.floor(Math.random() * 1000),
  speaker,
  text,
  time: getClock(),
});

const detectReplyLanguage = (selectedLanguage: LanguageCode, text: string): LanguageCode => {
  const inferredCode = inferBrowserLanguageCode(text);
  if (inferredCode !== 'unknown') {
    return inferredCode.slice(0, 2) as LanguageCode;
  }
  if (/[A-Za-z]/.test(text) && !/[\u0900-\u097F]/.test(text)) {
    return 'en';
  }

  return selectedLanguage;
};

const replyFor = (languageCode: LanguageCode, text: string) => {
  const normalized = text.trim().toLowerCase();
  const askedAboutHearing =
    normalized.includes('hear me') ||
    normalized.includes('hearing me') ||
    normalized.includes('sun') ||
    normalized.includes('awaaz') ||
    normalized.includes('voice');
  const greeted =
    ['hi', 'hello', 'hey', 'namaste', 'namaskar'].some((word) => normalized === word) ||
    normalized.startsWith('hello ') ||
    normalized.startsWith('hi ');
  const wantsToExplain =
    normalized.includes('explain my issue') ||
    normalized.includes('problem') ||
    normalized.includes('issue') ||
    normalized.includes('samasy') ||
    normalized.includes('madad') ||
    normalized.includes('help');

  if (askedAboutHearing) {
    return 'On the laptop browser preview, I can listen if browser microphone permission is allowed. In Android Expo Go, live voice still needs the LiveKit development build.';
  }

  if (greeted) {
    if (languageCode === 'hi') {
      return 'Namaste. Main taiyar hoon. Aap apni baat ek line mein batayein, phir main follow-up puchunga.';
    }

    return 'Hello. I am ready. Tell me the situation in one line, then I will ask the next useful question.';
  }

  if (wantsToExplain) {
    if (languageCode === 'hi') {
      return 'Bilkul. Aap simple words mein bataiye: problem kya hai, kis jagah se related hai, aur aapko kis type ki madad chahiye?';
    }

    return 'Sure. Please explain it simply: what happened, where it is related to, and what kind of help you need.';
  }

  if (languageCode === 'hi') {
    return `Samjha. Is baat par aage badhne ke liye ek detail bataiye: "${text}" mein sabse urgent point kya hai?`;
  }

  return `Understood. To move forward, tell me one detail: what is the most urgent part of "${text}"?`;
};

const idlePromptFor = (languageCode: LanguageCode, attempt: number) => {
  if (languageCode === 'hi') {
    return attempt === 1
      ? 'Aap abhi bhi jude hue hain? Agar haan, kripya apna sawal ya zaroorat batayein.'
      : 'Main session ko khula rakh raha hoon. Kripya ek chhota jawab dein, warna main flow stop kar dunga.';
  }

  return attempt === 1
    ? 'Are you still there? If yes, please share your question or need.'
    : 'I will keep this open briefly. Please reply now, otherwise I will stop the flow.';
};

const stopPromptFor = (languageCode: LanguageCode) => {
  if (languageCode === 'hi') {
    return 'Koi jawab nahi mila, isliye cost bachane ke liye main session stop kar raha hoon.';
  }

  return 'No response received, so I am stopping the session to avoid extra API cost.';
};

const initialInterviewQuestionFor = (languageCode: LanguageCode, profile: ResumeProfile) => {
  if (languageCode === 'hi') {
    return `मैं आपका ${profile.role} interview शुरू कर रहा हूँ। पहला सवाल: अपने resume से एक real project या work example बताइए, जिसमें आपकी भूमिका साफ दिखती हो।`;
  }
  if (languageCode === 'gu') {
    return `Hu tamaru ${profile.role} interview sharu karu chu. Pehlo prashn: tamara resume mathi ek real project ya work example samjavo, jema tamari role clear hoy.`;
  }
  if (languageCode === 'pa') {
    return `Main tuhadda ${profile.role} interview shuru kar reha haan. Pehla sawaal: apne resume ton ek real project ya work example dasso, jithe tuhadi role clear hove.`;
  }
  if (languageCode === 'mr') {
    return `Mi tumcha ${profile.role} interview suru karto. Pahila prashna: resume madhun ek real project kiwa work example sanga, jithe tumchi role clear aahe.`;
  }

  return `I am starting your ${profile.role} interview. First question: describe one real project or work example from your resume where your role is clear.`;
};

const cleanSpokenText = (text: string) =>
  text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*/gi, '')
    .replace(/<\/think>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320);

const ttsLanguageFor = (languageCode: string) => {
  const normalized = languageCode.trim();
  const languageMap: Record<string, string> = {
    bn: 'bn-IN',
    en: 'en-IN',
    gu: 'gu-IN',
    hi: 'hi-IN',
    kn: 'kn-IN',
    ml: 'ml-IN',
    mr: 'mr-IN',
    od: 'od-IN',
    or: 'od-IN',
    pa: 'pa-IN',
    ta: 'ta-IN',
    te: 'te-IN',
  };

  if (/^[a-z]{2}-IN$/i.test(normalized)) {
    return normalized;
  }

  return languageMap[normalized.slice(0, 2).toLowerCase()] ?? 'hi-IN';
};

const inferBrowserLanguageCode = (text: string) => {
  if (/[\u0A80-\u0AFF]/.test(text)) return 'gu-IN';
  if (/[\u0A00-\u0A7F]/.test(text)) return 'pa-IN';
  if (/[\u0980-\u09FF]/.test(text)) return 'bn-IN';
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta-IN';
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te-IN';
  if (/[\u0900-\u097F]/.test(text)) return 'hi-IN';
  const lowered = ` ${text.toLowerCase()} `;
  const hinglishMarkers = [
    ' main ',
    ' maine ',
    ' mera ',
    ' meri ',
    ' mere ',
    ' mujhe ',
    ' aap ',
    ' apna ',
    ' apne ',
    ' kya ',
    ' kaise ',
    ' koshish ',
    ' bacchon ',
    ' bacho ',
    ' padha ',
    ' padhaya ',
    ' padha saken ',
    ' unki ',
    ' unke ',
    ' mein ',
    ' nahi ',
    ' haan ',
    ' theek ',
    ' kar ',
    ' kari ',
    ' kiya ',
    ' hua ',
    ' tha ',
    ' thi ',
    ' sir ',
    ' madam ',
  ];
  if (hinglishMarkers.some((marker) => lowered.includes(marker))) {
    return 'hi-IN';
  }
  return 'unknown';
};

const modeCopy: Record<LiveMode, string> = {
  ready: 'Ready',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  ended: 'Closed',
};

export default function App() {
  const recorder = useAudioRecorder(voiceRecordingOptions);
  const recorderState = useAudioRecorderState(recorder, 250);
  const sarvamPlayer = useAudioPlayer(null, { downloadFirst: true });
  const handoffPlayer = useAudioPlayer(null, { downloadFirst: true });
  const [screen, setScreen] = useState<AppScreen>('home');
  const [name, setName] = useState('');
  const [selectedCode, setSelectedCode] = useState<LanguageCode>('hi');
  const [backendUrl, setBackendUrl] = useState(getDefaultBackendUrl());
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationMemory, setConversationMemory] = useState<Message[]>([]);
  const [sessionMode, setSessionMode] = useState<SessionMode>('general');
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<LiveMode>('ready');
  const [captionsOn, setCaptionsOn] = useState(true);
  const [turn, setTurn] = useState(0);
  const [silencePrompts, setSilencePrompts] = useState(0);
  const [isAutoLive, setIsAutoLive] = useState(false);
  const [resumeProfile, setResumeProfile] = useState<ResumeProfile | null>(null);
  const [resumePaste, setResumePaste] = useState('');
  const [resumeDraft, setResumeDraft] = useState<ResumeDraft>(emptyResumeDraft);
  const [resumeStatus, setResumeStatus] = useState('Upload or paste a resume to prepare the interview.');
  const [isResumeBusy, setIsResumeBusy] = useState(false);
  const [isResumeVoiceRecording, setIsResumeVoiceRecording] = useState(false);
  const [resumeVoiceStepIndex, setResumeVoiceStepIndex] = useState(0);
  const [candidateProfile, setCandidateProfile] = useState<CandidateProfile | null>(null);
  const [isProfileBusy, setIsProfileBusy] = useState(false);
  const [profileStatus, setProfileStatus] = useState('Candidate profile appears after enough live turns.');
  const [pulse, setPulse] = useState(1);
  const [voiceStatus, setVoiceStatus] = useState(
    Platform.OS === 'web'
      ? 'Voice room is ready.'
      : 'Voice room is ready.',
  );
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionRef = useRef<any>(null);
  const browserSilenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const browserFinalTranscriptRef = useRef('');
  const browserInterimTranscriptRef = useRef('');
  const webMediaRecorderRef = useRef<any>(null);
  const webStreamRef = useRef<any>(null);
  const webAudioContextRef = useRef<any>(null);
  const webAnalyserRef = useRef<any>(null);
  const webVadFrameRef = useRef<number | null>(null);
  const webAudioChunksRef = useRef<Blob[]>([]);
  const webSubmitOnStopRef = useRef(false);
  const isSubmittingAudio = useRef(false);
  const isStoppingRecording = useRef(false);
  const autoLiveRef = useRef(false);
  const modeRef = useRef<LiveMode>('ready');
  const meteringAvailableRef = useRef(false);
  const speechStartedRef = useRef(false);
  const silenceStartedAtRef = useRef<number | null>(null);
  const lastSpeechAtRef = useRef<number | null>(null);
  const noiseFloorRef = useRef(-68);
  const handoffPlayedRef = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.title = 'Saarthi Live';
    }
  }, []);

  const selectedLanguage = useMemo(
    () => languages.find((language) => language.code === selectedCode) ?? languages[0],
    [selectedCode],
  );

  const resumeContext = useMemo(() => {
    if (!resumeProfile) {
      return '';
    }

    return [
      `Role: ${resumeProfile.role}`,
      `Summary: ${resumeProfile.summary}`,
      `Skills: ${resumeProfile.skills.join(', ')}`,
      `Experience: ${resumeProfile.experience}`,
      `Interview brief: ${resumeProfile.interview_brief}`,
      `Resume text: ${resumeProfile.resume_text}`,
    ].join('\n');
  }, [resumeProfile]);

  const conversationContext = useMemo(() => {
    const usefulMessages = [...conversationMemory, ...messages]
      .filter((message) => message.speaker === 'user' || message.speaker === 'agent')
      .slice(-14)
      .map((message) => `${message.speaker === 'user' ? 'Candidate' : 'Agent'}: ${message.text}`)
      .join('\n');

    const modeLine =
      sessionMode === 'interview'
        ? 'Mode: LIVE_INTERVIEW. Stay strictly in interviewer behavior.'
        : 'Mode: GENERAL_ASSISTANT. Maintain a natural two-way assistant conversation.';
    const profileLine =
      sessionMode === 'interview' && resumeContext ? `Loaded candidate profile:\n${resumeContext}` : '';
    return [modeLine, profileLine, usefulMessages ? `Recent context:\n${usefulMessages}` : ''].filter(Boolean).join('\n\n');
  }, [conversationMemory, messages, resumeContext, sessionMode]);

  const userTurnCount = useMemo(
    () => conversationMemory.filter((message) => message.speaker === 'user' && message.text.trim()).length,
    [conversationMemory],
  );

  const activeResumeVoiceStep = resumeVoiceSteps[resumeVoiceStepIndex];

  const currentResumeConsultantPrompt = useMemo(
    () => `${activeResumeVoiceStep.prompt} ${activeResumeVoiceStep.hint}`,
    [activeResumeVoiceStep],
  );

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const animation = setInterval(() => {
      setPulse((current) => (current % 7) + 1);
    }, mode === 'ready' ? 700 : 260);

    return () => clearInterval(animation);
  }, [mode]);

  const clearTimers = () => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current = [];
  };

  const clearIdleTimer = () => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  };

  const clearChunkTimer = () => {
    if (chunkTimer.current) {
      clearTimeout(chunkTimer.current);
      chunkTimer.current = null;
    }
  };

  const clearResumeTimer = () => {
    if (resumeTimer.current) {
      clearTimeout(resumeTimer.current);
      resumeTimer.current = null;
    }
  };

  const clearBrowserSilenceTimer = () => {
    if (browserSilenceTimer.current) {
      clearTimeout(browserSilenceTimer.current);
      browserSilenceTimer.current = null;
    }
  };

  const clearWebLiveAudio = () => {
    if (webVadFrameRef.current && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(webVadFrameRef.current);
      webVadFrameRef.current = null;
    }
    webStreamRef.current?.getTracks?.().forEach((track: any) => track.stop?.());
    webStreamRef.current = null;
    webAudioContextRef.current?.close?.().catch?.(() => undefined);
    webAudioContextRef.current = null;
    webAnalyserRef.current = null;
  };

  const stopWebLiveAudio = (submit: boolean) => {
    if (!webMediaRecorderRef.current) {
      clearWebLiveAudio();
      return;
    }

    webSubmitOnStopRef.current = submit;
    if (webMediaRecorderRef.current.state !== 'inactive') {
      webMediaRecorderRef.current.stop();
      return;
    }

    clearWebLiveAudio();
  };

  const setAutoLiveMode = (enabled: boolean) => {
    autoLiveRef.current = enabled;
    setIsAutoLive(enabled);
  };

  const rememberConversation = (items: Message[]) => {
    const usefulItems = items.filter((item) => item.speaker === 'user' || item.speaker === 'agent');
    if (!usefulItems.length) {
      return;
    }

    setConversationMemory((current) => [...current, ...usefulItems].slice(-80));
  };

  const resetLiveConversation = (profileMessage = 'Candidate profile appears after 8 candidate turns.') => {
    clearTimers();
    clearIdleTimer();
    clearChunkTimer();
    clearResumeTimer();
    clearBrowserSilenceTimer();
    recognitionRef.current?.stop?.();
    stopWebLiveAudio(false);
    sarvamPlayer.pause();
    handoffPlayer.pause();
    Speech.stop();
    setMessages([]);
    setConversationMemory([]);
    setCandidateProfile(null);
    setDraft('');
    setTurn(0);
    setSilencePrompts(0);
    setMode('ready');
    setAutoLiveMode(false);
    setIsSignedIn(false);
    setProfileStatus(profileMessage);
  };

  const playHandoffTone = async () => {
    const cleanBackendUrl = backendUrl.trim().replace(/\/$/, '');
    if (!cleanBackendUrl) {
      return;
    }

    try {
      handoffPlayer.replace({ uri: `${cleanBackendUrl}/handoff-tone?t=${Date.now()}` });
      handoffPlayer.play();
    } catch {
      // The tone is only a no-cost UX cue; the turn should continue even if audio playback is blocked.
    }
  };

  const speakText = async (text: string, languageCode: string) => {
    const cleanText = cleanSpokenText(text);
    if (!cleanText) {
      return;
    }

    const cleanBackendUrl = backendUrl.trim().replace(/\/$/, '');
    if (cleanBackendUrl) {
      try {
        Speech.stop();
        sarvamPlayer.pause();
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        });
        const audioUrl =
          `${cleanBackendUrl}/tts?text=${encodeURIComponent(cleanText)}` +
          `&language_code=${encodeURIComponent(ttsLanguageFor(languageCode))}` +
          `&t=${Date.now()}`;
        sarvamPlayer.replace({ uri: audioUrl });
        sarvamPlayer.play();
        setVoiceStatus(`Playing Sarvam voice in ${ttsLanguageFor(languageCode)}.`);
        return;
      } catch (error) {
        setVoiceStatus(error instanceof Error ? `Sarvam audio failed: ${error.message}` : 'Sarvam audio failed.');
      }
    }

    Speech.stop();
    Speech.speak(cleanText, {
      language: ttsLanguageFor(languageCode),
      rate: 0.96,
    });
  };

  const speakResumeConsultantPrompt = () => {
    void speakText(currentResumeConsultantPrompt, 'hi-IN');
    setResumeStatus(`Consultant pooch raha hai: ${activeResumeVoiceStep.prompt}`);
  };

  const addAgentReply = (userText: string) => {
    const replyLanguage = detectReplyLanguage(selectedCode, userText);
    const reply = replyFor(replyLanguage, userText);
    const replyMessage = createMessage('agent', reply);

    setMessages((current) => [...current, replyMessage]);
    rememberConversation([replyMessage]);
    void speakText(reply, replyLanguage);
  };

  const historyPayload = () =>
        JSON.stringify(
          [...conversationMemory, ...messages]
            .filter((message) => message.speaker === 'user' || message.speaker === 'agent')
            .slice(-16)
        .map((message) => ({
          role: message.speaker === 'user' ? 'user' : 'assistant',
          content: message.text,
        })),
    );

  const submitTextTurn = async (text: string) => {
    const transcriptText = text.trim();
    if (!transcriptText || isSubmittingAudio.current) {
      setMode('ready');
      return;
    }

    const cleanBackendUrl = backendUrl.trim().replace(/\/$/, '');
    if (!cleanBackendUrl) {
      setVoiceStatus('Set backend URL first. Use http://localhost:8787 on laptop web.');
      setMode('ready');
      return;
    }

    isSubmittingAudio.current = true;
    setMode('thinking');
    setVoiceStatus('Saarthi is thinking...');

    try {
      const response = await fetch(`${cleanBackendUrl}/text-turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: transcriptText,
          history: historyPayload(),
          context: conversationContext,
          mode: sessionMode,
          language_code: inferBrowserLanguageCode(transcriptText),
        }),
      });

      const responseText = await response.text();
      let payload: any = {};
      try {
        payload = responseText ? JSON.parse(responseText) : {};
      } catch {
        payload = { detail: responseText };
      }

      if (!response.ok) {
        throw new Error(payload.detail || 'Text turn failed.');
      }

      const reply = payload.reply?.trim() || 'I could not prepare a reply. Please try again.';
      setTurn((current) => current + 1);
      const userMessage = createMessage('user', payload.transcript?.trim() || transcriptText);
      const agentMessage = createMessage('agent', reply);
      setMessages((current) => [...current, userMessage, agentMessage]);
      rememberConversation([userMessage, agentMessage]);
      setMode('speaking');
      setVoiceStatus(payload.detected_language ? `Language matched: ${payload.detected_language}.` : 'Saarthi understood.');
      void speakText(reply, payload.reply_language || 'en-IN');

      const estimatedSpeechMs = Math.min(9000, Math.max(2800, reply.length * 85));
      const doneTimer = setTimeout(() => {
        if (autoLiveRef.current) {
          modeRef.current = 'ready';
          setMode('ready');
          setVoiceStatus('Listening again.');
          resumeTimer.current = setTimeout(() => {
            if (autoLiveRef.current) {
              startDeviceListening();
            }
          }, 450);
          return;
        }

        setMode('ready');
      }, estimatedSpeechMs);
      timers.current = [...timers.current, doneTimer];
    } catch (error) {
      setMode('ready');
      setVoiceStatus(error instanceof Error ? error.message : 'I missed that. Please continue.');
      if (autoLiveRef.current) {
        resumeTimer.current = setTimeout(() => {
          if (autoLiveRef.current) {
            startDeviceListening();
          }
        }, 1200);
      }
    } finally {
      isSubmittingAudio.current = false;
    }
  };

  const startBrowserListening = () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      setVoiceStatus('Voice is open on this device.');
      setMode('listening');
      return;
    }

    const mediaDevices = (navigator as any)?.mediaDevices;
    const MediaRecorderClass = (window as any).MediaRecorder;
    if (!mediaDevices?.getUserMedia || !MediaRecorderClass) {
      setVoiceStatus('This browser cannot open live audio. Use Chrome or Edge on the laptop.');
      setMode('listening');
      return;
    }

    mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      .then((stream: any) => {
        clearWebLiveAudio();
        webStreamRef.current = stream;
        webAudioChunksRef.current = [];
        webSubmitOnStopRef.current = false;
        speechStartedRef.current = false;
        lastSpeechAtRef.current = null;
        silenceStartedAtRef.current = null;
        handoffPlayedRef.current = false;
        noiseFloorRef.current = 0.008;

        const mimeType = MediaRecorderClass.isTypeSupported?.('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';
        const mediaRecorder = new MediaRecorderClass(stream, { mimeType });
        webMediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event: any) => {
          if (event.data?.size) {
            webAudioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          const shouldSubmit = webSubmitOnStopRef.current;
          const chunks = webAudioChunksRef.current;
          webSubmitOnStopRef.current = false;
          webAudioChunksRef.current = [];
          webMediaRecorderRef.current = null;
          clearWebLiveAudio();

          if (!shouldSubmit) {
            setMode('ready');
            if (autoLiveRef.current) {
              resumeTimer.current = setTimeout(() => startDeviceListening(), 700);
            }
            return;
          }

          const blob = new Blob(chunks, { type: mimeType });
          void submitWebAudioBlob(blob);
        };

        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioContextClass();
        audioContext.resume?.();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        webAudioContextRef.current = audioContext;
        webAnalyserRef.current = analyser;

        const startTime = Date.now();
        const watchAudio = () => {
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (let index = 0; index < samples.length; index += 1) {
            const value = (samples[index] - 128) / 128;
            sum += value * value;
          }
          const rms = Math.sqrt(sum / samples.length);
          const now = Date.now();
          const threshold = Math.max(0.012, noiseFloorRef.current * 1.9);
          const isSpeech = rms > threshold;

          if (!isSpeech) {
            noiseFloorRef.current = noiseFloorRef.current * 0.94 + rms * 0.06;
          }

          if (isSpeech) {
            if (!speechStartedRef.current) {
              setVoiceStatus('Voice heard. Keep speaking naturally.');
            }
            speechStartedRef.current = true;
            lastSpeechAtRef.current = now;
            silenceStartedAtRef.current = null;
            handoffPlayedRef.current = false;
          } else if (!speechStartedRef.current && now - startTime > noSpeechResetMs) {
            setVoiceStatus('Listening.');
            stopWebLiveAudio(false);
            return;
          } else if (speechStartedRef.current) {
            if (!silenceStartedAtRef.current) {
              silenceStartedAtRef.current = now;
            }
            const pauseMs = lastSpeechAtRef.current ? now - lastSpeechAtRef.current : now - silenceStartedAtRef.current;
            if (pauseMs >= Math.max(1200, livePauseTurnMs - 900) && !handoffPlayedRef.current) {
              handoffPlayedRef.current = true;
              setVoiceStatus('Pause heard. Saarthi is taking the turn...');
              void playHandoffTone();
            }
            if (pauseMs >= livePauseTurnMs) {
              stopWebLiveAudio(true);
              return;
            }
          }

          if (now - startTime > maxInterviewChunkSeconds * 1000) {
            stopWebLiveAudio(speechStartedRef.current);
            return;
          }

          webVadFrameRef.current = requestAnimationFrame(watchAudio);
        };

        mediaRecorder.start(250);
        setMode('listening');
        modeRef.current = 'listening';
        setDraft('');
        setVoiceStatus('Listening. Speak in any language.');
        webVadFrameRef.current = requestAnimationFrame(watchAudio);
      })
      .catch((error: any) => {
        setMode('ready');
        setVoiceStatus(error?.message ? `Microphone issue: ${error.message}` : 'Could not open microphone.');
      });
  };

  const submitAudioTurn = async (uri: string | null) => {
    if (!uri || isSubmittingAudio.current) {
      setMode('ready');
      setVoiceStatus('I did not catch your voice. Please continue.');
      return;
    }

    const cleanBackendUrl = backendUrl.trim().replace(/\/$/, '');
    if (!cleanBackendUrl) {
      setVoiceStatus('Set backend URL first. Use your laptop LAN URL, for example http://10.x.x.x:8787.');
      setMode('ready');
      return;
    }

    isSubmittingAudio.current = true;
    setMode('thinking');
    setVoiceStatus('Saarthi is thinking...');

    try {
      const formData = new FormData();

      if (Platform.OS === 'web') {
        const blob = await fetch(uri).then((response) => response.blob());
        if (blob.size < 1024) {
          throw new Error('I did not catch clear voice. Please say that once more.');
        }
        const webFileName = blob.type.includes('mp4') || blob.type.includes('m4a')
          ? 'voice-turn.m4a'
          : 'voice-turn.webm';
        formData.append('file', blob, webFileName);
      } else {
        formData.append('file', {
          uri,
          name: 'voice-turn.m4a',
          type: 'audio/x-m4a',
        } as any);
      }

      formData.append(
        'history',
        historyPayload(),
      );
      if (resumeContext) {
        formData.append('context', conversationContext);
      } else if (conversationContext) {
        formData.append('context', conversationContext);
      }
      formData.append('mode', sessionMode);

      const response = await fetch(`${cleanBackendUrl}/voice-turn`, {
        method: 'POST',
        body: formData,
      });

      const responseText = await response.text();
      let payload: any = {};
      try {
        payload = responseText ? JSON.parse(responseText) : {};
      } catch {
        payload = { detail: responseText };
      }

      if (!response.ok) {
        throw new Error(payload.detail || 'Voice turn failed.');
      }

      if (payload.ignored) {
        setMode('ready');
        setVoiceStatus(payload.reply || 'I heard unclear repeated audio. Please say that once again.');
        if (autoLiveRef.current) {
          resumeTimer.current = setTimeout(() => {
            if (autoLiveRef.current) {
              startDeviceListening();
            }
          }, 900);
        }
        return;
      }

      const transcript = payload.transcript?.trim() || '';
      const reply = payload.reply?.trim() || 'I could not prepare a reply. Please try again.';
      const replyLanguage = detectReplyLanguage(selectedCode, transcript || reply);

      setTurn((current) => current + 1);
      const userMessage = createMessage('user', transcript || '[unclear audio]');
      const agentMessage = createMessage('agent', reply);
      setMessages((current) => [...current, userMessage, agentMessage]);
      rememberConversation([userMessage, agentMessage]);
      setMode('speaking');
      setVoiceStatus(
        payload.detected_language
          ? `Detected language: ${payload.detected_language}.`
          : 'Saarthi understood.',
      );
      void speakText(reply, payload.reply_language || 'en-IN');

      const estimatedSpeechMs = Math.min(9000, Math.max(2800, reply.length * 85));
      const doneTimer = setTimeout(() => {
        if (autoLiveRef.current) {
          modeRef.current = 'ready';
          setMode('ready');
          setVoiceStatus('Listening again.');
          resumeTimer.current = setTimeout(() => {
            if (autoLiveRef.current) {
              startDeviceListening();
            }
          }, 250);
          return;
        }

        setMode('ready');
      }, estimatedSpeechMs);
      timers.current = [...timers.current, doneTimer];
    } catch (error) {
      setMode('ready');
      setVoiceStatus(error instanceof Error ? error.message : 'Voice turn failed. Please try again.');
      if (autoLiveRef.current) {
        resumeTimer.current = setTimeout(() => {
          if (autoLiveRef.current) {
            startDeviceListening();
          }
        }, 1200);
      }
    } finally {
      isSubmittingAudio.current = false;
    }
  };

  const submitWebAudioBlob = async (blob: Blob) => {
    if (isSubmittingAudio.current) {
      setMode('ready');
      return;
    }

    const cleanBackendUrl = backendUrl.trim().replace(/\/$/, '');
    if (!cleanBackendUrl) {
      setVoiceStatus('Set backend URL first. Use http://localhost:8787 on laptop web.');
      setMode('ready');
      return;
    }

    if (blob.size < 1024) {
      setVoiceStatus('I did not catch clear voice. Please continue.');
      if (autoLiveRef.current) {
        resumeTimer.current = setTimeout(() => startDeviceListening(), 800);
      }
      return;
    }

    isSubmittingAudio.current = true;
    setMode('thinking');
    setVoiceStatus('Saarthi is thinking...');

    try {
      const formData = new FormData();
      const fileName = blob.type.includes('mp4') || blob.type.includes('m4a') ? 'voice-turn.m4a' : 'voice-turn.webm';
      formData.append('file', blob, fileName);
      formData.append('history', historyPayload());
      formData.append('context', conversationContext);
      formData.append('mode', sessionMode);

      const response = await fetch(`${cleanBackendUrl}/voice-turn`, {
        method: 'POST',
        body: formData,
      });
      const responseText = await response.text();
      let payload: any = {};
      try {
        payload = responseText ? JSON.parse(responseText) : {};
      } catch {
        payload = { detail: responseText };
      }

      if (!response.ok) {
        throw new Error(payload.detail || 'Voice turn failed.');
      }

      if (payload.ignored) {
        setMode('ready');
        setVoiceStatus(payload.reply || 'I heard unclear repeated audio. Please say that once again.');
        if (autoLiveRef.current) {
          resumeTimer.current = setTimeout(() => {
            if (autoLiveRef.current) {
              startDeviceListening();
            }
          }, 900);
        }
        return;
      }

      const transcript = payload.transcript?.trim() || '';
      const reply = payload.reply?.trim() || 'I could not prepare a reply. Please try again.';
      const userMessage = createMessage('user', transcript || '[unclear audio]');
      const agentMessage = createMessage('agent', reply);

      setTurn((current) => current + 1);
      setMessages((current) => [...current, userMessage, agentMessage]);
      rememberConversation([userMessage, agentMessage]);
      setMode('speaking');
      setVoiceStatus(payload.detected_language ? `Language matched: ${payload.detected_language}.` : 'Saarthi understood.');
      void speakText(reply, payload.reply_language || payload.detected_language || 'hi-IN');

      const estimatedSpeechMs = Math.min(9000, Math.max(2800, reply.length * 85));
      const doneTimer = setTimeout(() => {
        if (autoLiveRef.current) {
          modeRef.current = 'ready';
          setMode('ready');
          setVoiceStatus('Listening again.');
          resumeTimer.current = setTimeout(() => {
            if (autoLiveRef.current) {
              startDeviceListening();
            }
          }, 450);
          return;
        }

        setMode('ready');
      }, estimatedSpeechMs);
      timers.current = [...timers.current, doneTimer];
    } catch (error) {
      setMode('ready');
      setVoiceStatus(error instanceof Error ? error.message : 'I missed that. Please continue.');
      if (autoLiveRef.current) {
        resumeTimer.current = setTimeout(() => {
          if (autoLiveRef.current) {
            startDeviceListening();
          }
        }, 1200);
      }
    } finally {
      isSubmittingAudio.current = false;
    }
  };

  const stopRecordingAndSubmit = async () => {
    if (isStoppingRecording.current) {
      return;
    }

    isStoppingRecording.current = true;
    clearChunkTimer();

    try {
      await recorder.stop();
      const uri = recorder.uri;
      await submitAudioTurn(uri);
    } catch (error) {
      setMode('ready');
      setVoiceStatus(error instanceof Error ? error.message : 'Could not stop recording.');
    } finally {
      isStoppingRecording.current = false;
    }
  };

  const stopRecordingWithoutSubmit = async () => {
    if (isStoppingRecording.current) {
      return;
    }

    isStoppingRecording.current = true;
    clearChunkTimer();

    try {
      await recorder.stop();
      modeRef.current = 'ready';
      setMode('ready');
      setVoiceStatus('Listening.');
      if (autoLiveRef.current) {
        resumeTimer.current = setTimeout(() => {
          if (autoLiveRef.current) {
            startDeviceListening();
          }
        }, 500);
      }
    } catch (error) {
      setMode('ready');
      setVoiceStatus(error instanceof Error ? error.message : 'Could not reset listening.');
    } finally {
      isStoppingRecording.current = false;
    }
  };

  const startDeviceListening = async () => {
    try {
      if (modeRef.current === 'listening' || isSubmittingAudio.current || isStoppingRecording.current) {
        return;
      }

      clearResumeTimer();
      if (Platform.OS === 'web') {
        startBrowserListening();
        return;
      }

      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setVoiceStatus('Microphone permission was denied.');
        setAutoLiveMode(false);
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      speechStartedRef.current = false;
      silenceStartedAtRef.current = null;
      lastSpeechAtRef.current = null;
      noiseFloorRef.current = -68;
      handoffPlayedRef.current = false;
      meteringAvailableRef.current = false;
      recorder.record();
      setMode('listening');
      setVoiceStatus(
        autoLiveRef.current
          ? 'Listening. Speak naturally.'
          : 'Listening. Speak naturally.',
      );
      chunkTimer.current = setTimeout(() => {
        if (autoLiveRef.current && meteringAvailableRef.current && !speechStartedRef.current) {
          stopRecordingWithoutSubmit();
          return;
        }

        stopRecordingAndSubmit();
      }, maxInterviewChunkSeconds * 1000);
    } catch (error) {
      setMode('ready');
      setVoiceStatus(error instanceof Error ? error.message : 'Could not start microphone.');
      setAutoLiveMode(false);
    }
  };

  useEffect(() => {
    if (!isAutoLive || mode !== 'listening' || isStoppingRecording.current) {
      return;
    }

    const metering = recorderState.metering;
    if (typeof metering !== 'number') {
      return;
    }
    meteringAvailableRef.current = true;

    const now = Date.now();
    const normalizedMetering = Math.max(-90, Math.min(0, metering));
    const dynamicSpeechThreshold = Math.max(
      speechMeteringThreshold,
      Math.min(-34, noiseFloorRef.current + 12),
    );
    const isSpeech = normalizedMetering > dynamicSpeechThreshold;

    if (!isSpeech) {
      noiseFloorRef.current = noiseFloorRef.current * 0.92 + normalizedMetering * 0.08;
    }

    if (isSpeech) {
      speechStartedRef.current = true;
      lastSpeechAtRef.current = now;
      silenceStartedAtRef.current = null;
      handoffPlayedRef.current = false;
      return;
    }

    if (!speechStartedRef.current && recorderState.durationMillis >= noSpeechResetMs) {
      setVoiceStatus('Listening.');
      stopRecordingWithoutSubmit();
      return;
    }

    if (!speechStartedRef.current || recorderState.durationMillis < minLiveSpeechMs) {
      return;
    }

    if (!silenceStartedAtRef.current) {
      silenceStartedAtRef.current = now;
    }

    const pauseMs = lastSpeechAtRef.current ? now - lastSpeechAtRef.current : now - silenceStartedAtRef.current;
    if (pauseMs >= Math.max(1200, livePauseTurnMs - 900) && !handoffPlayedRef.current) {
      handoffPlayedRef.current = true;
      setVoiceStatus('Pause heard. Saarthi is taking the turn...');
      void playHandoffTone();
    }

    if (pauseMs >= livePauseTurnMs) {
      setVoiceStatus('Saarthi is taking the turn...');
      stopRecordingAndSubmit();
    }
  }, [isAutoLive, mode, recorderState.durationMillis, recorderState.metering]);

  const scheduleIdleCheck = (attempt = silencePrompts) => {
    clearIdleTimer();

    if (!enableSilencePrompts) {
      return;
    }

    if (!isSignedIn || mode === 'ended' || mode === 'listening') {
      return;
    }

    idleTimer.current = setTimeout(() => {
      if (attempt >= maxSilencePrompts) {
        setMode('ended');
        setMessages((current) => [...current, createMessage('agent', stopPromptFor(selectedCode))]);
        return;
      }

      const nextAttempt = attempt + 1;
      setSilencePrompts(nextAttempt);
      setMode('speaking');
      setMessages((current) => [...current, createMessage('agent', idlePromptFor(selectedCode, nextAttempt))]);

      const readyTimer = setTimeout(() => {
        setMode('ready');
        scheduleIdleCheck(nextAttempt);
      }, 1700);

      timers.current = [...timers.current, readyTimer];
    }, silenceDelayMs);
  };

  useEffect(() => {
    if (isSignedIn && mode === 'ready') {
      scheduleIdleCheck();
    }

    return clearIdleTimer;
  }, [isSignedIn, mode, selectedCode]);

  useEffect(() => {
    if (screen === 'create-resume' && !isResumeVoiceRecording) {
      const timer = setTimeout(() => {
        speakResumeConsultantPrompt();
      }, 450);
      return () => clearTimeout(timer);
    }

    return undefined;
  }, [screen, resumeVoiceStepIndex]);

  const startSession = () => {
    const loginName = name.trim() || 'Guest';
    const isInterview = sessionMode === 'interview';
    const openingQuestion =
      isInterview && resumeProfile ? initialInterviewQuestionFor(selectedCode, resumeProfile) : selectedLanguage.greeting;
    setName(loginName);
    setMode(isInterview ? 'speaking' : 'ready');
    setTurn(0);
    setSilencePrompts(0);
    setProfileStatus(
      userTurnCount > 0
        ? `Continuing profile memory. Candidate turns: ${userTurnCount}.`
        : 'Candidate profile appears after 8 candidate turns.',
    );
    setMessages([
      createMessage('system', `${loginName} joined in ${selectedLanguage.label}.`),
      ...(isInterview && resumeProfile
        ? [
            createMessage(
              'system',
              `Interview context loaded for ${resumeProfile.role}. The session will stay interview-only.`,
            ),
          ]
        : []),
      createMessage(
        'agent',
        openingQuestion,
      ),
      createMessage(
        'system',
        isInterview
          ? 'Live Interview Mode is active. Saarthi will ask only interview-relevant questions.'
          : 'General AI Assistant Mode is active. Continue naturally with any contextual discussion.',
      ),
    ]);
    setIsSignedIn(true);
    setAutoLiveMode(true);
    if (isInterview) {
      setVoiceStatus('Interview begins now.');
      void speakText(openingQuestion, selectedCode);
      const openTimer = setTimeout(() => {
        if (autoLiveRef.current) {
          modeRef.current = 'ready';
          setMode('ready');
          void startDeviceListening();
        }
      }, Math.min(9000, Math.max(3200, openingQuestion.length * 75)));
      timers.current = [...timers.current, openTimer];
      return;
    }

    setVoiceStatus('Opening voice...');
    void startDeviceListening();
  };

  const endSession = () => {
    clearTimers();
    clearIdleTimer();
    clearChunkTimer();
    clearResumeTimer();
    clearBrowserSilenceTimer();
    recognitionRef.current?.stop?.();
    stopWebLiveAudio(false);
    sarvamPlayer.pause();
    handoffPlayer.pause();
    Speech.stop();
    setAutoLiveMode(false);
    setIsSignedIn(false);
    setMessages([]);
    setDraft('');
    setMode('ready');
    setTurn(0);
    setSilencePrompts(0);
    setProfileStatus(
      userTurnCount >= 4
        ? 'Discussion closed. Candidate profile can be refreshed now.'
        : `Discussion closed. Need more candidate turns for a useful profile. Current turns: ${userTurnCount}.`,
    );
    setVoiceStatus('Voice room is closed.');
  };

  const finishDiscussion = () => {
    const shouldFinish =
      typeof window === 'undefined' ||
      window.confirm('Finish this discussion and prepare the candidate profile?');
    if (!shouldFinish) {
      return;
    }

    endSession();
    setScreen('candidate-profile');
    setProfileStatus('Discussion finished. Preparing candidate profile...');
    setTimeout(() => {
      void buildCandidateProfile(true);
    }, 200);
  };

  const finishTurn = (text: string) => {
    const userText = text.trim();

    if (!userText) {
      setMode('ready');
      return;
    }

    clearTimers();
    clearIdleTimer();
    setDraft('');
    setTurn((current) => current + 1);
    setSilencePrompts(0);
    setMode('thinking');
    const userMessage = createMessage('user', userText);
    setMessages((current) => [...current, userMessage]);
    rememberConversation([userMessage]);

    const thinkingTimer = setTimeout(() => {
      setMode('speaking');
      addAgentReply(userText);
    }, 650);

    const doneTimer = setTimeout(() => {
      setMode('ready');
      scheduleIdleCheck(0);
    }, 2200);

    timers.current = [thinkingTimer, doneTimer];
  };

  const handleMicPress = () => {
    if (mode === 'speaking' || mode === 'thinking') {
      clearTimers();
      clearIdleTimer();
      clearChunkTimer();
      clearResumeTimer();
      Speech.stop();
      sarvamPlayer.pause();
      handoffPlayer.pause();
      setAutoLiveMode(false);
      setMode('ready');
      setSilencePrompts(0);
      setMessages((current) => [...current, createMessage('system', 'Saarthi paused. You can continue.')]);
      return;
    }

    if (mode === 'listening') {
      setAutoLiveMode(false);
      if (Platform.OS === 'web') {
        clearBrowserSilenceTimer();
        setDraft('');
        stopWebLiveAudio(speechStartedRef.current);
        if (!speechStartedRef.current) {
          setMode('ready');
          setVoiceStatus('Voice muted. Tap Voice On when ready.');
        }
        return;
      }
      stopRecordingAndSubmit();
      return;
    }

    if (mode === 'ended') {
      setMode('ready');
      setSilencePrompts(0);
      setMessages((current) => [...current, createMessage('system', 'Session resumed.')]);
      scheduleIdleCheck(0);
      return;
    }

    if (isAutoLive) {
      clearResumeTimer();
      clearBrowserSilenceTimer();
      recognitionRef.current?.stop?.();
      stopWebLiveAudio(false);
      setAutoLiveMode(false);
      setMode('ready');
      setVoiceStatus('Voice muted. Tap Voice On when ready.');
      return;
    }

    clearIdleTimer();
    setAutoLiveMode(true);
    startDeviceListening();
  };

  const sendSuggestion = (suggestion: string) => {
    const suggestionText =
      sessionMode === 'interview'
        ? suggestion === 'Work example'
          ? 'I will describe one real work example from my experience.'
          : suggestion === 'Hardest challenge'
            ? 'Please ask me about the hardest challenge in my work.'
            : 'Please ask me about the tools and methods I used.'
        : suggestion === 'Explain issue'
          ? 'I want to explain my issue in simple words.'
          : suggestion === 'Ask eligibility'
            ? 'Please check whether I am eligible for support.'
            : 'What should I do next?';

    finishTurn(suggestionText);
  };

  const analyzeResume = async (fileAsset?: DocumentPicker.DocumentPickerAsset) => {
    const cleanBackendUrl = backendUrl.trim().replace(/\/$/, '');
    if (!cleanBackendUrl) {
      setResumeStatus('Set backend URL first, for example http://10.x.x.x:8787.');
      return;
    }

    if (!fileAsset && !resumePaste.trim()) {
      setResumeStatus('Paste resume text or choose a TXT/PDF/DOCX file.');
      return;
    }

    setIsResumeBusy(true);
    setResumeStatus('Analyzing resume with Sarvam-m...');

    try {
      const formData = new FormData();
      if (resumePaste.trim()) {
        formData.append('text', resumePaste.trim());
      }

      if (fileAsset) {
        if (Platform.OS === 'web') {
          const blob = await fetch(fileAsset.uri).then((fileResponse) => fileResponse.blob());
          formData.append('file', blob, fileAsset.name || 'resume');
        } else {
          formData.append('file', {
            uri: fileAsset.uri,
            name: fileAsset.name || 'resume',
            type: fileAsset.mimeType || 'application/octet-stream',
          } as any);
        }
      }

      const response = await fetch(`${cleanBackendUrl}/resume/analyze`, {
        method: 'POST',
        body: formData,
      });
      const responseText = await response.text();
      let payload: any = {};
      try {
        payload = responseText ? JSON.parse(responseText) : {};
      } catch {
        payload = { detail: responseText };
      }
      if (!response.ok) {
        const detail = Array.isArray(payload.detail)
          ? payload.detail.map((item: any) => item.msg || JSON.stringify(item)).join(' ')
          : payload.detail;
        throw new Error(detail || 'Resume analysis failed.');
      }

      setResumeProfile(payload);
      setResumeStatus(`${payload.source_note || 'Resume uploaded.'} Ready to start the interview.`);
      setSessionMode('interview');
    } catch (error) {
      setResumeStatus(error instanceof Error ? error.message : 'Resume analysis failed.');
    } finally {
      setIsResumeBusy(false);
    }
  };

  const pickResumeFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'text/plain',
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'image/*',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled) {
        return;
      }

      await analyzeResume(result.assets[0]);
    } catch (error) {
      setResumeStatus(error instanceof Error ? error.message : 'Could not open document picker.');
    }
  };

  const buildResume = async () => {
    const cleanBackendUrl = backendUrl.trim().replace(/\/$/, '');
    if (!cleanBackendUrl) {
      setResumeStatus('Set backend URL first, for example http://10.x.x.x:8787.');
      return;
    }

    if (!resumeDraft.work_type.trim() && !resumeDraft.skills.trim() && !resumeDraft.experience.trim()) {
      setResumeStatus('Add at least work type, skills, or experience.');
      return;
    }

    setIsResumeBusy(true);
    setResumeStatus('Creating resume with Sarvam-m...');

    try {
      const response = await fetch(`${cleanBackendUrl}/resume/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resumeDraft),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || 'Resume build failed.');
      }

      setResumeProfile(payload);
      setResumePaste(payload.resume_text || '');
      setResumeStatus('Resume Hindi aur English dono mein ready hai. Aap download kar sakte hain ya interview start kar sakte hain.');
      setSessionMode('interview');
    } catch (error) {
      setResumeStatus(error instanceof Error ? error.message : 'Resume build failed.');
    } finally {
      setIsResumeBusy(false);
    }
  };

  const startResumeVoiceDetails = async () => {
    try {
      Speech.stop();
      sarvamPlayer.pause();
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setResumeStatus('Microphone permission was denied.');
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsResumeVoiceRecording(true);
      setResumeStatus(`Consultant sun raha hai: ${activeResumeVoiceStep.prompt}`);
    } catch (error) {
      setIsResumeVoiceRecording(false);
      setResumeStatus(error instanceof Error ? error.message : 'Could not start resume voice capture.');
    }
  };

  const stopResumeVoiceDetails = async () => {
    const cleanBackendUrl = backendUrl.trim().replace(/\/$/, '');
    if (!cleanBackendUrl) {
      setResumeStatus('Set backend URL first, for example http://10.x.x.x:8787.');
      return;
    }

    setIsResumeBusy(true);
    setResumeStatus('Transcribing resume details with Sarvam STT...');

    try {
      await recorder.stop();
      setIsResumeVoiceRecording(false);
      const uri = recorder.uri;
      if (!uri) {
        throw new Error('No voice note was captured.');
      }

      const formData = new FormData();
      if (Platform.OS === 'web') {
        const blob = await fetch(uri).then((response) => response.blob());
        const webFileName = blob.type.includes('mp4') || blob.type.includes('m4a')
          ? 'resume-details.m4a'
          : 'resume-details.webm';
        formData.append('file', blob, webFileName);
      } else {
        formData.append('file', {
          uri,
          name: 'resume-details.m4a',
          type: 'audio/x-m4a',
        } as any);
      }

      const response = await fetch(`${cleanBackendUrl}/speech/transcribe`, {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || 'Resume voice transcription failed.');
      }

      const transcript = String(payload.transcript || '').trim();
      if (!transcript) {
        throw new Error('I could not hear clear resume details. Please try again.');
      }

      setResumeDraft((current) => ({
        ...current,
        [activeResumeVoiceStep.field]: [current[activeResumeVoiceStep.field], transcript].filter(Boolean).join('\n'),
      }));
      const isLastStep = resumeVoiceStepIndex >= resumeVoiceSteps.length - 1;
      setResumeStatus(
        `${activeResumeVoiceStep.label} save ho gaya. Detected ${payload.detected_language || 'language automatically'}. ${
          isLastStep ? 'Ab resume create kar sakte hain.' : 'Agla sawal choose karein ya isi answer ko dobara record karein.'
        }`,
      );
      if (!isLastStep) {
        setResumeVoiceStepIndex((current) => Math.min(current + 1, resumeVoiceSteps.length - 1));
      }
    } catch (error) {
      setIsResumeVoiceRecording(false);
      setResumeStatus(error instanceof Error ? error.message : 'Resume voice transcription failed.');
    } finally {
      setIsResumeBusy(false);
    }
  };

  const handleResumeVoicePress = () => {
    if (isResumeVoiceRecording) {
      void stopResumeVoiceDetails();
      return;
    }

    void startResumeVoiceDetails();
  };

  const moveResumeVoiceStep = (direction: -1 | 1) => {
    if (isResumeVoiceRecording) {
      setResumeStatus('Stop the current voice answer before changing prompt.');
      return;
    }

    setResumeVoiceStepIndex((current) => {
      const next = Math.max(0, Math.min(resumeVoiceSteps.length - 1, current + direction));
      const step = resumeVoiceSteps[next];
      setResumeStatus(`Sawal ${next + 1}/${resumeVoiceSteps.length}: ${step.prompt}`);
      return next;
    });
  };

  const clearActiveResumeVoiceField = () => {
    if (isResumeVoiceRecording) {
      setResumeStatus('Stop the current voice answer before clearing this field.');
      return;
    }

    setResumeDraft((current) => ({ ...current, [activeResumeVoiceStep.field]: '' }));
    setResumeStatus(`${activeResumeVoiceStep.label} cleared.`);
  };

  const buildCandidateProfile = async (force = false) => {
    const cleanBackendUrl = backendUrl.trim().replace(/\/$/, '');
    if (!cleanBackendUrl) {
      setProfileStatus('Set backend URL first to build the candidate profile.');
      return;
    }

    if (!force && candidateProfile) {
      return;
    }

    if (userTurnCount < 4) {
      setProfileStatus(`Need a few more candidate turns. Current turns: ${userTurnCount}.`);
      return;
    }

    setIsProfileBusy(true);
    setProfileStatus('Analyzing confidence, stress, depth, strengths, and weak areas...');

    try {
      const response = await fetch(`${cleanBackendUrl}/candidate/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resume_context: resumeContext,
          messages: [...conversationMemory, ...messages]
            .filter((message) => message.speaker === 'user' || message.speaker === 'agent')
            .slice(-24)
            .map((message) => ({
              role: message.speaker === 'user' ? 'user' : 'assistant',
              content: message.text,
            })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || 'Candidate profile failed.');
      }

      setCandidateProfile(payload);
      setProfileStatus('Candidate profile is ready.');
    } catch (error) {
      setProfileStatus(error instanceof Error ? error.message : 'Candidate profile failed.');
    } finally {
      setIsProfileBusy(false);
    }
  };

  useEffect(() => {
    if (isSignedIn && userTurnCount >= candidateProfileTurnThreshold && !candidateProfile && !isProfileBusy) {
      void buildCandidateProfile();
    }
  }, [isSignedIn, userTurnCount, candidateProfile, isProfileBusy, conversationMemory]);

  const downloadResume = async () => {
    if (!resumeProfile?.resume_text) {
      setResumeStatus('Create or upload a resume first.');
      return;
    }

    if (Platform.OS !== 'web') {
      try {
        const safeName = `${resumeProfile.role || 'resume'}.txt`.replace(/[^A-Za-z0-9_.-]/g, '_');
        const documentDirectory = FileSystem.documentDirectory;
        if (!documentDirectory) {
          throw new Error('App document directory is not available on this device.');
        }
        const fileUri = `${documentDirectory}${safeName}`;
        await FileSystem.writeAsStringAsync(fileUri, resumeProfile.resume_text);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'text/plain',
            dialogTitle: 'Download resume',
          });
          setResumeStatus('Resume is ready to save or share.');
          return;
        }
        setResumeStatus(`Resume saved in app documents as ${safeName}.`);
      } catch (error) {
        setResumeStatus(error instanceof Error ? error.message : 'Could not prepare resume download.');
      }
      return;
    }

    const blob = new Blob([resumeProfile.resume_text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${resumeProfile.role || 'resume'}.txt`.replace(/[^A-Za-z0-9_.-]/g, '_');
    link.click();
    URL.revokeObjectURL(url);
  };

  const startInterviewFromResume = () => {
    if (!resumeProfile) {
      setResumeStatus('Upload or create a resume before starting interview mode.');
      return;
    }
    resetLiveConversation('Fresh resume-led interview memory. Candidate profile will use only this interview.');
    setSessionMode('interview');
    setScreen('live');
    setResumeStatus('Interview mode is loaded from this resume. Previous general assistant turns are not mixed in.');
  };

  const startGeneralAssistant = () => {
    resetLiveConversation('Fresh general assistant discussion. Candidate profile will use only this discussion.');
    setSessionMode('general');
    setScreen('live');
  };

  const updateResumeDraft = (field: keyof ResumeDraft, value: string) => {
    setResumeDraft((current) => ({ ...current, [field]: value }));
  };

  const renderResumeProfile = () =>
    resumeProfile ? (
      <View style={styles.resumePreview}>
        <Text style={styles.readyPill}>Ready for interview</Text>
        <Text style={styles.resumeRole}>{resumeProfile.role}</Text>
        <Text style={styles.resumeSummary}>{resumeProfile.summary}</Text>
        <Text style={styles.resumeMeta}>Skills: {resumeProfile.skills.join(', ')}</Text>
        <Text style={styles.resumeMeta}>{resumeProfile.interview_brief}</Text>
        {(resumeProfile.resume_text_hi || resumeProfile.resume_text_en) && (
          <Text style={styles.resumeMeta}>Download includes Hindi and English resume versions.</Text>
        )}
      </View>
    ) : null;

  if (screen === 'home') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.homeContent}>
          <View style={styles.brandLockup}>
            <View style={styles.brandMark}>
              <Text style={styles.brandMarkText}>S</Text>
            </View>
            <View style={styles.brandTitleRow}>
              <Text style={styles.brandName}>Saarthi Live</Text>
              <Image source={require('./assets/peacock-feather-original.png')} style={styles.brandFeather} />
            </View>
            <Text style={styles.brandLine}>General assistant plus resume-led interviews</Text>
          </View>

          <Pressable accessibilityRole="button" onPress={startGeneralAssistant} style={styles.featureButton}>
            <Text style={styles.featureTitle}>General AI Assistant</Text>
            <Text style={styles.featureText}>A natural two-way voice assistant for contextual discussions.</Text>
          </Pressable>

          <Pressable accessibilityRole="button" onPress={() => setScreen('upload-resume')} style={styles.featureButton}>
            <Text style={styles.featureTitle}>Upload Resume</Text>
            <Text style={styles.featureText}>Upload TXT/PDF/DOCX or paste a written resume.</Text>
          </Pressable>

          <Pressable accessibilityRole="button" onPress={() => setScreen('create-resume')} style={styles.featureButton}>
            <Text style={styles.featureTitle}>Hindi Consultant Resume</Text>
            <Text style={styles.featureText}>Local users ke liye Hindi voice questions se resume banayein.</Text>
          </Pressable>

          <Pressable accessibilityRole="button" onPress={() => setScreen('candidate-profile')} style={styles.featureButton}>
            <Text style={styles.featureTitle}>Candidate Profile</Text>
            <Text style={styles.featureText}>Review confidence, stress, understanding depth, strengths, and weak areas after live turns.</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'candidate-profile') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.homeContent}>
          <Pressable accessibilityRole="button" onPress={() => setScreen(isSignedIn ? 'live' : 'home')} style={styles.backButton}>
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
          <Text style={styles.pageTitle}>Candidate Profile</Text>
          <Text style={styles.pageCopy}>Generated from the live conversation after enough candidate turns. It is an interviewer aid, not a final judgement.</Text>

          <Pressable
            accessibilityRole="button"
            onPress={() => buildCandidateProfile(true)}
            style={[styles.primaryButton, userTurnCount < 4 && styles.sendButtonDisabled]}
            disabled={userTurnCount < 4 || isProfileBusy}
          >
            <Text style={styles.primaryButtonText}>
              {isProfileBusy ? 'Analyzing...' : candidateProfile ? 'Refresh Profile' : 'Build Profile'}
            </Text>
          </Pressable>
          <Text style={styles.voiceNoticeText}>
            {profileStatus} Candidate turns: {userTurnCount}.
          </Text>

          {candidateProfile ? (
            <View style={styles.profileGrid}>
              {[
                ['Confidence', candidateProfile.confidence],
                ['State & Emotion', candidateProfile.emotional_state],
                ['Stress Signal', candidateProfile.stress_signal],
                ['Understanding Depth', candidateProfile.understanding_depth],
              ].map(([label, value]) => (
                <View key={label} style={styles.profileTile}>
                  <Text style={styles.profileLabel}>{label}</Text>
                  <Text style={styles.profileValue}>{value}</Text>
                </View>
              ))}

              <View style={styles.resumePreview}>
                <Text style={styles.resumeRole}>Strengths</Text>
                {candidateProfile.strengths.map((item) => (
                  <Text key={item} style={styles.resumeMeta}>- {item}</Text>
                ))}
              </View>

              <View style={styles.resumePreview}>
                <Text style={styles.resumeRole}>Weak Areas</Text>
                {candidateProfile.weaknesses.map((item) => (
                  <Text key={item} style={styles.resumeMeta}>- {item}</Text>
                ))}
              </View>

              <View style={styles.resumePreview}>
                <Text style={styles.resumeRole}>Interviewer Notes</Text>
                <Text style={styles.resumeSummary}>{candidateProfile.interviewer_notes}</Text>
              </View>

              <View style={styles.resumePreview}>
                <Text style={styles.resumeRole}>Next Deep Questions</Text>
                {candidateProfile.next_deep_questions.map((item) => (
                  <Text key={item} style={styles.resumeMeta}>- {item}</Text>
                ))}
              </View>
            </View>
          ) : (
            <View style={styles.resumePreview}>
              <Text style={styles.resumeRole}>Waiting for more signal</Text>
              <Text style={styles.resumeSummary}>Run the live interview for 8-10 candidate turns, then this page will fill automatically.</Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'upload-resume') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.homeContent}>
          <Pressable accessibilityRole="button" onPress={() => setScreen('home')} style={styles.backButton}>
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
          <Text style={styles.pageTitle}>Upload Resume</Text>
          <Text style={styles.pageCopy}>Use TXT, PDF, DOCX, or paste the resume text. Once analyzed, Saarthi will interview from this profile and drill into the real work details.</Text>

          <Text style={styles.fieldLabel}>Backend URL</Text>
          <TextInput
            value={backendUrl}
            onChangeText={setBackendUrl}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://your-laptop-ip:8787"
            placeholderTextColor="#7B8794"
            style={styles.input}
          />

          <Pressable accessibilityRole="button" onPress={pickResumeFile} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Choose Resume File</Text>
          </Pressable>

          <Text style={styles.fieldLabel}>Paste Resume Text</Text>
          <TextInput
            value={resumePaste}
            onChangeText={setResumePaste}
            multiline
            placeholder="Paste written resume, work history, or profile notes..."
            placeholderTextColor="#7B8794"
            style={styles.largeInput}
          />
          <Pressable accessibilityRole="button" onPress={() => analyzeResume()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>{isResumeBusy ? 'Analyzing...' : 'Analyze Pasted Resume'}</Text>
          </Pressable>

          <Text style={styles.voiceNoticeText}>{resumeStatus}</Text>
          {renderResumeProfile()}

          <View style={styles.actionRow}>
            <Pressable accessibilityRole="button" onPress={downloadResume} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Download</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={startInterviewFromResume}
              style={[styles.primaryButtonFlex, !resumeProfile && styles.sendButtonDisabled]}
              disabled={!resumeProfile}
            >
              <Text style={styles.primaryButtonText}>Start Interview</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'create-resume') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.homeContent}>
          <Pressable accessibilityRole="button" onPress={() => setScreen('home')} style={styles.backButton}>
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
          <Text style={styles.pageTitle}>Hindi Consultant Resume</Text>
          <Text style={styles.pageCopy}>Hindi consultant ki tarah sawal jawab karke details collect karein. Resume Hindi aur English dono mein download hoga.</Text>

          <Text style={styles.fieldLabel}>Backend URL</Text>
          <TextInput value={backendUrl} onChangeText={setBackendUrl} autoCapitalize="none" autoCorrect={false} placeholder="http://your-laptop-ip:8787" placeholderTextColor="#7B8794" style={styles.input} />

          <View style={styles.resumeVoicePanel}>
            <Text style={styles.readyPill}>Hindi Voice Consultant</Text>
            <Text style={styles.resumeRole}>
              {resumeVoiceStepIndex + 1}/{resumeVoiceSteps.length}. {activeResumeVoiceStep.label}
            </Text>
            <Text style={styles.resumeSummary}>{activeResumeVoiceStep.prompt}</Text>
            <Text style={styles.resumeMeta}>{activeResumeVoiceStep.hint}</Text>
            {!!resumeDraft[activeResumeVoiceStep.field] && (
              <Text style={styles.resumeMeta}>Current: {resumeDraft[activeResumeVoiceStep.field]}</Text>
            )}

            <View style={styles.actionRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => moveResumeVoiceStep(-1)}
                style={[styles.secondaryButtonFlex, resumeVoiceStepIndex === 0 && styles.sendButtonDisabled]}
                disabled={resumeVoiceStepIndex === 0}
              >
                <Text style={styles.secondaryButtonText}>Previous</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => moveResumeVoiceStep(1)}
                style={[styles.secondaryButtonFlex, resumeVoiceStepIndex === resumeVoiceSteps.length - 1 && styles.sendButtonDisabled]}
                disabled={resumeVoiceStepIndex === resumeVoiceSteps.length - 1}
              >
                <Text style={styles.secondaryButtonText}>Next</Text>
              </Pressable>
            </View>

            <Pressable accessibilityRole="button" onPress={speakResumeConsultantPrompt} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Sawal Dobara Sunayein</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={handleResumeVoicePress}
              style={[styles.primaryButton, isResumeVoiceRecording && styles.dangerButton]}
            >
              <Text style={styles.primaryButtonText}>
                {isResumeVoiceRecording ? 'Stop & Save Answer' : `${activeResumeVoiceStep.label} Voice Se Batayein`}
              </Text>
            </Pressable>

            <Pressable accessibilityRole="button" onPress={clearActiveResumeVoiceField} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Is Answer Ko Clear Karein</Text>
            </Pressable>
          </View>

          {([
            ['name', 'Naam'],
            ['work_type', 'Kaam / Role'],
            ['location', 'Location'],
            ['experience', 'Experience'],
            ['skills', 'Skills'],
            ['projects', 'Kaam Ke Examples'],
            ['languages', 'Languages'],
            ['extra_notes', 'Extra Notes'],
          ] as Array<[keyof ResumeDraft, string]>).map(([field, label]) => (
            <View key={field}>
              <Text style={styles.fieldLabel}>{label}</Text>
              <TextInput
                value={resumeDraft[field]}
                onChangeText={(value) => updateResumeDraft(field, value)}
                multiline={field === 'projects' || field === 'extra_notes'}
                placeholder={label}
                placeholderTextColor="#7B8794"
                style={field === 'projects' || field === 'extra_notes' ? styles.largeInputCompact : styles.input}
              />
            </View>
          ))}

          <Pressable accessibilityRole="button" onPress={buildResume} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{isResumeBusy ? 'Resume ban raha hai...' : 'Hindi + English Resume Banayein'}</Text>
          </Pressable>
          <Text style={styles.voiceNoticeText}>{resumeStatus}</Text>
          {renderResumeProfile()}

          <View style={styles.actionRow}>
            <Pressable accessibilityRole="button" onPress={downloadResume} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Download</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={startInterviewFromResume}
              style={[styles.primaryButtonFlex, !resumeProfile && styles.sendButtonDisabled]}
              disabled={!resumeProfile}
            >
              <Text style={styles.primaryButtonText}>Start Interview</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!isSignedIn) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardView}
        >
          <ScrollView contentContainerStyle={styles.loginContent}>
            <Pressable accessibilityRole="button" onPress={() => setScreen('home')} style={styles.backButton}>
              <Text style={styles.backButtonText}>Back</Text>
            </Pressable>
            <View style={styles.brandLockup}>
              <View style={styles.brandMark}>
                <Text style={styles.brandMarkText}>S</Text>
              </View>
              <View style={styles.brandTitleRow}>
                <Text style={styles.brandName}>Saarthi Live</Text>
                <Image source={require('./assets/peacock-feather-original.png')} style={styles.brandFeather} />
              </View>
              <Text style={styles.brandLine}>
                {sessionMode === 'interview' ? 'Resume-led live interview' : 'General multilingual assistant'}
              </Text>
            </View>

            <View style={styles.formPanel}>
              <Text style={styles.sectionTitle}>
                {sessionMode === 'interview' ? 'Interview Setup' : 'Assistant Setup'}
              </Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Name"
                placeholderTextColor="#7B8794"
                style={styles.input}
              />

              <Text style={styles.fieldLabel}>Backend URL</Text>
              <TextInput
                value={backendUrl}
                onChangeText={setBackendUrl}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="http://your-laptop-ip:8787"
                placeholderTextColor="#7B8794"
                style={styles.input}
              />

              <Text style={styles.fieldLabel}>Language</Text>
              <View style={styles.languageGrid}>
                {languages.map((language) => {
                  const isSelected = language.code === selectedCode;

                  return (
                    <Pressable
                      accessibilityRole="button"
                      key={language.code}
                      onPress={() => setSelectedCode(language.code)}
                      style={[styles.languageButton, isSelected && styles.languageButtonSelected]}
                    >
                      <Text
                        style={[
                          styles.languageNative,
                          isSelected && styles.languageNativeSelected,
                        ]}
                      >
                        {language.nativeName}
                      </Text>
                      <Text style={[styles.languageLabel, isSelected && styles.languageLabelSelected]}>
                        {language.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable accessibilityRole="button" onPress={startSession} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>
                  {sessionMode === 'interview' ? 'Start Interview' : 'Enter Voice Room'}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  const isActive = mode !== 'ready';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <View style={styles.appShell}>
          <View style={styles.topBar}>
            <View>
              <Text style={styles.userName}>{name}</Text>
              <Text style={styles.topicText}>
                {sessionMode === 'interview'
                  ? resumeProfile?.role
                    ? `Interview: ${resumeProfile.role}`
                    : 'Interview'
                  : 'General AI Assistant'}
              </Text>
            </View>
            <View style={styles.topActions}>
              <Pressable accessibilityRole="button" onPress={() => setScreen('candidate-profile')} style={styles.profileButton}>
                <Text style={styles.profileButtonText}>
                  {candidateProfile ? 'Profile' : `${userTurnCount}/${candidateProfileTurnThreshold}`}
                </Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={finishDiscussion} style={styles.endButton}>
                <Text style={styles.endButtonText}>Finish</Text>
              </Pressable>
            </View>
          </View>

          <View style={[styles.liveStage, isActive && styles.liveStageActive]}>
            <View style={styles.stageHeader}>
              <View>
                <Text style={styles.liveLabel}>
                  {sessionMode === 'interview' ? 'Live Interview' : selectedLanguage.nativeName}
                </Text>
                <Text style={styles.liveState}>{modeCopy[mode]}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => setCaptionsOn((current) => !current)}
                style={styles.captionButton}
              >
                <Text style={styles.captionButtonText}>{captionsOn ? 'Captions on' : 'Captions off'}</Text>
              </Pressable>
            </View>

            <View style={styles.waveArea}>
              {bars.map((bar) => (
                <View
                  key={bar}
                  style={[
                    styles.waveBar,
                    {
                      height: 22 + Math.abs(pulse - bar) * (mode === 'ready' ? 4 : 8),
                      opacity: mode === 'ready' ? 0.5 : 1,
                    },
                  ]}
                />
              ))}
            </View>

            {captionsOn && (
              <View style={styles.captionPanel}>
                <Text style={styles.captionText}>
                  {mode === 'listening'
                    ? draft || 'Listening. Speak naturally.'
                    : mode === 'thinking'
                      ? 'Saarthi is thinking...'
                      : mode === 'speaking'
                        ? 'Saarthi is responding. You can interrupt anytime.'
                        : mode === 'ended'
                          ? 'Voice room is closed.'
                          : silencePrompts > 0
                            ? `Waiting for user. Silence prompt ${silencePrompts}/${maxSilencePrompts}.`
                            : isAutoLive
                              ? 'Voice is open.'
                              : 'Voice is muted.'}
                </Text>
              </View>
            )}
          </View>

          <ScrollView contentContainerStyle={styles.threadContent} showsVerticalScrollIndicator={false}>
            {messages.map((message) => {
              const isAgent = message.speaker === 'agent';
              const isSystem = message.speaker === 'system';

              return (
                <View
                  key={message.id}
                  style={[
                    styles.messageRow,
                    isAgent && styles.agentRow,
                    isSystem && styles.systemRow,
                  ]}
                >
                  <View
                    style={[
                      styles.messageBubble,
                      isAgent && styles.agentBubble,
                      isSystem && styles.systemBubble,
                    ]}
                  >
                    {!isSystem && (
                      <Text style={[styles.speakerLabel, isAgent && styles.agentSpeakerLabel]}>
                        {isAgent ? 'Agent' : name}
                      </Text>
                    )}
                    <Text style={[styles.messageText, isAgent && styles.agentMessageText]}>
                      {message.text}
                    </Text>
                    <Text style={[styles.timeText, isAgent && styles.agentTimeText]}>
                      {message.time}
                    </Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.controlDock}>
            <View style={styles.suggestionRow}>
              {(sessionMode === 'interview' ? interviewSuggestions : assistantSuggestions).map((suggestion) => (
                <Pressable
                  accessibilityRole="button"
                  key={suggestion}
                  onPress={() => sendSuggestion(suggestion)}
                  style={styles.suggestionButton}
                >
                  <Text style={styles.suggestionButtonText}>{suggestion}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.composerRow}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={mode === 'listening' ? 'Live captions appear here...' : 'Optional typed message'}
                placeholderTextColor="#7B8794"
                returnKeyType="send"
                onSubmitEditing={() => finishTurn(draft)}
                style={styles.composerInput}
              />
            </View>

            <View style={styles.liveControls}>
              <Pressable accessibilityRole="button" onPress={handleMicPress} style={styles.micButton}>
                <Text style={styles.micButtonText}>
                  {mode === 'speaking' || mode === 'thinking'
                    ? 'Interrupt'
                    : mode === 'ended'
                      ? 'Resume'
                    : mode === 'listening'
                      ? 'Mute Voice'
                      : isAutoLive
                        ? 'Mute Voice'
                        : 'Voice On'}
                </Text>
                <Text style={styles.micButtonSubtext}>
                  {isAutoLive ? 'Live' : 'Muted'} · {turn} turns
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => finishTurn(draft)}
                style={[styles.sendButton, !draft.trim() && styles.sendButtonDisabled]}
              >
                <Text style={styles.sendButtonText}>Type</Text>
              </Pressable>
            </View>

            <Text style={styles.voiceNoticeText}>
              {voiceStatus}
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F3EE',
  },
  homeContent: {
    flexGrow: 1,
    padding: 20,
    paddingTop: 28,
  },
  keyboardView: {
    flex: 1,
  },
  loginContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  brandLockup: {
    marginBottom: 28,
  },
  brandMark: {
    alignItems: 'center',
    backgroundColor: '#12343B',
    borderRadius: 8,
    height: 48,
    justifyContent: 'center',
    marginBottom: 16,
    width: 48,
  },
  brandMarkText: {
    color: '#F7C873',
    fontSize: 24,
    fontWeight: '800',
  },
  brandTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  brandName: {
    color: '#12343B',
    fontSize: 34,
    fontWeight: '800',
  },
  brandFeather: {
    height: 46,
    resizeMode: 'contain',
    width: 34,
  },
  brandLine: {
    color: '#4E5D52',
    fontSize: 16,
    marginTop: 6,
  },
  featureButton: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E4DED3',
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    padding: 16,
  },
  featureTitle: {
    color: '#12343B',
    fontSize: 18,
    fontWeight: '900',
  },
  featureText: {
    color: '#59665D',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E4DED3',
    borderRadius: 8,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    marginBottom: 18,
    width: 76,
  },
  backButtonText: {
    color: '#12343B',
    fontSize: 13,
    fontWeight: '900',
  },
  pageTitle: {
    color: '#12343B',
    fontSize: 28,
    fontWeight: '900',
  },
  pageCopy: {
    color: '#59665D',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
  },
  formPanel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E4DED3',
    borderRadius: 8,
    borderWidth: 1,
    padding: 18,
  },
  sectionTitle: {
    color: '#12343B',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 14,
  },
  input: {
    backgroundColor: '#F8FAF8',
    borderColor: '#D7DED9',
    borderRadius: 8,
    borderWidth: 1,
    color: '#12343B',
    fontSize: 16,
    height: 50,
    paddingHorizontal: 14,
  },
  largeInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D7DED9',
    borderRadius: 8,
    borderWidth: 1,
    color: '#12343B',
    fontSize: 15,
    minHeight: 150,
    padding: 12,
    textAlignVertical: 'top',
  },
  largeInputCompact: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D7DED9',
    borderRadius: 8,
    borderWidth: 1,
    color: '#12343B',
    fontSize: 15,
    minHeight: 86,
    padding: 12,
    textAlignVertical: 'top',
  },
  fieldLabel: {
    color: '#59665D',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
    marginTop: 18,
    textTransform: 'uppercase',
  },
  languageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  languageButton: {
    backgroundColor: '#F8FAF8',
    borderColor: '#D7DED9',
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 72,
    padding: 12,
    width: '47.8%',
  },
  languageButtonSelected: {
    backgroundColor: '#12343B',
    borderColor: '#12343B',
  },
  languageNative: {
    color: '#12343B',
    fontSize: 17,
    fontWeight: '800',
  },
  languageNativeSelected: {
    color: '#F7C873',
  },
  languageLabel: {
    color: '#60706A',
    fontSize: 13,
    marginTop: 4,
  },
  languageLabelSelected: {
    color: '#FFFFFF',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#D94F30',
    borderRadius: 8,
    height: 52,
    justifyContent: 'center',
    marginTop: 20,
  },
  primaryButtonFlex: {
    alignItems: 'center',
    backgroundColor: '#D94F30',
    borderRadius: 8,
    flex: 1,
    height: 52,
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  dangerButton: {
    backgroundColor: '#8E3B46',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#D7DED9',
    borderRadius: 8,
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    marginTop: 12,
    paddingHorizontal: 16,
  },
  secondaryButtonFlex: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#D7DED9',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: '#12343B',
    fontSize: 14,
    fontWeight: '900',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  resumePreview: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E4DED3',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 14,
    padding: 14,
  },
  resumeVoicePanel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E4DED3',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 18,
    padding: 14,
  },
  readyPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#E7F4EA',
    borderRadius: 8,
    color: '#236B45',
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  resumeRole: {
    color: '#12343B',
    fontSize: 20,
    fontWeight: '900',
  },
  resumeSummary: {
    color: '#273B3F',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
  },
  resumeMeta: {
    color: '#59665D',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  profileGrid: {
    gap: 12,
    marginTop: 14,
  },
  profileTile: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E4DED3',
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  profileLabel: {
    color: '#39736B',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  profileValue: {
    color: '#12343B',
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 22,
    marginTop: 6,
  },
  appShell: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  topActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  userName: {
    color: '#12343B',
    fontSize: 22,
    fontWeight: '800',
  },
  topicText: {
    color: '#59665D',
    fontSize: 13,
    marginTop: 3,
    maxWidth: 260,
  },
  endButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E4DED3',
    borderRadius: 8,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 68,
  },
  profileButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E4DED3',
    borderRadius: 8,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  profileButtonText: {
    color: '#12343B',
    fontSize: 13,
    fontWeight: '900',
  },
  endButtonText: {
    color: '#B33B25',
    fontSize: 14,
    fontWeight: '800',
  },
  liveStage: {
    backgroundColor: '#12343B',
    borderRadius: 8,
    marginBottom: 12,
    minHeight: 214,
    padding: 16,
  },
  liveStageActive: {
    backgroundColor: '#173F3F',
  },
  stageHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  liveLabel: {
    color: '#F7C873',
    fontSize: 23,
    fontWeight: '800',
  },
  liveState: {
    color: '#FFFFFF',
    fontSize: 15,
    marginTop: 4,
  },
  captionButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  captionButtonText: {
    color: '#12343B',
    fontSize: 12,
    fontWeight: '900',
  },
  waveArea: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    height: 86,
    justifyContent: 'center',
    marginVertical: 12,
  },
  waveBar: {
    backgroundColor: '#F7C873',
    borderRadius: 8,
    width: 11,
  },
  captionPanel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    minHeight: 56,
    padding: 12,
  },
  captionText: {
    color: '#12343B',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  threadContent: {
    paddingBottom: 14,
  },
  messageRow: {
    alignItems: 'flex-end',
    marginBottom: 10,
  },
  agentRow: {
    alignItems: 'flex-start',
  },
  systemRow: {
    alignItems: 'center',
  },
  messageBubble: {
    backgroundColor: '#D94F30',
    borderRadius: 8,
    maxWidth: '84%',
    padding: 12,
  },
  agentBubble: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E4DED3',
    borderWidth: 1,
  },
  systemBubble: {
    backgroundColor: '#E7EEE9',
    maxWidth: '92%',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  speakerLabel: {
    color: '#FFE7D5',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
  },
  agentSpeakerLabel: {
    color: '#39736B',
  },
  messageText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 21,
  },
  agentMessageText: {
    color: '#12343B',
  },
  timeText: {
    color: '#FFE7D5',
    fontSize: 11,
    marginTop: 8,
  },
  agentTimeText: {
    color: '#83908A',
  },
  controlDock: {
    backgroundColor: '#F6F3EE',
    borderTopColor: '#E4DED3',
    borderTopWidth: 1,
    paddingBottom: 16,
    paddingTop: 12,
  },
  suggestionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  suggestionButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E4DED3',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    height: 40,
    justifyContent: 'center',
  },
  suggestionButtonText: {
    color: '#12343B',
    fontSize: 12,
    fontWeight: '800',
  },
  composerRow: {
    marginBottom: 10,
  },
  composerInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D7DED9',
    borderRadius: 8,
    borderWidth: 1,
    color: '#12343B',
    fontSize: 15,
    height: 48,
    paddingHorizontal: 12,
  },
  liveControls: {
    flexDirection: 'row',
    gap: 10,
  },
  micButton: {
    alignItems: 'center',
    backgroundColor: '#12343B',
    borderRadius: 8,
    flex: 1,
    height: 58,
    justifyContent: 'center',
  },
  micButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
  },
  micButtonSubtext: {
    color: '#F7C873',
    fontSize: 12,
    marginTop: 2,
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: '#D94F30',
    borderRadius: 8,
    height: 58,
    justifyContent: 'center',
    width: 84,
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  voiceNoticeText: {
    color: '#59665D',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 10,
    textAlign: 'center',
  },
});
