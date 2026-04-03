export interface Scene {
  id: number;
  description: string;
  visualPrompt: string;
  cameraMovement: string;
  lighting: string;
  dialogue?: string;
  narration?: string;
  duration: number;
  imageUrl?: string;
  previews?: string[];
  selectedPreviewIndex?: number;
  videoUrl?: string;
  sfxUrl?: string;
  ambienceUrl?: string;
  ambiencePreset?: string;
  sfxPreset?: string;
  soundDesignPrompt?: string;
  generationTime?: number; // Time in ms to generate assets for this scene
  sectionType?: 'Intro' | 'Verse' | 'Chorus' | 'Bridge' | 'Outro';
  isPerformance?: boolean;
  transitionType?: 'Crossfade' | 'Wipe' | 'Dissolve' | 'Cut' | 'Zoom' | 'Glitch' | 'Morphing' | 'Light Trails' | 'Abstract Flows';
  isRefining?: boolean;
}

export type ProductionStatus = 
  | 'idle' 
  | 'scripting' 
  | 'storyboarding' 
  | 'designing_characters'
  | 'generating_assets' 
  | 'generating_music'
  | 'generating_voice'
  | 'generating_sound'
  | 'editing' 
  | 'vfx'
  | 'post_production'
  | 'completed' 
  | 'error';

export interface ProductionState {
  id?: string;
  userId?: string;
  title: string;
  genre: string;
  duration: string;
  targetAudience: string;
  script: string;
  lyrics?: string;
  storyboard: Scene[];
  characterTokens?: string;
  musicPlan: string;
  musicUrl?: string;
  voiceName?: string;
  voiceSample?: string; // base64
  status: ProductionStatus;
  logs: string[];
  isMusicVideoMode: boolean;
  musicSettings?: {
    mood: string;
    referenceStyle?: string;
    referenceAudioBase64?: string;
  };
  postProduction?: {
    colorGrade: 'None' | 'Cinematic' | 'Vintage' | 'Noir' | 'Vibrant' | 'Teal & Orange';
    filter: 'None' | 'Grain' | 'Bloom' | 'Vignette' | 'VHS';
    upscale: '1x' | '2x' | '4x';
  };
  vfx?: {
    cgiElements: ('None' | 'Cybernetic' | 'Atmospheric' | 'Holographic' | 'Particle' | 'Energy Fields' | 'Alien Flora' | 'Abstract Geometric Shapes')[];
    cgiIntensity?: number;
    cyberneticIntensity?: number;
    atmosphericIntensity?: number;
    cgiAnimation?: 'Static' | 'Pulse' | 'Flow' | 'Glitch' | 'Orbit';
    motionGraphics: 'None' | 'Lower Thirds' | 'Callouts' | 'Data Overlays' | 'Cinematic Titles';
    compositing: 'Standard' | 'Deep' | 'Multi-Layer';
    renderSettings?: {
      resolution: '720p' | '1080p' | '4K';
      frameRate: '24fps' | '30fps' | '60fps';
      encoding: 'H.264' | 'H.265' | 'ProRes';
    };
  };
  createdAt?: any;
}

export type AgentType = 
  | 'EXECUTIVE PRODUCER'
  | 'SCRIPTWRITER'
  | 'STORYBOARD ARTIST'
  | 'CINEMATOGRAPHY'
  | 'CHARACTER DESIGN'
  | 'VOICE DIRECTOR'
  | 'MUSIC PRODUCER'
  | 'VIDEO GENERATION'
  | 'EDITOR'
  | 'SOUND DESIGN'
  | 'COLOR GRADING'
  | 'VFX ARTIST'
  | 'QUALITY CONTROL'
  | 'SYSTEM'
  | 'CHATBOT';

export interface ChatMessage {
  id?: string;
  role: 'user' | 'model';
  content: string;
  timestamp: any;
  userId: string;
}
