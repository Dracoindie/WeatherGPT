/**
 * Real Web Speech API abstraction for WeatherGPT.
 *
 * Implements:
 * - SpeechRecognition / webkitSpeechRecognition for Speech-to-Text (STT)
 * - SpeechSynthesis for Text-to-Speech (TTS)
 *
 * Strict Privacy & Security:
 * - No audio recording is persisted or uploaded anywhere outside the standard browser engine.
 * - No transcripts, tokens, or credentials are saved to localStorage or disk.
 */

// Types for Web Speech API to satisfy TypeScript and ESLint without 'any'
export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

export interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}

export interface ISpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface ISpeechRecognitionConstructor {
  new (): ISpeechRecognitionInstance;
}

interface IWindowSpeech extends Window {
  SpeechRecognition?: ISpeechRecognitionConstructor;
  webkitSpeechRecognition?: ISpeechRecognitionConstructor;
}

export type VoiceStatus =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'permission_denied'
  | 'unsupported'
  | 'error';

export interface VoiceState {
  status: VoiceStatus;
  transcript: string;
  interimTranscript: string;
  errorMessage: string | null;
  supported: boolean;
}

export interface VoiceServiceCallbacks {
  onStatusChange?: (status: VoiceStatus) => void;
  onTranscript?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onSpeechEnd?: () => void;
}

export function getBrowserVoiceSupport(): { stt: boolean; tts: boolean } {
  if (typeof window === 'undefined') {
    return { stt: false, tts: false };
  }
  const win = window as unknown as IWindowSpeech;
  const hasSTT = !!(win.SpeechRecognition || win.webkitSpeechRecognition);
  const hasTTS = 'speechSynthesis' in window && typeof window.speechSynthesis.speak === 'function';

  return { stt: hasSTT, tts: hasTTS };
}

export class VoiceService {
  private recognition: ISpeechRecognitionInstance | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private callbacks: VoiceServiceCallbacks = {};
  private status: VoiceStatus = 'idle';

  constructor(callbacks: VoiceServiceCallbacks = {}) {
    this.callbacks = callbacks;
    if (typeof window !== 'undefined') {
      const win = window as unknown as IWindowSpeech;
      const SpeechRecognitionClass = win.SpeechRecognition || win.webkitSpeechRecognition;
      if (SpeechRecognitionClass) {
        try {
          this.recognition = new SpeechRecognitionClass();
          this.recognition.continuous = false;
          this.recognition.interimResults = true;
          this.recognition.maxAlternatives = 1;
          this.setupRecognitionListeners();
        } catch {
          this.recognition = null;
        }
      }
    }
  }

  private setStatus(status: VoiceStatus, errorMsg: string | null = null) {
    this.status = status;
    this.callbacks.onStatusChange?.(status);
    if (errorMsg) {
      this.callbacks.onError?.(errorMsg);
    }
  }

  public getStatus(): VoiceStatus {
    return this.status;
  }

  private setupRecognitionListeners() {
    if (!this.recognition) return;

    this.recognition.onstart = () => {
      this.setStatus('listening');
    };

    this.recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        if (item.isFinal) {
          final += item[0].transcript;
        } else {
          interim += item[0].transcript;
        }
      }

      if (final.trim()) {
        this.callbacks.onTranscript?.(final.trim(), true);
      } else if (interim.trim()) {
        this.callbacks.onTranscript?.(interim.trim(), false);
      }
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      const err = event.error;
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        this.setStatus('permission_denied', 'Microphone permission was denied. Please allow microphone access in your browser settings.');
      } else if (err === 'no-speech') {
        this.setStatus('idle', 'No speech was detected. Please try again.');
      } else if (err === 'audio-capture') {
        this.setStatus('error', 'No microphone was detected on this device.');
      } else {
        this.setStatus('error', `Speech recognition error: ${err}`);
      }
    };

    this.recognition.onend = () => {
      // If we were listening and finished naturally
      if (this.status === 'listening') {
        this.setStatus('idle');
      }
    };
  }

  public startListening(language: 'en' | 'hi' = 'en') {
    if (typeof window === 'undefined') return;

    // Stop any ongoing speech synthesis first
    this.stopSpeaking();

    const support = getBrowserVoiceSupport();
    if (!support.stt || !this.recognition) {
      this.setStatus('unsupported', 'Speech recognition is not supported in this browser. Try Chrome or Edge.');
      return;
    }

    try {
      // Set language: English defaults to Indian English / UK English, Hindi uses hi-IN
      // Chrome supports Hinglish recognition well under either en-IN or hi-IN
      this.recognition.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
      this.recognition.start();
    } catch (err: unknown) {
      const errorObj = err as { name?: string };
      // If already started or aborting
      if (errorObj?.name === 'InvalidStateError') {
        try {
          this.recognition.stop();
          setTimeout(() => {
            try {
              this.recognition?.start();
            } catch {
              this.setStatus('idle');
            }
          }, 150);
        } catch {
          this.setStatus('idle');
        }
      } else {
        this.setStatus('error', 'Failed to start microphone.');
      }
    }
  }

  public stopListening() {
    if (this.recognition && this.status === 'listening') {
      try {
        this.recognition.stop();
      } catch {
        // Ignore stop errors
      }
    }
  }

  public speak(text: string, language: 'en' | 'hi' = 'en') {
    if (typeof window === 'undefined') return;

    const support = getBrowserVoiceSupport();
    if (!support.tts) {
      return;
    }

    // Stop any current utterance
    this.stopSpeaking();

    // Clean text: strip markdown characters, urls, bullet symbols for smooth speech
    const cleanText = text
      .replace(/[*_#`~\[\]\(\)]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) return;

    try {
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      // Select natural voice if available
      const voices = window.speechSynthesis.getVoices?.() ?? [];
      const langPrefix = language === 'hi' ? 'hi' : 'en';
      const matchingVoice = voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix));
      if (matchingVoice) {
        utterance.voice = matchingVoice;
      }

      utterance.onstart = () => {
        this.setStatus('speaking');
      };

      utterance.onend = () => {
        this.currentUtterance = null;
        this.setStatus('idle');
        this.callbacks.onSpeechEnd?.();
      };

      utterance.onerror = (e) => {
        // Interrupted is normal when user cancels or starts new action
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
          this.setStatus('idle', 'Speech synthesis encountered an issue.');
        } else {
          this.setStatus('idle');
        }
        this.currentUtterance = null;
      };

      this.currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    } catch {
      this.setStatus('idle');
    }
  }

  public stopSpeaking() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }
    this.currentUtterance = null;
    if (this.status === 'speaking') {
      this.setStatus('idle');
    }
  }

  public destroy() {
    this.stopListening();
    this.stopSpeaking();
    this.recognition = null;
  }
}
