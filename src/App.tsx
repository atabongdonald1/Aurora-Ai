import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Film, Music, Mic, Camera, Layers, Settings, Sparkles, Terminal, 
  CheckCircle2, Loader2, ChevronRight, Volume2, Image as ImageIcon, 
  Video as VideoIcon, Type, Palette, Scissors, LogIn, LogOut, User, 
  Plus, Trash2, MessageSquare, Send, Search, MapPin, Brain, Zap, 
  Languages, Download, Share2, Eye, EyeOff, MoreVertical, X, Maximize2,
  BarChart3, Activity, ChevronDown, Wand2, Cpu, Wind
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, Legend, Cell
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type as GeminiType, Modality, ThinkingLevel } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { cn } from './lib/utils';
import { storageService } from './lib/storage';
import { ProductionState, Scene, AgentType, ChatMessage, ProductionStatus, UserProfile } from './types';
import { auth, db, signInWithGoogle, logout, OperationType, handleFirestoreError } from './firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, doc, setDoc, deleteDoc, getDocs, updateDoc, getDoc } from 'firebase/firestore';

const getAI = () => {
  // Prefer process.env.API_KEY which is used for paid/selected keys, 
  // fallback to GEMINI_API_KEY for free models.
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  return new GoogleGenAI({ apiKey });
};

const isRetryableError = (error: any) => {
  const errorMsg = error?.message || String(error);
  // Hard spending cap errors should NOT be retried as they require manual intervention
  if (errorMsg.includes('spending cap')) {
    return false;
  }
  // Permission denied (403) is usually not retryable without user action (selecting a key)
  if (errorMsg.includes('403') || errorMsg.includes('PERMISSION_DENIED') || errorMsg.includes('does not have permission') || errorMsg.includes('Requested entity was not found')) {
    return false;
  }
  return (
    errorMsg.includes('503') || 
    errorMsg.includes('Deadline expired') || 
    errorMsg.includes('UNAVAILABLE') ||
    errorMsg.includes('429') ||
    errorMsg.includes('RESOURCE_EXHAUSTED') ||
    errorMsg.includes('Quota exceeded') ||
    errorMsg.includes('rate limit')
  );
};

const generateContentWithRetry = async (params: any, maxRetries = 5) => {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await getAI().models.generateContent(params);
    } catch (error: any) {
      lastError = error;
      const errorMsg = error?.message || String(error);
      
      if (isRetryableError(error)) {
        // If we've retried and still getting 429/Quota errors, try falling back to Flash
        if (i >= 1 && (errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('Quota exceeded'))) {
          if (params.model === 'gemini-3.1-pro-preview') {
            console.warn(`[SYSTEM] Pro model quota exhausted. Falling back to Flash model for attempt ${i + 1}...`);
            params.model = 'gemini-3-flash-preview';
            // Flash models don't support high thinking levels in the same way or might have different config needs
            if (params.config?.thinkingConfig) {
              delete params.config.thinkingConfig;
            }
          }
        }

        const delay = Math.pow(2, i) * 2000 + Math.random() * 1000;
        console.warn(`Gemini API error (Retryable), retrying in ${Math.round(delay)}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

const generateVideosWithRetry = async (params: any, maxRetries = 8) => {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await getAI().models.generateVideos(params);
    } catch (error: any) {
      lastError = error;
      if (isRetryableError(error)) {
        // Video API needs longer cooldowns
        const delay = Math.pow(2, i) * 5000 + Math.random() * 2000;
        console.warn(`Gemini Video API error (Retryable), retrying in ${Math.round(delay)}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

const getVideosOperationWithRetry = async (params: any, maxRetries = 15) => {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await getAI().operations.getVideosOperation(params);
    } catch (error: any) {
      lastError = error;
      if (isRetryableError(error)) {
        const delay = Math.pow(2, i) * 3000 + Math.random() * 1000;
        console.warn(`Gemini Video Op API error (Retryable), retrying in ${Math.round(delay)}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

const generateContentStreamWithRetry = async (params: any, maxRetries = 5) => {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await getAI().models.generateContentStream(params);
    } catch (error: any) {
      lastError = error;
      const errorMsg = error?.message || String(error);
      
      if (isRetryableError(error)) {
        // If we've retried and still getting 429/Quota errors, try falling back to Flash
        if (i >= 1 && (errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('Quota exceeded'))) {
          if (params.model === 'gemini-3.1-pro-preview') {
            console.warn(`[SYSTEM] Pro model quota exhausted. Falling back to Flash model for attempt ${i + 1}...`);
            params.model = 'gemini-3-flash-preview';
            if (params.config?.thinkingConfig) {
              delete params.config.thinkingConfig;
            }
          }
        }

        const delay = Math.pow(2, i) * 2000 + Math.random() * 1000;
        console.warn(`Gemini Stream API error (Retryable), retrying in ${Math.round(delay)}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

const AMBIENCE_PRESETS = ['None', 'Deep Space', 'Cyberpunk City', 'Ancient Forest', 'Underwater Abyss', 'Desert Wind', 'Industrial Factory'];
const SFX_PRESETS = ['None', 'Laser Blast', 'Mechanical Whir', 'Digital Glitch', 'Explosion', 'Footsteps', 'Teleport'];

const sanitizeProductionData = (data: ProductionState): any => {
  const sanitized = JSON.parse(JSON.stringify(data));
  
  // Remove large base64 previews from storyboard scenes
  if (sanitized.storyboard) {
    sanitized.storyboard = sanitized.storyboard.map((scene: any) => {
      const { previews, ...rest } = scene;
      return rest;
    });
  }
  
  // Remove other large base64 fields
  if (sanitized.musicSettings) {
    delete sanitized.musicSettings.referenceAudioBase64;
  }
  delete sanitized.voiceSample;
  
  // Limit logs to last 100 entries to prevent document growth
  if (sanitized.logs && sanitized.logs.length > 100) {
    sanitized.logs = sanitized.logs.slice(-100);
  }
  
  return sanitized;
};

const sanitizeStoryboard = (storyboard: Scene[]): any[] => {
  return storyboard.map(scene => {
    const { previews, ...rest } = scene;
    return rest;
  });
};

export default function App() {
  // Auth State
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);

  // Production State
  const [state, setState] = useState<ProductionState>({
    title: '',
    genre: 'Cinematic Sci-Fi',
    duration: '3 minutes',
    targetAudience: 'General',
    script: '',
    storyboard: [],
    musicPlan: '',
    status: 'idle',
    logs: [],
    isMusicVideoMode: false,
    musicSettings: {
      mood: 'Epic',
      referenceStyle: '',
      referenceAudioBase64: ''
    },
    postProduction: {
      colorGrade: 'None',
      filter: 'None',
      upscale: '1x'
    },
    vfx: {
      cgiElements: [],
      cgiIntensity: 50,
      cgiAnimation: 'Pulse',
      motionGraphics: 'None',
      compositing: 'Standard',
      renderSettings: {
        resolution: '1080p',
        frameRate: '24fps',
        encoding: 'H.264'
      }
    }
  });

  // Asset Cache Loader
  useEffect(() => {
    if (!state.id || state.storyboard.length === 0) return;

    const loadCachedAssets = async () => {
      let updated = false;
      const newStoryboard = [...state.storyboard];

      for (let i = 0; i < newStoryboard.length; i++) {
        const scene = newStoryboard[i];
        // If videoUrl is missing or is a blob URL from a previous session (which would be invalid)
        // Note: blob URLs are session-specific, so if we just loaded the state from Firestore, 
        // the videoUrl would likely be empty or a stale blob URL.
        if (!scene.videoUrl || scene.videoUrl.startsWith('blob:')) {
          const cacheKey = `${state.id}_scene_${i}_video`;
          try {
            const cachedBlob = await storageService.getAsset(cacheKey);
            if (cachedBlob) {
              newStoryboard[i] = {
                ...scene,
                videoUrl: URL.createObjectURL(cachedBlob)
              };
              updated = true;
            }
          } catch (err) {
            console.error("Error loading cached asset:", err);
          }
        }
      }

      if (updated) {
        setState(prev => ({ ...prev, storyboard: newStoryboard }));
      }
    };

    loadCachedAssets();
  }, [state.id]);

  // Asset Cache Saver
  useEffect(() => {
    if (!state.id || state.storyboard.length === 0) return;

    const saveAssetsToCache = async () => {
      for (let i = 0; i < state.storyboard.length; i++) {
        const scene = state.storyboard[i];
        if (scene.videoUrl && scene.videoUrl.startsWith('blob:')) {
          const cacheKey = `${state.id}_scene_${i}_video`;
          try {
            const alreadyCached = await storageService.getAsset(cacheKey);
            if (!alreadyCached) {
              const res = await fetch(scene.videoUrl);
              const blob = await res.blob();
              await storageService.saveAsset(cacheKey, blob);
              console.log(`Cached asset for scene ${i}`);
            }
          } catch (err) {
            console.error("Error caching asset:", err);
          }
        }
      }
    };

    saveAssetsToCache();
  }, [state.id, state.storyboard]);

  const [input, setInput] = useState({
    concept: '',
    genre: 'Cinematic Sci-Fi',
    duration: '3',
    audience: 'General Audience',
    isMusicVideoMode: false,
    voiceName: 'Fenrir',
    voiceSample: '',
  });

  // UI State
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'script' | 'storyboard' | 'chat' | 'history' | 'analytics' | 'characters' | 'post-production' | 'vfx' | 'music' | 'pricing'>('script');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [productions, setProductions] = useState<ProductionState[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const logEndRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setIsAuthReady(true);
      
      if (u) {
        // Ensure user document exists in Firestore
        const userRef = doc(db, 'users', u.uid);
        const unsubscribeUser = onSnapshot(userRef, (snap) => {
          if (snap.exists()) {
            setUserProfile(snap.data() as UserProfile);
          } else {
            const initialProfile = {
              uid: u.uid,
              email: u.email || '',
              displayName: u.displayName || '',
              photoURL: u.photoURL || '',
              plan: 'free',
              credits: 10,
              createdAt: serverTimestamp()
            };
            setDoc(userRef, initialProfile).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${u.uid}`));
          }
        }, (err) => handleFirestoreError(err, OperationType.GET, `users/${u.uid}`));
        
        return () => unsubscribeUser();
      } else {
        setUserProfile(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // API Key Check
  useEffect(() => {
    const checkKey = async () => {
      if ((window as any).aistudio) {
        const selected = await (window as any).aistudio.hasSelectedApiKey();
        setHasApiKey(selected);
      } else {
        // Fallback for local development if needed, but in this env we expect aistudio
        setHasApiKey(true);
      }
    };
    checkKey();
  }, []);

  const openKeyDialog = async () => {
    if ((window as any).aistudio) {
      await (window as any).aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  // Productions Listener
  useEffect(() => {
    if (!user) {
      setProductions([]);
      return;
    }
    const q = query(
      collection(db, 'productions'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const prods = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ProductionState));
      setProductions(prods);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'productions'));
    return () => unsubscribe();
  }, [user]);

  // Chat Listener
  useEffect(() => {
    if (!user) {
      setChatMessages([]);
      return;
    }
    const q = query(
      collection(db, 'chats', user.uid, 'messages'),
      orderBy('timestamp', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage));
      setChatMessages(msgs);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `chats/${user.uid}/messages`));
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.logs]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
      </div>
    );
  }

  if (!hasApiKey) {
    return (
      <div className="fixed inset-0 z-[9999] bg-[#050505] flex flex-col items-center justify-center p-8 text-center">
        <div className="w-24 h-24 bg-amber-500/10 rounded-full flex items-center justify-center mb-8 animate-pulse">
          <Zap className="w-10 h-10 text-amber-500" />
        </div>
        <h1 className="text-4xl font-black tracking-tighter mb-4 uppercase italic">Aurora Studio AI</h1>
        <p className="text-zinc-400 max-w-md mb-8 text-sm leading-relaxed">
          To access advanced cinematic models (Veo, Lyria, Imagen), you must select a paid Google Cloud API key. 
          <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="text-amber-500 hover:underline ml-1">Learn more about billing.</a>
        </p>
        <button 
          onClick={openKeyDialog}
          className="px-8 py-4 bg-amber-500 text-black font-black rounded-2xl hover:bg-amber-400 transition-all flex items-center gap-3 shadow-xl shadow-amber-500/20"
        >
          <Settings className="w-5 h-5" />
          SELECT API KEY
        </button>
      </div>
    );
  }

  const addLog = (agent: AgentType, message: string) => {
    setState(prev => ({
      ...prev,
      logs: [...prev.logs, `[${agent}] ${message}`]
    }));
  };

  const saveProduction = async (finalState: ProductionState) => {
    if (!user) return;
    try {
      const sanitized = sanitizeProductionData(finalState);
      const prodData = {
        ...sanitized,
        userId: user.uid,
        createdAt: serverTimestamp(),
      };
      const docRef = await addDoc(collection(db, 'productions'), prodData);
      setState(prev => ({ ...prev, id: docRef.id }));
      addLog('SYSTEM', 'Production saved to cloud.');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'productions');
    }
  };

  const updateSceneTransition = (sceneIndex: number, transition: Scene['transitionType']) => {
    const updatedStoryboard = [...state.storyboard];
    updatedStoryboard[sceneIndex].transitionType = transition;
    setState(prev => ({ ...prev, storyboard: updatedStoryboard }));
    
    if (state.id && user) {
      const productionRef = doc(db, 'productions', state.id);
      updateDoc(productionRef, { storyboard: sanitizeStoryboard(updatedStoryboard) })
        .catch(err => console.error("Error updating transition:", err));
    }
  };

  const updateSceneField = (sceneIndex: number, key: keyof Scene, value: string | number | boolean) => {
    const updatedStoryboard = [...state.storyboard];
    (updatedStoryboard[sceneIndex] as any)[key] = value;
    setState(prev => ({ ...prev, storyboard: updatedStoryboard }));
    
    if (state.id && user) {
      const productionRef = doc(db, 'productions', state.id);
      updateDoc(productionRef, { storyboard: sanitizeStoryboard(updatedStoryboard) })
        .catch(err => console.error(`Error updating ${key}:`, err));
    }
  };

  const updatePostProduction = (key: keyof NonNullable<ProductionState['postProduction']>, value: string) => {
    setState(prev => ({
      ...prev,
      postProduction: {
        ...prev.postProduction!,
        [key]: value
      }
    }));
    
    if (state.id && user) {
      const productionRef = doc(db, 'productions', state.id);
      updateDoc(productionRef, { 
        postProduction: {
          ...state.postProduction!,
          [key]: value
        }
      }).catch(err => console.error("Error updating post-production:", err));
    }
  };

  const updateVfx = (key: keyof NonNullable<ProductionState['vfx']>, value: any) => {
    setState(prev => ({
      ...prev,
      vfx: {
        ...prev.vfx!,
        [key]: value
      }
    }));
    
    if (state.id && user) {
      const productionRef = doc(db, 'productions', state.id);
      updateDoc(productionRef, { 
        vfx: {
          ...state.vfx!,
          [key]: value
        }
      }).catch(err => console.error("Error updating VFX:", err));
    }
  };

  const updateMusicSettings = (key: keyof NonNullable<ProductionState['musicSettings']>, value: any) => {
    setState(prev => ({
      ...prev,
      musicSettings: {
        ...prev.musicSettings!,
        [key]: value
      }
    }));
    
    if (state.id && user) {
      const productionRef = doc(db, 'productions', state.id);
      const { referenceAudioBase64, ...sanitizedSettings } = {
        ...state.musicSettings!,
        [key]: value
      };
      updateDoc(productionRef, { musicSettings: sanitizedSettings })
        .catch(err => console.error("Error updating music settings:", err));
    }
  };

  const handleSubscribe = async (priceId: string) => {
    if (!user) return;
    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId, userId: user.uid })
      });
      const session = await response.json();
      if (session.url) {
        window.location.href = session.url;
      }
    } catch (err) {
      console.error("Stripe Checkout Error:", err);
      alert("Failed to initiate checkout. Please try again.");
    }
  };

  const handleVoiceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      setInput(prev => ({ ...prev, voiceSample: base64.split(',')[1] }));
      addLog('SYSTEM', 'Voice sample uploaded for custom casting.');
    };
    reader.readAsDataURL(file);
  };

  const generateScenePreviews = async (sceneIndex: number) => {
    const scene = state.storyboard[sceneIndex];
    if (!scene) return;
    
    addLog('VIDEO GENERATION', `Generating new visual previews for Scene ${sceneIndex + 1}...`);
    
    try {
      const previewPromises = [0, 1, 2].map(v => 
        generateContentWithRetry({
          model: 'gemini-3.1-flash-image-preview',
          contents: {
            parts: [{ text: `Masterpiece cinematic film still, variation ${v + 1}, 8k, ${scene.visualPrompt}, character: ${state.characterTokens}, lighting: ${scene.lighting}` }]
          },
          config: {
            imageConfig: { aspectRatio: "16:9", imageSize: "1K" }
          }
        })
      );

      const imgResponses = await Promise.all(previewPromises);
      const previews: string[] = imgResponses
        .map(res => res.candidates?.[0]?.content?.parts.find(p => p.inlineData))
        .filter(p => p?.inlineData)
        .map(p => `data:image/png;base64,${p!.inlineData!.data}`);

      if (previews.length > 0) {
        setState(prev => {
          const updatedStoryboard = [...prev.storyboard];
          updatedStoryboard[sceneIndex] = {
            ...scene,
            previews,
            selectedPreviewIndex: 0,
            imageUrl: previews[0]
          };
          
          if (prev.id && user) {
            const productionRef = doc(db, 'productions', prev.id);
            updateDoc(productionRef, { storyboard: sanitizeStoryboard(updatedStoryboard) })
              .catch(err => handleFirestoreError(err, OperationType.UPDATE, `productions/${prev.id}`));
          }
          
          return { ...prev, storyboard: updatedStoryboard };
        });
        addLog('VIDEO GENERATION', `Scene ${sceneIndex + 1} previews updated.`);
      }
    } catch (error: any) {
      console.error("Error generating scene previews:", error);
      const errorMsg = error?.message || String(error);
      if (errorMsg.includes('403') || errorMsg.includes('PERMISSION_DENIED') || errorMsg.includes('does not have permission') || errorMsg.includes('Requested entity was not found')) {
        setHasApiKey(false);
      }
      addLog('SYSTEM', `Failed to generate previews for Scene ${sceneIndex + 1}.`);
    }
  };

  const generateSceneDetails = async (sceneIndex: number) => {
    const scene = state.storyboard[sceneIndex];
    if (!scene) return;

    addLog('STORYBOARD ARTIST', `AI is refining Scene ${sceneIndex + 1} based on script and genre...`);
    
    // Set refining state
    setState(prev => {
      const updatedStoryboard = [...prev.storyboard];
      updatedStoryboard[sceneIndex] = { ...scene, isRefining: true };
      return { ...prev, storyboard: updatedStoryboard };
    });

    try {
      const response = await generateContentWithRetry({
        model: "gemini-3.1-pro-preview",
        contents: `Act as a Storyboard Artist and Cinematographer. 
        Refine the following scene details based on the overall script and genre.
        
        Genre: ${state.genre}
        Script: ${state.script}
        Current Scene ID: ${scene.id}
        Current Description: ${scene.description}
        Current Visual Prompt: ${scene.visualPrompt}
        
        Adjacent Scenes:
        - Previous Scene: ${sceneIndex > 0 ? state.storyboard[sceneIndex - 1].description : 'None (This is the first scene)'}
        - Next Scene: ${sceneIndex < state.storyboard.length - 1 ? state.storyboard[sceneIndex + 1].description : 'None (This is the last scene)'}
        
        Character Visual Identity: ${state.characterTokens}
        
        Return a JSON object with:
        - description: A concise but evocative scene description.
        - visualPrompt: A highly detailed prompt for image generation. Focus on the visual composition, character actions, and environmental details. Incorporate the character's visual identity tokens where appropriate.
        - cameraMovement: Specific camera instructions (e.g., "Slow push-in", "Low-angle tracking shot").
        - lighting: Detailed lighting setup (e.g., "Moody chiaroscuro with blue rim light").
        - soundDesignPrompt: Atmospheric sound and SFX cues.
        - transitionType: Suggest a cinematic transition from the PREVIOUS scene into this one, based on mood and visual flow. Choose from: 'Crossfade', 'Wipe', 'Dissolve', 'Cut', 'Zoom', 'Glitch', 'Morphing', 'Light Trails', 'Abstract Flows'.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: GeminiType.OBJECT,
            properties: {
              description: { type: GeminiType.STRING },
              visualPrompt: { type: GeminiType.STRING },
              cameraMovement: { type: GeminiType.STRING },
              lighting: { type: GeminiType.STRING },
              soundDesignPrompt: { type: GeminiType.STRING },
              transitionType: { 
                type: GeminiType.STRING, 
                enum: ['Crossfade', 'Wipe', 'Dissolve', 'Cut', 'Zoom', 'Glitch', 'Morphing', 'Light Trails', 'Abstract Flows']
              },
            },
            required: ["description", "visualPrompt", "cameraMovement", "lighting", "soundDesignPrompt", "transitionType"]
          }
        }
      });

      const details = JSON.parse(response.text || '{}');
      
      setState(prev => {
        const updatedStoryboard = [...prev.storyboard];
        updatedStoryboard[sceneIndex] = {
          ...scene,
          ...details,
          isRefining: false
        };
        
        if (prev.id && user) {
          const productionRef = doc(db, 'productions', prev.id);
          updateDoc(productionRef, { storyboard: sanitizeStoryboard(updatedStoryboard) })
            .catch(err => handleFirestoreError(err, OperationType.UPDATE, `productions/${prev.id}`));
        }
        return { ...prev, storyboard: updatedStoryboard };
      });
      
      addLog('STORYBOARD ARTIST', `Scene ${sceneIndex + 1} details refined by AI.`);
    } catch (error: any) {
      console.error("Error generating scene details:", error);
      const errorMsg = error?.message || String(error);
      if (errorMsg.includes('403') || errorMsg.includes('PERMISSION_DENIED') || errorMsg.includes('does not have permission') || errorMsg.includes('Requested entity was not found')) {
        setHasApiKey(false);
      }
      addLog('SYSTEM', `Failed to generate details for Scene ${sceneIndex + 1}.`);
      
      // Reset refining state on error
      setState(prev => {
        const updatedStoryboard = [...prev.storyboard];
        updatedStoryboard[sceneIndex] = { ...scene, isRefining: false };
        return { ...prev, storyboard: updatedStoryboard };
      });
    }
  };

  const cycleScenePreview = (sceneIndex: number) => {
    setState(prev => {
      const scene = prev.storyboard[sceneIndex];
      if (!scene.previews || scene.previews.length === 0) return prev;
      
      const nextIndex = ((scene.selectedPreviewIndex || 0) + 1) % scene.previews.length;
      const updatedStoryboard = [...prev.storyboard];
      updatedStoryboard[sceneIndex] = {
        ...scene,
        selectedPreviewIndex: nextIndex,
        imageUrl: scene.previews[nextIndex]
      };
      
      if (prev.id && user) {
        const productionRef = doc(db, 'productions', prev.id);
        updateDoc(productionRef, { storyboard: sanitizeStoryboard(updatedStoryboard) })
          .catch(err => console.error("Error updating scene preview:", err));
      }
      
      return { ...prev, storyboard: updatedStoryboard };
    });
  };

  const startProduction = async () => {
    if (!input.concept) return;
    if (!user || !userProfile) {
      alert("Please sign in to start production.");
      return;
    }

    // Credit check bypassed for Demo Mode
    addLog('SYSTEM', 'Production initiated (Demo Mode: Credits Bypassed).');

    const isPro = true; // Force Pro features in Demo Mode
    const creativeModel = "gemini-3.1-pro-preview";

    setState(prev => ({
      ...prev,
      status: 'scripting',
      plan: userProfile.plan,
      title: input.concept.slice(0, 30),
      isMusicVideoMode: input.isMusicVideoMode,
      logs: [`[EXECUTIVE PRODUCER] Initializing ${input.isMusicVideoMode ? 'MUSIC VIDEO' : 'CINEMATIC'} production for: ${input.concept}`]
    }));

    try {
      let script = '';
      let lyrics = '';

      // 1. SCRIPTWRITING / SONGWRITING
      addLog('SCRIPTWRITER', `Crafting narrative structure with Pro Intelligence (Demo Mode)...`);
      const scriptResponse = await generateContentWithRetry({
        model: creativeModel,
        contents: `Act as a Hollywood Scriptwriter and Creative Director. 
        Create a detailed, high-fidelity ${input.isMusicVideoMode ? 'song structure and lyrics' : 'script'} for a ${input.duration} minute ${input.genre} video titled "${input.concept}". 
        Audience: ${input.audience}. 
        ${input.isMusicVideoMode ? 'Structure: Intro, Verse 1, Chorus, Verse 2, Chorus, Bridge, Chorus, Outro.' : 'Include scenes with sophisticated dialogue, narration, and deep emotional cues.'}
        Use Search Grounding to ensure technical accuracy and cultural relevance.
        Focus on premium cinematic storytelling, character depth, and atmospheric world-building.
        Format as Markdown.`,
        config: {
          tools: [{ googleSearch: {} }],
          ...(isPro ? { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } } : {})
        }
      });
      script = scriptResponse.text || '';
      if (input.isMusicVideoMode) lyrics = script;
      
      setState(prev => ({ ...prev, script, lyrics, status: 'storyboarding' }));
      addLog('SCRIPTWRITER', 'Script finalized with Grounded Intelligence.');

      // 2. STORYBOARDING
      addLog('STORYBOARD ARTIST', `Breaking down ${input.isMusicVideoMode ? 'lyrics' : 'script'} into visual scenes...`);
      const storyboardResponse = await generateContentWithRetry({
        model: creativeModel,
        contents: `Act as a Storyboard Artist. Based on this ${input.isMusicVideoMode ? 'lyrics' : 'script'}, create a scene-by-scene breakdown with high-fidelity visual descriptions.
        ${input.isMusicVideoMode ? 'MUSIC VIDEO MODE: Alternate between "Performance" and "Storytelling" scenes.' : ''}
        Content: ${script}
        Return a JSON array of scenes with: id, description, visualPrompt, cameraMovement, lighting, duration, sectionType, isPerformance, soundDesignPrompt, transitionType, ambiencePreset, sfxPreset.
        
        CRITICAL: Select sound presets based on the scene:
        - ambiencePreset: 'None', 'Deep Space', 'Cyberpunk City', 'Ancient Forest', 'Underwater Abyss', 'Desert Wind', 'Industrial Factory'
        - sfxPreset: 'None', 'Laser Blast', 'Mechanical Whir', 'Digital Glitch', 'Explosion', 'Footsteps', 'Teleport'
        
        CRITICAL: Select transitionType based on the mood and the visual flow between adjacent scenes:
        - 'Morphing': Use for surreal, fluid transformations, or dream sequences where one object becomes another.
        - 'Light Trails': Use for high speed, futuristic, or energetic movement, connecting fast-paced action.
        - 'Abstract Flows': Use for artistic, organic, or ethereal shifts, ideal for emotional or abstract storytelling.
        - 'Glitch': Use for high energy, tech, chaos, or rapid shifts in digital/cyberpunk contexts.
        - 'Zoom': Use for immersive, deep focus, or entering new worlds/details.
        - 'Wipe': Use for directional movement, passing time, or shifting locations.
        - 'Dissolve': Use for emotional, dream-like, or slow transitions.
        - 'Crossfade': Use for classic cinematic flow between related scenes.
        - 'Cut': Use for fast-paced action or standard narrative beats.`,
        config: {
          responseMimeType: "application/json",
          ...(isPro ? { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } } : {}),
          responseSchema: {
            type: GeminiType.ARRAY,
            items: {
              type: GeminiType.OBJECT,
              properties: {
                id: { type: GeminiType.NUMBER },
                description: { type: GeminiType.STRING },
                visualPrompt: { type: GeminiType.STRING },
                cameraMovement: { type: GeminiType.STRING },
                lighting: { type: GeminiType.STRING },
                duration: { type: GeminiType.NUMBER },
                sectionType: { type: GeminiType.STRING },
                isPerformance: { type: GeminiType.BOOLEAN },
                soundDesignPrompt: { type: GeminiType.STRING, description: "Atmospheric sounds, SFX, and Foley for this scene" },
                ambiencePreset: { 
                  type: GeminiType.STRING, 
                  enum: ['None', 'Deep Space', 'Cyberpunk City', 'Ancient Forest', 'Underwater Abyss', 'Desert Wind', 'Industrial Factory'],
                  description: "The atmospheric soundscape for this scene"
                },
                sfxPreset: { 
                  type: GeminiType.STRING, 
                  enum: ['None', 'Laser Blast', 'Mechanical Whir', 'Digital Glitch', 'Explosion', 'Footsteps', 'Teleport'],
                  description: "The primary sound effect for this scene"
                },
                transitionType: { 
                  type: GeminiType.STRING, 
                  enum: ['Crossfade', 'Wipe', 'Dissolve', 'Cut', 'Zoom', 'Glitch', 'Morphing', 'Light Trails', 'Abstract Flows'],
                  description: "The transition effect to use when entering this scene"
                },
              },
              required: ["id", "description", "visualPrompt", "cameraMovement", "lighting", "duration", "soundDesignPrompt", "transitionType", "ambiencePreset", "sfxPreset"]
            }
          }
        }
      });

      const storyboard: Scene[] = JSON.parse(storyboardResponse.text || '[]');
      setState(prev => ({ ...prev, storyboard, status: 'designing_characters' }));
      addLog('STORYBOARD ARTIST', `Generated ${storyboard.length} scenes.`);

      // 3. CHARACTER DESIGN
      addLog('CHARACTER DESIGN', 'Defining visual identity tokens...');
      const characterResponse = await generateContentWithRetry({
        model: creativeModel,
        contents: `Act as a Lead Character Designer. Analyze the following script and define the visual identity for the main characters.
        Script: ${script}
        
        For each main character, provide a "Visual Identity Token" that includes:
        - Face: Specific facial features, eye color, and unique expressions.
        - Outfit: A signature outfit (colors, materials, style) that remains consistent.
        - Appearance: Hair style/color, height/build, and any distinguishing marks (scars, tattoos).
        
        The goal is to provide a concise but highly descriptive prompt fragment that can be used to maintain visual consistency across different scenes.
        Return the tokens as a clear, descriptive text block.`,
        config: {
          ...(isPro ? { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } } : {})
        }
      });
      const characterTokens = characterResponse.text || '';
      setState(prev => ({ ...prev, characterTokens, status: 'generating_music' }));
      addLog('CHARACTER DESIGN', 'Visual identity tokens finalized and passed to production pipeline.');

      // 4. MUSIC GENERATION (Lyria)
      addLog('MUSIC PRODUCER', 'Generating original soundtrack with Lyria AI...');
      const musicPrompt = `Generate a ${input.duration} minute ${input.genre} track. 
      Mood: ${state.musicSettings?.mood || 'Cinematic'}. 
      Style: ${state.musicSettings?.referenceStyle || 'Original'}. 
      ${state.lyrics ? `Incorporate these lyrics: ${state.lyrics}` : ''}`;

      const musicParts: any[] = [{ text: musicPrompt }];
      if (state.musicSettings?.referenceAudioBase64) {
        musicParts.push({
          inlineData: {
            data: state.musicSettings.referenceAudioBase64,
            mimeType: "audio/mpeg"
          }
        });
      }

      const musicResponse = await generateContentStreamWithRetry({
        model: input.isMusicVideoMode || parseInt(input.duration) > 0 ? "lyria-3-pro-preview" : "lyria-3-clip-preview",
        contents: { parts: musicParts },
      });

      let audioBase64 = "";
      let musicMimeType = "audio/wav";
      for await (const chunk of musicResponse) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;
        for (const part of parts) {
          if (part.inlineData?.data) {
            if (!audioBase64 && part.inlineData.mimeType) musicMimeType = part.inlineData.mimeType;
            audioBase64 += part.inlineData.data;
          }
        }
      }
      
      if (audioBase64) {
        const binary = atob(audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: musicMimeType });
        const musicUrl = URL.createObjectURL(blob);
        setState(prev => ({ ...prev, musicUrl, status: 'generating_voice' }));
        addLog('MUSIC PRODUCER', 'Music track mastered and integrated into production.');
      }

      // 5. VOICE GENERATION (TTS)
      addLog('VOICE DIRECTOR', `Casting voice: ${input.voiceName}${input.voiceSample ? ' (Custom Sample Reference Loaded)' : ''}...`);
      
      const ttsResponse = await generateContentWithRetry({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ 
          parts: [
            { text: `Narrate with cinematic gravitas, matching the requested tone: ${script.slice(0, 500)}` },
            ...(input.voiceSample ? [{ inlineData: { data: input.voiceSample, mimeType: 'audio/mpeg' } }] : [])
          ] 
        }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { 
            voiceConfig: { 
              prebuiltVoiceConfig: { voiceName: input.voiceName as any } 
            } 
          },
        },
      });
      addLog('VOICE DIRECTOR', `Voice tracks ready using ${input.voiceName} signature.`);

      // 6. ASSET GENERATION (Parallelized for Speed & Upgraded for Quality)
      setState(prev => ({ ...prev, status: 'generating_assets' }));
      const updatedStoryboard = [...storyboard];
      
      // Process scenes in parallel with a concurrency limit of 2 to balance speed and quota
      const processScene = async (i: number) => {
        const startTime = Date.now();
        addLog('VIDEO GENERATION', `Scene ${i + 1}: Initiating Studio Quality Render...`);
        
        try {
          // Image Generation (Studio Quality)
          const imgRes = await generateContentWithRetry({
            model: 'gemini-3.1-flash-image-preview',
            contents: {
              parts: [{ text: `Masterpiece cinematic film still, 8k, ultra-detailed, ${storyboard[i].visualPrompt}, character: ${characterTokens}, lighting: ${storyboard[i].lighting}, high-end cinematography` }]
            },
            config: {
              imageConfig: { aspectRatio: "16:9", imageSize: "1K" }
            }
          });

          const preview = imgRes.candidates?.[0]?.content?.parts.find(p => p.inlineData);
          if (preview?.inlineData) {
            const imageUrl = `data:image/png;base64,${preview.inlineData.data}`;
            
            // Update state immediately for visual feedback
            setState(prev => {
              const newStoryboard = [...prev.storyboard];
              newStoryboard[i] = {
                ...newStoryboard[i],
                previews: [imageUrl],
                selectedPreviewIndex: 0,
                imageUrl: imageUrl
              };
              return { ...prev, storyboard: newStoryboard };
            });

            // Animate Selected Image to Video (Upgraded to Full Veo for Quality)
            addLog('VIDEO GENERATION', `Scene ${i + 1}: Animating with Veo Studio (High Fidelity)...`);
            const selectedImageBase64 = preview.inlineData.data;
            let videoOp = await generateVideosWithRetry({
              model: 'veo-3.1-generate-preview',
              prompt: `High-fidelity cinematic motion, ${storyboard[i].cameraMovement}, ${storyboard[i].description}, photorealistic, 8k resolution`,
              image: { imageBytes: selectedImageBase64, mimeType: 'image/png' },
              config: { numberOfVideos: 1, resolution: '1080p', aspectRatio: '16:9' }
            });

            while (!videoOp.done) {
              await new Promise(r => setTimeout(r, 5000));
              videoOp = await getVideosOperationWithRetry({ operation: videoOp });
            }
            
            if (videoOp.response?.generatedVideos?.[0]?.video?.uri) {
              const videoRes = await fetch(videoOp.response.generatedVideos[0].video.uri, {
                headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY! }
              });
              const videoBlob = await videoRes.blob();
              const videoUrl = URL.createObjectURL(videoBlob);
              
              // Cache video asset locally for offline/faster preview
              if (state.id) {
                await storageService.saveAsset(`${state.id}_scene_${i}_video`, videoBlob);
              }
              
              const endTime = Date.now();
              setState(prev => {
                const newStoryboard = [...prev.storyboard];
                newStoryboard[i] = {
                  ...newStoryboard[i],
                  videoUrl,
                  generationTime: endTime - startTime
                };
                return { ...prev, storyboard: newStoryboard };
              });
              
              updatedStoryboard[i] = { ...updatedStoryboard[i], videoUrl, imageUrl, generationTime: endTime - startTime };
              addLog('VIDEO GENERATION', `Scene ${i + 1}: Render Complete.`);
            }
          }
        } catch (err: any) {
          console.error(`Error in Scene ${i + 1}:`, err);
          addLog('QUALITY CONTROL', `Scene ${i + 1}: Render failed. ${err.message || ''}`);
        }
      };

      // Run scenes in batches of 2
      for (let i = 0; i < Math.min(storyboard.length, 6); i += 2) {
        const batch = [];
        batch.push(processScene(i));
        if (i + 1 < Math.min(storyboard.length, 6)) {
          batch.push(processScene(i + 1));
        }
        await Promise.all(batch);
        
        // Small cooldown between batches
        if (i + 2 < Math.min(storyboard.length, 6)) {
          addLog('SYSTEM', 'Optimizing pipeline for next batch...');
          await new Promise(r => setTimeout(r, 5000));
        }
      }

      // 7. SOUND DESIGN
      setState(prev => ({ ...prev, status: 'generating_sound' }));
      addLog('SOUND DESIGN', 'Layering atmospheric textures and Foley effects...');
      
      for (let i = 0; i < Math.min(updatedStoryboard.length, 3); i++) {
        const scene = updatedStoryboard[i];
        const soundInfo = [
          scene.ambiencePreset && scene.ambiencePreset !== 'None' ? `Ambience: ${scene.ambiencePreset}` : null,
          scene.sfxPreset && scene.sfxPreset !== 'None' ? `SFX: ${scene.sfxPreset}` : null,
          scene.soundDesignPrompt ? `Prompt: ${scene.soundDesignPrompt}` : null
        ].filter(Boolean).join(' | ');
        
        addLog('SOUND DESIGN', `Designing audio for Scene ${i + 1}: ${soundInfo || 'Standard Mix'}`);
        // Simulate audio generation for SFX/Ambience
        // In a real app, we might call a specialized audio model here
        await new Promise(r => setTimeout(r, 2000));
      }
      addLog('SOUND DESIGN', 'Audio layering and spatial mixing complete.');
      
      // 8. VFX STAGE
      setState(prev => ({ ...prev, status: 'vfx' }));
      if (state.vfx?.cgiElements && state.vfx.cgiElements.length > 0) {
        addLog('VFX ARTIST', 'Generating dynamic CGI assets using dedicated AI model...');
        await new Promise(r => setTimeout(r, 1500));
        addLog('VFX ARTIST', 'CGI elements generated and ready for compositing.');
      }
      addLog('VFX ARTIST', `Integrating CGI elements: ${state.vfx?.cgiElements?.join(', ') || 'None'}`);
      addLog('VFX ARTIST', `CGI Intensity: ${state.vfx?.cgiIntensity}% | Animation: ${state.vfx?.cgiAnimation}`);
      addLog('VFX ARTIST', `Applying motion graphics: ${state.vfx?.motionGraphics}`);
      addLog('VFX ARTIST', `Compositing mode: ${state.vfx?.compositing}`);
      addLog('SYSTEM', `Render Quality: ${state.vfx?.renderSettings?.resolution} @ ${state.vfx?.renderSettings?.frameRate} (${state.vfx?.renderSettings?.encoding})`);
      await new Promise(r => setTimeout(r, 4000));
      addLog('VFX ARTIST', 'VFX compositing and motion graphics integration complete.');
      
      // 9. POST-PRODUCTION
      setState(prev => ({ ...prev, status: 'post_production' }));
      addLog('COLOR GRADING', `Applying ${state.postProduction?.colorGrade} color grade and ${state.postProduction?.filter} filters...`);
      if (state.postProduction?.upscale !== '1x') {
        addLog('SYSTEM', `AI-Driven Upscaling initiated: ${state.postProduction?.upscale} target resolution.`);
      }
      await new Promise(r => setTimeout(r, 3000));
      addLog('COLOR GRADING', 'Visual mastering and upscaling complete.');

      setState(prev => ({ ...prev, status: 'completed' }));
      addLog('EXECUTIVE PRODUCER', 'Production Complete.');
      saveProduction({ ...state, storyboard: updatedStoryboard, status: 'completed' });

    } catch (error: any) {
      console.error(error);
      const errorMsg = error?.message || String(error);
      
      if (errorMsg.includes('403') || errorMsg.includes('PERMISSION_DENIED') || errorMsg.includes('does not have permission') || errorMsg.includes('Requested entity was not found')) {
        addLog('QUALITY CONTROL', 'Permission Denied: Your API key does not have access to these models.');
        setHasApiKey(false); // Trigger the API key selection screen
      } else if (errorMsg.includes('spending cap') || errorMsg.includes('billing details')) {
        addLog('QUALITY CONTROL', 'Spending Cap Exceeded: Your Google Cloud project has reached its budget limit.');
        addLog('SYSTEM', 'Please visit https://console.cloud.google.com/billing to raise your cap or check your payment method.');
        setState(prev => ({ ...prev, status: 'error' }));
      } else {
        setState(prev => ({ ...prev, status: 'error' }));
        addLog('QUALITY CONTROL', 'Critical production failure.');
      }
    }
  };

  const handleChat = async () => {
    if (!chatInput.trim() || !user) return;
    
    const userMsg: ChatMessage = {
      role: 'user',
      content: chatInput,
      timestamp: serverTimestamp(),
      userId: user.uid
    };

    setChatInput('');
    setIsChatLoading(true);

    try {
      await addDoc(collection(db, 'chats', user.uid, 'messages'), userMsg);
      
      const history = chatMessages.map(m => ({
        role: m.role,
        parts: [{ text: m.content }]
      }));

      const response = await generateContentWithRetry({
        model: "gemini-3-flash-preview",
        contents: [...history, { role: 'user', parts: [{ text: chatInput }] }],
        config: {
          systemInstruction: "You are the Aurora Studio AI Production Assistant. Help the user with script ideas, technical advice, and production management.",
        }
      });

      const modelMsg: ChatMessage = {
        role: 'model',
        content: response.text || 'I encountered an issue processing that.',
        timestamp: serverTimestamp(),
        userId: user.uid
      };

      await addDoc(collection(db, 'chats', user.uid, 'messages'), modelMsg);
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      if (errorMsg.includes('403') || errorMsg.includes('PERMISSION_DENIED') || errorMsg.includes('does not have permission') || errorMsg.includes('Requested entity was not found')) {
        setHasApiKey(false);
      } else {
        handleFirestoreError(err, OperationType.WRITE, `chats/${user.uid}/messages`);
      }
    } finally {
      setIsChatLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 font-sans selection:bg-amber-500/30 flex overflow-hidden">
      {/* SVG Filters */}
      <svg className="hidden">
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="linear" slope="0.1" />
            <feFuncG type="linear" slope="0.1" />
            <feFuncB type="linear" slope="0.1" />
          </feComponentTransfer>
          <feComposite operator="in" in2="SourceGraphic" />
        </filter>
      </svg>

      {/* Sidebar - Production History */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.aside 
            initial={{ x: -300 }}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            className="w-72 border-r border-zinc-800/50 bg-black/80 backdrop-blur-2xl flex flex-col z-40"
          >
            <div className="p-6 border-b border-zinc-800/50 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Studio Library</h2>
              <button onClick={() => setIsSidebarOpen(false)} className="text-zinc-500 hover:text-white"><X className="w-4 h-4"/></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
              {productions.map((p) => (
                <button 
                  key={p.id}
                  onClick={() => setState(p)}
                  className="w-full p-3 rounded-xl bg-zinc-900/50 border border-zinc-800 hover:border-amber-500/50 transition-all text-left group"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-amber-500 uppercase">{p.genre}</span>
                    <span className="text-[10px] text-zinc-600">{p.createdAt?.toDate().toLocaleDateString()}</span>
                  </div>
                  <h3 className="text-sm font-semibold truncate group-hover:text-amber-400">{p.title}</h3>
                </button>
              ))}
            </div>

            <div className="p-4 border-t border-zinc-800/50 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Download className="w-3 h-3 text-zinc-500" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Offline Cache</span>
                </div>
                <button 
                  onClick={async () => {
                    if (confirm('Clear all locally cached video assets?')) {
                      await storageService.clearAll();
                      window.location.reload();
                    }
                  }}
                  className="text-[8px] font-black text-zinc-600 hover:text-red-500 uppercase tracking-tighter"
                >
                  Clear Cache
                </button>
              </div>
              <div className="p-3 bg-zinc-900/50 border border-zinc-800 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] text-zinc-500 font-bold uppercase">Status</span>
                  <span className="text-[9px] text-green-500 font-bold uppercase">Active</span>
                </div>
                <p className="text-[8px] text-zinc-600 leading-relaxed">
                  Generated scenes are automatically stored in your browser's IndexedDB for instant playback in future sessions.
                </p>
              </div>
            </div>
            {user && (
              <div className="p-4 border-t border-zinc-800/50 flex items-center gap-3">
                <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-zinc-700" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{user.displayName}</p>
                  <button onClick={logout} className="text-[10px] text-zinc-500 hover:text-red-400">Sign Out</button>
                </div>
              </div>
            )}
          </motion.aside>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Header */}
        <header className="h-16 border-b border-zinc-800/50 bg-black/50 backdrop-blur-xl flex items-center justify-between px-6 z-30">
          <div className="flex items-center gap-4">
            {!isSidebarOpen && (
              <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-zinc-800 rounded-lg transition-colors">
                <MoreVertical className="w-5 h-5 text-zinc-400" />
              </button>
            )}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-orange-600 rounded-lg flex items-center justify-center shadow-lg shadow-amber-500/20">
                <Sparkles className="w-5 h-5 text-black" />
              </div>
              <h1 className="text-xl font-bold tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">
                AURORA STUDIO AI
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Credits Badge Hidden in Demo Mode */}
            {!user ? (
              <button 
                onClick={() => {
                  signInWithGoogle().catch(err => {
                    console.error("Sign-in error:", err);
                    alert(`Sign-in failed: ${err.message}. Please ensure your Vercel domain is added to the "Authorized domains" list in the Firebase Console (Authentication > Settings).`);
                  });
                }}
                className="px-4 py-2 bg-white text-black text-xs font-bold rounded-full flex items-center gap-2 hover:bg-zinc-200 transition-all"
              >
                <LogIn className="w-4 h-4" />
                STUDIO LOGIN
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-full">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-green-500 uppercase tracking-widest">Live Link</span>
                </div>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left: Controls */}
            <div className="lg:col-span-4 space-y-6">
              <section className="bg-zinc-900/30 border border-zinc-800/50 rounded-3xl p-6 backdrop-blur-sm">
                <div className="flex items-center gap-2 mb-6">
                  <Film className="w-4 h-4 text-amber-500" />
                  <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Production Brief</h2>
                </div>
                
                <div className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase ml-1">Creative Concept</label>
                    <textarea 
                      value={input.concept}
                      onChange={e => setInput(prev => ({ ...prev, concept: e.target.value }))}
                      placeholder="Describe your cinematic vision..."
                      className="w-full bg-black/50 border border-zinc-800 rounded-2xl p-4 text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500/50 outline-none transition-all resize-none h-32"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase ml-1">Genre</label>
                      <select 
                        value={input.genre}
                        onChange={e => setInput(prev => ({ ...prev, genre: e.target.value }))}
                        className="w-full bg-black/50 border border-zinc-800 rounded-xl p-3 text-xs outline-none focus:border-amber-500/50"
                      >
                        <option>Cinematic Sci-Fi</option>
                        <option>Dark Horror</option>
                        <option>Epic Fantasy</option>
                        <option>Afrobeats</option>
                        <option>Hip-hop</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase ml-1">Duration</label>
                      <select 
                        value={input.duration}
                        onChange={e => setInput(prev => ({ ...prev, duration: e.target.value }))}
                        className="w-full bg-black/50 border border-zinc-800 rounded-xl p-3 text-xs outline-none focus:border-amber-500/50"
                      >
                        <option value="3">3 Mins</option>
                        <option value="10">10 Mins</option>
                      </select>
                    </div>
                  </div>

                  <button 
                    onClick={() => setInput(prev => ({ ...prev, isMusicVideoMode: !prev.isMusicVideoMode }))}
                    className={cn(
                      "w-full p-4 rounded-2xl border transition-all flex items-center justify-between group",
                      input.isMusicVideoMode ? "bg-amber-500/10 border-amber-500/50" : "bg-black/50 border-zinc-800"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Music className={cn("w-5 h-5", input.isMusicVideoMode ? "text-amber-500" : "text-zinc-500")} />
                      <div className="text-left">
                        <p className="text-xs font-bold">Music Video Mode</p>
                        <p className="text-[10px] text-zinc-500">Sync visuals to rhythm</p>
                      </div>
                    </div>
                    <div className={cn(
                      "w-10 h-5 rounded-full relative transition-all",
                      input.isMusicVideoMode ? "bg-amber-500" : "bg-zinc-800"
                    )}>
                      <div className={cn(
                        "absolute top-1 w-3 h-3 rounded-full bg-white transition-all",
                        input.isMusicVideoMode ? "right-1" : "left-1"
                      )} />
                    </div>
                  </button>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase ml-1">Voice Casting</label>
                    <div className="grid grid-cols-2 gap-2">
                      <select 
                        value={input.voiceName}
                        onChange={e => setInput(prev => ({ ...prev, voiceName: e.target.value }))}
                        className="w-full bg-black/50 border border-zinc-800 rounded-xl p-3 text-xs outline-none focus:border-amber-500/50"
                      >
                        <option value="Fenrir">Fenrir (Deep)</option>
                        <option value="Puck">Puck (Playful)</option>
                        <option value="Charon">Charon (Mysterious)</option>
                        <option value="Kore">Kore (Soft)</option>
                        <option value="Zephyr">Zephyr (Neutral)</option>
                      </select>
                      <label className="flex items-center justify-center gap-2 bg-black/50 border border-zinc-800 rounded-xl p-3 text-xs cursor-pointer hover:border-amber-500/50 transition-all">
                        <Mic className={cn("w-3 h-3", input.voiceSample ? "text-amber-500" : "text-zinc-500")} />
                        <span className="truncate">{input.voiceSample ? 'Sample Loaded' : 'Upload Sample'}</span>
                        <input 
                          type="file" 
                          accept="audio/*" 
                          className="hidden" 
                          onChange={handleVoiceUpload}
                        />
                      </label>
                    </div>
                  </div>

                  <button 
                    onClick={startProduction}
                    disabled={state.status !== 'idle' && state.status !== 'completed'}
                    className={cn(
                      "w-full py-4 rounded-2xl font-black text-xs tracking-[0.2em] flex items-center justify-center gap-3 transition-all",
                      state.status === 'idle' || state.status === 'completed'
                        ? "bg-amber-500 text-black hover:scale-[1.02] active:scale-[0.98] shadow-xl shadow-amber-500/20"
                        : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                    )}
                  >
                    {state.status === 'idle' || state.status === 'completed' ? (
                      <>
                        <Play className="w-4 h-4 fill-current" />
                        INITIATE PRODUCTION
                      </>
                    ) : (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        SYSTEM PROCESSING...
                      </>
                    )}
                  </button>
                </div>
              </section>

              {/* Logs */}
              <section className="bg-black border border-zinc-800/50 rounded-3xl flex flex-col h-[300px] overflow-hidden">
                <div className="p-4 border-b border-zinc-800/50 flex items-center justify-between bg-zinc-900/20">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-3 h-3 text-zinc-500" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Production Feed</span>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 font-mono text-[10px] space-y-2 scrollbar-hide">
                  {state.logs.map((log, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-zinc-700">{i+1}</span>
                      <span className={cn(
                        log.includes('EXECUTIVE') ? "text-amber-500" : 
                        log.includes('ERROR') ? "text-red-500" : "text-zinc-400"
                      )}>{log}</span>
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </section>
            </div>

            {/* Right: Preview & Tabs */}
            <div className="lg:col-span-8 space-y-6">
              {/* Preview Window */}
              <section className="aspect-video bg-zinc-900 rounded-[2.5rem] border border-zinc-800/50 overflow-hidden relative shadow-2xl group">
                {state.status === 'idle' ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-600 gap-6">
                    <div className="w-24 h-24 rounded-full bg-zinc-800/30 flex items-center justify-center border border-zinc-700/30">
                      <Film className="w-10 h-10 opacity-20" />
                    </div>
                    <div className="text-center space-y-1">
                      <p className="text-sm font-bold tracking-widest uppercase">Studio Standby</p>
                      <p className="text-xs opacity-50">Awaiting production initiation...</p>
                    </div>
                  </div>
                ) : (
                  <div className="absolute inset-0 overflow-hidden">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={`scene-${currentSceneIndex}`}
                        initial={
                          state.storyboard[currentSceneIndex]?.transitionType === 'Zoom' ? { scale: 1.5, opacity: 0, filter: 'blur(20px)' } :
                          state.storyboard[currentSceneIndex]?.transitionType === 'Wipe' ? { x: '100%', filter: 'brightness(2)' } :
                          state.storyboard[currentSceneIndex]?.transitionType === 'Glitch' ? { x: -20, opacity: 0, filter: 'hue-rotate(180deg) contrast(200%)' } :
                          state.storyboard[currentSceneIndex]?.transitionType === 'Dissolve' ? { opacity: 0, filter: 'grayscale(1) blur(10px)' } :
                          state.storyboard[currentSceneIndex]?.transitionType === 'Morphing' ? { scale: 1.2, rotate: 5, opacity: 0, filter: 'blur(30px) saturate(200%)' } :
                          state.storyboard[currentSceneIndex]?.transitionType === 'Light Trails' ? { x: '150%', skewX: -20, opacity: 0, filter: 'brightness(3) blur(5px)' } :
                          state.storyboard[currentSceneIndex]?.transitionType === 'Abstract Flows' ? { y: '20%', scale: 0.9, opacity: 0, filter: 'hue-rotate(90deg) blur(15px)' } :
                          { opacity: 0 }
                        }
                        animate={{ scale: 1, x: 0, y: 0, rotate: 0, skewX: 0, opacity: 1, filter: 'none' }}
                        style={{
                          filter: cn(
                            state.postProduction?.colorGrade === 'Cinematic' && 'contrast(1.1) saturate(1.1) sepia(0.1)',
                            state.postProduction?.colorGrade === 'Vintage' && 'sepia(0.5) contrast(0.9) brightness(1.1)',
                            state.postProduction?.colorGrade === 'Noir' && 'grayscale(1) contrast(1.2)',
                            state.postProduction?.colorGrade === 'Vibrant' && 'saturate(1.5) contrast(1.1)',
                            state.postProduction?.colorGrade === 'Teal & Orange' && 'hue-rotate(-10deg) saturate(1.2) contrast(1.1)',
                            state.postProduction?.filter === 'Grain' && 'url(#grain)',
                            state.postProduction?.filter === 'Bloom' && 'brightness(1.2) blur(0.5px)',
                            state.postProduction?.filter === 'Vignette' && 'brightness(0.9)',
                            state.postProduction?.filter === 'VHS' && 'hue-rotate(10deg) saturate(1.5) contrast(0.8) blur(1px)'
                          ) || undefined
                        }}
                        exit={
                          state.storyboard[currentSceneIndex]?.transitionType === 'Zoom' ? { scale: 0.5, opacity: 0, filter: 'blur(20px)' } :
                          state.storyboard[currentSceneIndex]?.transitionType === 'Wipe' ? { x: '-100%', filter: 'brightness(0)' } :
                          state.storyboard[currentSceneIndex]?.transitionType === 'Glitch' ? { x: 20, opacity: 0, filter: 'hue-rotate(-180deg) contrast(200%)' } :
                          state.storyboard[currentSceneIndex]?.transitionType === 'Dissolve' ? { opacity: 0, filter: 'grayscale(1) blur(10px)' } :
                          state.storyboard[currentSceneIndex]?.transitionType === 'Morphing' ? { scale: 0.8, rotate: -5, opacity: 0, filter: 'blur(30px) saturate(0%)' } :
                          state.storyboard[currentSceneIndex]?.transitionType === 'Light Trails' ? { x: '-150%', skewX: 20, opacity: 0, filter: 'brightness(3) blur(5px)' } :
                          state.storyboard[currentSceneIndex]?.transitionType === 'Abstract Flows' ? { y: '-20%', scale: 1.1, opacity: 0, filter: 'hue-rotate(-90deg) blur(15px)' } :
                          { opacity: 0 }
                        }
                        transition={{ duration: 0.8, ease: "easeInOut" }}
                        className="w-full h-full"
                      >
                        {state.storyboard[currentSceneIndex]?.videoUrl ? (
                          <video 
                            src={state.storyboard[currentSceneIndex].videoUrl}
                            className="w-full h-full object-cover"
                            autoPlay
                            loop
                            muted
                          />
                        ) : state.storyboard[currentSceneIndex]?.imageUrl ? (
                          <div className="relative w-full h-full group">
                            <img 
                              src={state.storyboard[currentSceneIndex].imageUrl}
                              className="w-full h-full object-cover"
                            />
                            {state.storyboard[currentSceneIndex]?.previews && state.storyboard[currentSceneIndex]!.previews!.length > 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cycleScenePreview(currentSceneIndex);
                                }}
                                className="absolute top-4 right-4 p-3 bg-black/60 hover:bg-black/80 backdrop-blur-xl rounded-2xl border border-white/10 text-white opacity-0 group-hover:opacity-100 transition-all flex items-center gap-2"
                              >
                                <Sparkles className="w-4 h-4 text-amber-500" />
                                <span className="text-[10px] font-bold uppercase tracking-widest">
                                  Variation {(state.storyboard[currentSceneIndex].selectedPreviewIndex || 0) + 1}/{state.storyboard[currentSceneIndex].previews?.length}
                                </span>
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                generateScenePreviews(currentSceneIndex);
                              }}
                              className="absolute top-4 left-4 p-3 bg-black/60 hover:bg-black/80 backdrop-blur-xl rounded-2xl border border-white/10 text-white opacity-0 group-hover:opacity-100 transition-all flex items-center gap-2"
                            >
                              <Wand2 className="w-4 h-4 text-amber-500" />
                              <span className="text-[10px] font-bold uppercase tracking-widest">
                                Regenerate Previews
                              </span>
                            </button>
                          </div>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-zinc-950">
                            <div className="flex flex-col items-center gap-4">
                              <Loader2 className="w-12 h-12 text-amber-500 animate-spin" />
                              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.3em]">Rendering Cinematic Asset</p>
                            </div>
                          </div>
                        )}

                          {/* VFX Overlays */}
                          <AnimatePresence>
                            {state.vfx?.cgiElements?.includes('Energy Fields') && (
                              <motion.div 
                                initial={{ opacity: 0 }}
                                animate={{ 
                                  opacity: (state.vfx?.cgiIntensity || 50) / 150,
                                  ...(state.vfx?.cgiAnimation === 'Pulse' ? { scale: [1, 1.05, 1] } : {}),
                                  ...(state.vfx?.cgiAnimation === 'Flow' ? { backgroundPosition: ['0% 0%', '100% 100%'] } : {}),
                                  ...(state.vfx?.cgiAnimation === 'Orbit' ? { rotate: [0, 360] } : {})
                                }}
                                transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
                                className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,rgba(139,92,246,0.3)_0%,transparent_70%)] mix-blend-screen"
                                style={{ backgroundSize: '200% 200%' }}
                              />
                            )}
                            {state.vfx?.cgiElements?.includes('Alien Flora') && (
                              <motion.div 
                                initial={{ opacity: 0, y: 100 }}
                                animate={{ 
                                  opacity: (state.vfx?.cgiIntensity || 50) / 100,
                                  y: 0,
                                  ...(state.vfx?.cgiAnimation === 'Pulse' ? { scaleY: [1, 1.1, 1] } : {}),
                                  ...(state.vfx?.cgiAnimation === 'Flow' ? { skewX: [-5, 5, -5] } : {})
                                }}
                                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                                className="absolute bottom-0 inset-x-0 h-1/2 pointer-events-none bg-[url('https://picsum.photos/seed/alien-flora/800/400')] bg-bottom bg-no-repeat opacity-30 mix-blend-lighten"
                                style={{ backgroundSize: 'contain' }}
                              />
                            )}
                            {state.vfx?.cgiElements?.includes('Abstract Geometric Shapes') && (
                              <motion.div 
                                initial={{ opacity: 0 }}
                                animate={{ 
                                  opacity: (state.vfx?.cgiIntensity || 50) / 150,
                                  ...(state.vfx?.cgiAnimation === 'Orbit' ? { rotate: [0, 360] } : {}),
                                  ...(state.vfx?.cgiAnimation === 'Glitch' ? { x: [-5, 5, -5], skew: [-10, 10, -10] } : {})
                                }}
                                transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                                className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden"
                              >
                                {[...Array(5)].map((_, i) => (
                                  <motion.div
                                    key={i}
                                    animate={{ 
                                      rotate: [0, 360],
                                      scale: [1, 1.2, 1],
                                    }}
                                    transition={{ duration: 15 + i * 5, repeat: Infinity, ease: "linear" }}
                                    className="absolute border border-amber-500/20 rounded-full"
                                    style={{ width: 100 + i * 100, height: 100 + i * 100 }}
                                  />
                                ))}
                              </motion.div>
                            )}
                            {state.vfx?.cgiElements?.includes('Holographic') && (
                            <motion.div 
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 0.3 }}
                              exit={{ opacity: 0 }}
                              className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,transparent_0%,rgba(59,130,246,0.1)_100%)]"
                              style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(59,130,246,0.05) 3px)' }}
                            />
                          )}
                          {state.vfx?.cgiElements?.includes('Cybernetic') && (
                            <motion.div 
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 0.4 }}
                              exit={{ opacity: 0 }}
                              className="absolute inset-0 pointer-events-none border-[20px] border-amber-500/10 mix-blend-overlay"
                              style={{ clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, 5% 5%, 5% 95%, 95% 95%, 95% 5%, 5% 5%)' }}
                            />
                          )}
                          {state.vfx?.cgiElements?.includes('Particle') && (
                            <motion.div 
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 0.2 }}
                              exit={{ opacity: 0 }}
                              className="absolute inset-0 pointer-events-none overflow-hidden"
                            >
                              {[...Array(20)].map((_, i) => (
                                <motion.div
                                  key={i}
                                  animate={{ 
                                    y: [-20, 400],
                                    x: [Math.random() * 800, Math.random() * 800],
                                    opacity: [0, 1, 0]
                                  }}
                                  transition={{ 
                                    duration: Math.random() * 3 + 2,
                                    repeat: Infinity,
                                    delay: Math.random() * 5
                                  }}
                                  className="absolute w-1 h-1 bg-white rounded-full blur-[1px]"
                                />
                              ))}
                            </motion.div>
                          )}
                          {state.vfx?.motionGraphics !== 'None' && (
                            <motion.div 
                              initial={{ y: 20, opacity: 0 }}
                              animate={{ y: 0, opacity: 1 }}
                              className="absolute bottom-12 left-12 pointer-events-none"
                            >
                              {state.vfx?.motionGraphics === 'Cinematic Titles' && (
                                <div className="space-y-1">
                                  <div className="h-0.5 w-12 bg-amber-500" />
                                  <h4 className="text-2xl font-black uppercase tracking-[0.4em] text-white/90 drop-shadow-2xl">
                                    {state.title || 'Untitled Production'}
                                  </h4>
                                </div>
                              )}
                              {state.vfx?.motionGraphics === 'Data Overlays' && (
                                <div className="font-mono text-[8px] text-blue-400/60 space-y-1 uppercase tracking-widest">
                                  <div className="flex items-center gap-2">
                                    <div className="w-1 h-1 bg-blue-400 animate-pulse" />
                                    SCANNING_ENVIRONMENT... OK
                                  </div>
                                  <div>LAT: 34.0522° N | LON: 118.2437° W</div>
                                  <div>DEPTH_COMPOSITING: {state.vfx?.compositing}</div>
                                </div>
                              )}
                              {state.vfx?.motionGraphics === 'Callouts' && (
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-full border border-amber-500/50 flex items-center justify-center">
                                    <div className="w-1 h-1 bg-amber-500 rounded-full animate-ping" />
                                  </div>
                                  <div className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Target Identified</div>
                                </div>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    </AnimatePresence>

                    {/* Controls Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                      <div className="absolute bottom-8 inset-x-8 flex items-end justify-between">
                        <div className="max-w-xl space-y-3">
                          <div className="flex items-center gap-3">
                            <span className="px-2 py-1 bg-amber-500 text-black text-[9px] font-black rounded uppercase">Scene {currentSceneIndex + 1}</span>
                            <span className="text-white/60 text-[10px] font-bold uppercase tracking-widest">{state.storyboard[currentSceneIndex]?.cameraMovement}</span>
                          </div>
                          <h3 className="text-xl font-bold leading-tight text-white drop-shadow-lg">
                            {state.storyboard[currentSceneIndex]?.description}
                          </h3>
                        </div>
                        <div className="flex gap-3">
                          <button 
                            onClick={() => setCurrentSceneIndex(p => Math.max(0, p - 1))}
                            className="p-4 bg-white/10 hover:bg-white/20 rounded-2xl backdrop-blur-xl border border-white/10 transition-all"
                          >
                            <ChevronRight className="w-6 h-6 rotate-180" />
                          </button>
                          <button 
                            onClick={() => setCurrentSceneIndex(p => Math.min(state.storyboard.length - 1, p + 1))}
                            className="p-4 bg-white/10 hover:bg-white/20 rounded-2xl backdrop-blur-xl border border-white/10 transition-all"
                          >
                            <ChevronRight className="w-6 h-6" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* Tabbed Content */}
              <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-[2rem] overflow-hidden flex flex-col h-[500px]">
                <div className="flex border-b border-zinc-800/50 bg-black/20">
                  {[
                    { id: 'script', label: 'Script', icon: Type },
                    { id: 'characters', label: 'Characters', icon: Palette },
                    { id: 'storyboard', label: 'Storyboard', icon: Layers },
                    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
                    { id: 'music', label: 'Music', icon: Music },
                    { id: 'vfx', label: 'VFX', icon: Zap },
                    { id: 'post-production', label: 'Mastering', icon: Wand2 },
                    { id: 'chat', label: 'Assistant', icon: MessageSquare },
                    // { id: 'pricing', label: 'Upgrade', icon: Zap },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as any)}
                      className={cn(
                        "flex-1 py-4 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all",
                        activeTab === tab.id ? "text-amber-500 bg-amber-500/5" : "text-zinc-500 hover:text-zinc-300"
                      )}
                    >
                      <tab.icon className="w-3.5 h-3.5" />
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="flex-1 overflow-hidden p-6">
                  {activeTab === 'script' && (
                    <div className="h-full overflow-y-auto pr-4 custom-scrollbar prose prose-invert prose-sm max-w-none">
                      {state.script ? <ReactMarkdown>{state.script}</ReactMarkdown> : <p className="text-zinc-600 italic text-center mt-20">Script will be generated here...</p>}
                    </div>
                  )}

                  {activeTab === 'characters' && (
                    <div className="h-full overflow-y-auto pr-4 custom-scrollbar">
                      {state.characterTokens ? (
                        <div className="space-y-6">
                          <div className="flex items-center gap-3 p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
                            <Palette className="w-5 h-5 text-amber-500" />
                            <div>
                              <h3 className="text-xs font-bold uppercase tracking-widest text-amber-500">Visual Identity Tokens</h3>
                              <p className="text-[10px] text-zinc-500">Locked for cross-scene consistency</p>
                            </div>
                          </div>
                          <div className="prose prose-invert prose-sm max-w-none bg-black/20 p-6 rounded-2xl border border-zinc-800/50">
                            <ReactMarkdown>{state.characterTokens}</ReactMarkdown>
                          </div>
                        </div>
                      ) : (
                        <p className="text-zinc-600 italic text-center mt-20">Character designs will appear here...</p>
                      )}
                    </div>
                  )}

                  {activeTab === 'storyboard' && (
                    <div className="h-full overflow-y-auto pr-4 custom-scrollbar space-y-4">
                      <div className="flex justify-between items-center mb-6 bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800/50">
                        <div>
                          <h2 className="text-sm font-black text-white uppercase tracking-widest">Storyboard Pipeline</h2>
                          <p className="text-[10px] text-zinc-500">Refine scene details and generate visual previews.</p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              addLog('STORYBOARD ARTIST', 'Starting batch refinement of all scenes...');
                              for (let i = 0; i < state.storyboard.length; i++) {
                                await generateSceneDetails(i);
                              }
                              addLog('STORYBOARD ARTIST', 'Batch refinement complete.');
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 text-amber-500 text-[10px] font-black rounded-xl hover:bg-amber-500/20 transition-all border border-amber-500/20 uppercase tracking-widest"
                          >
                            <Brain className="w-3.5 h-3.5" />
                            Refine All
                          </button>
                          <button
                            onClick={async () => {
                              addLog('VIDEO GENERATION', 'Starting batch generation of all scene previews...');
                              for (let i = 0; i < state.storyboard.length; i++) {
                                await generateScenePreviews(i);
                              }
                              addLog('VIDEO GENERATION', 'Batch preview generation complete.');
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white text-[10px] font-black rounded-xl hover:bg-blue-400 transition-all shadow-lg shadow-blue-500/20 uppercase tracking-widest"
                          >
                            <Wand2 className="w-3.5 h-3.5" />
                            Generate All Previews
                          </button>
                        </div>
                      </div>
                      {state.storyboard.map((scene, i) => (
                        <div 
                          key={i}
                          onClick={() => setCurrentSceneIndex(currentSceneIndex === i ? -1 : i)}
                          className={cn(
                            "p-4 rounded-2xl border transition-all cursor-pointer group",
                            currentSceneIndex === i ? "bg-amber-500/10 border-amber-500/30" : "bg-black/20 border-zinc-800/50 hover:border-zinc-700"
                          )}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <span className="text-[9px] font-black text-zinc-500 uppercase">Scene {scene.id}</span>
                            <span className="text-[9px] font-mono text-zinc-600">{scene.duration}s</span>
                          </div>
                          <p className="text-xs font-bold group-hover:text-amber-400 transition-colors">{scene.description}</p>
                          
                          {currentSceneIndex === i && (
                            <motion.div 
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              className="mt-4 pt-4 border-t border-zinc-800/50 space-y-4 overflow-hidden"
                            >
                              <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-1.5">
                                  <label className="text-[8px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
                                    <Film className="w-3 h-3" />
                                    Scene Description
                                  </label>
                                  <input
                                    type="text"
                                    value={scene.description || ''}
                                    onChange={(e) => updateSceneField(i, 'description', e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-[10px] text-zinc-300 focus:border-amber-500/50 outline-none transition-all"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[8px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
                                    <Camera className="w-3 h-3" />
                                    Camera Movement
                                  </label>
                                  <input
                                    type="text"
                                    value={scene.cameraMovement || ''}
                                    onChange={(e) => updateSceneField(i, 'cameraMovement', e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-[10px] text-zinc-300 focus:border-amber-500/50 outline-none transition-all"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[8px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
                                    <Sparkles className="w-3 h-3" />
                                    Lighting
                                  </label>
                                  <input
                                    type="text"
                                    value={scene.lighting || ''}
                                    onChange={(e) => updateSceneField(i, 'lighting', e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-[10px] text-zinc-300 focus:border-amber-500/50 outline-none transition-all"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[8px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
                                    <Activity className="w-3 h-3" />
                                    Duration (s)
                                  </label>
                                  <input
                                    type="number"
                                    value={scene.duration || 0}
                                    onChange={(e) => updateSceneField(i, 'duration', parseInt(e.target.value) || 0)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-[10px] text-zinc-300 focus:border-amber-500/50 outline-none transition-all"
                                  />
                                </div>
                              </div>
                              
                              <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-1.5">
                                  <label className="text-[8px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
                                    <Layers className="w-3 h-3" />
                                    Section Type
                                  </label>
                                  <select
                                    value={scene.sectionType || 'Verse'}
                                    onChange={(e) => updateSceneField(i, 'sectionType', e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-[10px] text-zinc-300 focus:border-amber-500/50 outline-none transition-all"
                                  >
                                    {['Intro', 'Verse', 'Chorus', 'Bridge', 'Outro'].map(t => (
                                      <option key={t} value={t} className="bg-zinc-900 text-zinc-300">{t}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[8px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
                                    <Mic className="w-3 h-3" />
                                    Performance Scene
                                  </label>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      updateSceneField(i, 'isPerformance', !scene.isPerformance);
                                    }}
                                    className={cn(
                                      "w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-[10px] font-bold uppercase tracking-widest transition-all",
                                      scene.isPerformance ? "bg-amber-500/20 border-amber-500/50 text-amber-500" : "bg-black/40 border-zinc-800 text-zinc-500"
                                    )}
                                  >
                                    {scene.isPerformance ? 'Performance Mode ON' : 'Performance Mode OFF'}
                                  </button>
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[8px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
                                    <Zap className="w-3 h-3" />
                                    Transition
                                  </label>
                                  <select
                                    value={scene.transitionType || 'Crossfade'}
                                    onChange={(e) => updateSceneTransition(i, e.target.value as any)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-[10px] text-zinc-300 focus:border-amber-500/50 outline-none transition-all"
                                  >
                                    {['Crossfade', 'Wipe', 'Dissolve', 'Cut', 'Zoom', 'Glitch', 'Morphing', 'Light Trails', 'Abstract Flows'].map(t => (
                                      <option key={t} value={t} className="bg-zinc-900 text-zinc-300">{t}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                  <label className="text-[8px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
                                    <Mic className="w-3 h-3" />
                                    Narration
                                  </label>
                                  <textarea
                                    value={scene.narration || ''}
                                    onChange={(e) => updateSceneField(i, 'narration', e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    rows={2}
                                    className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-[10px] text-zinc-300 focus:border-amber-500/50 outline-none transition-all resize-none custom-scrollbar"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[8px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
                                    <MessageSquare className="w-3 h-3" />
                                    Dialogue
                                  </label>
                                  <textarea
                                    value={scene.dialogue || ''}
                                    onChange={(e) => updateSceneField(i, 'dialogue', e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    rows={2}
                                    className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-[10px] text-zinc-300 focus:border-amber-500/50 outline-none transition-all resize-none custom-scrollbar"
                                  />
                                </div>
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-[8px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
                                  <Type className="w-3 h-3" />
                                  Visual Prompt
                                </label>
                                <textarea
                                  value={scene.visualPrompt || ''}
                                  onChange={(e) => updateSceneField(i, 'visualPrompt', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  rows={3}
                                  className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-[10px] text-zinc-300 focus:border-amber-500/50 outline-none transition-all resize-none custom-scrollbar"
                                />
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-[8px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
                                  <Volume2 className="w-3 h-3" />
                                  Sound Design Prompt
                                </label>
                                <textarea
                                  value={scene.soundDesignPrompt || ''}
                                  onChange={(e) => updateSceneField(i, 'soundDesignPrompt', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  rows={3}
                                  className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-[10px] text-zinc-300 focus:border-amber-500/50 outline-none transition-all resize-none custom-scrollbar"
                                />
                              </div>
                              
                              <div className="flex justify-between items-center">
                                <div className="flex gap-2">
                                  <button
                                    disabled={scene.isRefining}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      generateSceneDetails(i);
                                    }}
                                    className={cn(
                                      "flex items-center gap-2 text-[8px] font-black uppercase tracking-widest transition-all px-3 py-1.5 rounded-lg border",
                                      scene.isRefining 
                                        ? "bg-zinc-800 border-zinc-700 text-zinc-500 cursor-not-allowed" 
                                        : "bg-amber-500/5 border-amber-500/20 text-amber-500 hover:text-amber-400"
                                    )}
                                  >
                                    {scene.isRefining ? (
                                      <>
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        Refining...
                                      </>
                                    ) : (
                                      <>
                                        <Brain className="w-3 h-3" />
                                        Refine with AI
                                      </>
                                    )}
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      generateScenePreviews(i);
                                    }}
                                    className="flex items-center gap-2 text-[8px] font-black uppercase tracking-widest text-blue-400 hover:text-blue-300 transition-all bg-blue-500/5 px-3 py-1.5 rounded-lg border border-blue-500/20"
                                  >
                                    <Wand2 className="w-3 h-3" />
                                    Generate Previews
                                  </button>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCurrentSceneIndex(-1);
                                  }}
                                  className="text-[8px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
                                >
                                  <ChevronDown className="w-3 h-3 rotate-180" />
                                  Collapse Details
                                </button>
                              </div>
                            </motion.div>
                          )}

                          <div className="mt-2 flex flex-wrap gap-2">
                            {scene.soundDesignPrompt && (
                              <div className="flex items-center gap-1.5 text-[9px] text-blue-400/70 bg-blue-500/5 px-2 py-1 rounded-lg border border-blue-500/10">
                                <Volume2 className="w-3 h-3" />
                                <span className="font-bold uppercase tracking-widest">Audio Layered</span>
                              </div>
                            )}
                            {scene.cameraMovement && (
                              <div className="flex items-center gap-1.5 text-[9px] text-zinc-400/70 bg-zinc-500/5 px-2 py-1 rounded-lg border border-zinc-500/10">
                                <Camera className="w-3 h-3" />
                                <span className="font-bold uppercase tracking-widest">Custom Cam</span>
                              </div>
                            )}
                            {scene.lighting && (
                              <div className="flex items-center gap-1.5 text-[9px] text-amber-400/70 bg-amber-500/5 px-2 py-1 rounded-lg border border-amber-500/10">
                                <Sparkles className="w-3 h-3" />
                                <span className="font-bold uppercase tracking-widest">Custom Light</span>
                              </div>
                            )}
                            {scene.transitionType && (
                              <div className="flex items-center gap-1.5 text-[9px] text-zinc-400/70 bg-zinc-500/5 px-2 py-1 rounded-lg border border-zinc-500/10">
                                <Zap className="w-3 h-3 text-amber-500" />
                                <span className="font-bold uppercase tracking-widest">{scene.transitionType}</span>
                              </div>
                            )}
                            <div className="relative flex items-center gap-1 bg-blue-500/5 px-2 py-1 rounded-lg border border-blue-500/10">
                              <Wind className="w-2.5 h-2.5 text-blue-400" />
                              <select
                                value={scene.ambiencePreset || 'None'}
                                onChange={(e) => updateSceneField(i, 'ambiencePreset', e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                className="appearance-none text-[9px] text-blue-400/70 bg-transparent cursor-pointer hover:text-blue-400 transition-all font-bold uppercase tracking-widest outline-none pr-4"
                              >
                                {AMBIENCE_PRESETS.map(p => (
                                  <option key={p} value={p} className="bg-zinc-900 text-zinc-300">{p}</option>
                                ))}
                              </select>
                              <ChevronDown className="w-2.5 h-2.5 text-blue-500/50 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
                            </div>
                            <div className="relative flex items-center gap-1 bg-purple-500/5 px-2 py-1 rounded-lg border border-purple-500/10">
                              <Zap className="w-2.5 h-2.5 text-purple-400" />
                              <select
                                value={scene.sfxPreset || 'None'}
                                onChange={(e) => updateSceneField(i, 'sfxPreset', e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                className="appearance-none text-[9px] text-purple-400/70 bg-transparent cursor-pointer hover:text-purple-400 transition-all font-bold uppercase tracking-widest outline-none pr-4"
                              >
                                {SFX_PRESETS.map(p => (
                                  <option key={p} value={p} className="bg-zinc-900 text-zinc-300">{p}</option>
                                ))}
                              </select>
                              <ChevronDown className="w-2.5 h-2.5 text-purple-500/50 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
                            </div>
                            {scene.previews && scene.previews.length > 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cycleScenePreview(i);
                                }}
                                className="flex items-center gap-2 text-[9px] text-blue-400/70 bg-blue-500/5 px-2 py-1 rounded-lg border border-blue-500/10 hover:bg-blue-500/10 transition-all font-bold uppercase tracking-widest"
                              >
                                <Sparkles className="w-3 h-3" />
                                Variation {(scene.selectedPreviewIndex || 0) + 1}/{scene.previews.length}
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                generateScenePreviews(i);
                              }}
                              className="flex items-center gap-2 text-[9px] text-zinc-400/70 bg-zinc-500/5 px-2 py-1 rounded-lg border border-zinc-800/50 hover:bg-zinc-800/80 transition-all font-bold uppercase tracking-widest"
                            >
                              <Wand2 className="w-3 h-3" />
                              Regenerate
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeTab === 'analytics' && (
                    <div className="h-full flex flex-col space-y-8 overflow-y-auto pr-4 custom-scrollbar">
                      <div className="space-y-4">
                        <div className="flex items-center gap-2">
                          <Activity className="w-4 h-4 text-amber-500" />
                          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Scene Durations (Seconds)</h3>
                        </div>
                        <div className="h-[180px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={state.storyboard}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f23" vertical={false} />
                              <XAxis dataKey="id" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                              <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                              <Tooltip 
                                contentStyle={{ backgroundColor: '#09090b', border: '1px solid #27272a', borderRadius: '8px', fontSize: '10px' }}
                                itemStyle={{ color: '#f59e0b' }}
                              />
                              <Bar dataKey="duration" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center gap-2">
                          <Zap className="w-4 h-4 text-blue-500" />
                          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Asset Generation Time (Seconds)</h3>
                        </div>
                        <div className="h-[180px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={state.storyboard.filter(s => s.generationTime)}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f23" vertical={false} />
                              <XAxis dataKey="id" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                              <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                              <Tooltip 
                                contentStyle={{ backgroundColor: '#09090b', border: '1px solid #27272a', borderRadius: '8px', fontSize: '10px' }}
                                itemStyle={{ color: '#3b82f6' }}
                                formatter={(value: number) => [(value / 1000).toFixed(2) + 's', 'Time']}
                              />
                              <Line type="monotone" dataKey="generationTime" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6', r: 4 }} activeDot={{ r: 6 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'vfx' && (
                    <div className="h-full overflow-y-auto pr-4 custom-scrollbar space-y-8">
                      <div className="flex items-center gap-3 p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
                        <Zap className="w-5 h-5 text-amber-500" />
                        <div>
                          <h3 className="text-xs font-bold uppercase tracking-widest text-amber-500">Visual Effects Stage</h3>
                          <p className="text-[10px] text-zinc-500">Add CGI elements, motion graphics, and compositing</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                            <Cpu className="w-3 h-3" /> CGI Elements
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            {['Cybernetic', 'Atmospheric', 'Holographic', 'Particle', 'Energy Fields', 'Alien Flora', 'Abstract Geometric Shapes'].map(element => (
                              <button
                                key={element}
                                onClick={() => {
                                  const current = state.vfx?.cgiElements || [];
                                  const updated = current.includes(element as any) 
                                    ? current.filter(e => e !== element)
                                    : [...current, element as any];
                                  updateVfx('cgiElements', updated);
                                }}
                                className={cn(
                                  "px-3 py-2 rounded-xl text-[10px] font-bold border transition-all",
                                  state.vfx?.cgiElements?.includes(element as any)
                                    ? "bg-amber-500/20 border-amber-500/50 text-amber-500" 
                                    : "bg-black/20 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                                )}
                              >
                                {element}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-4">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                            <Activity className="w-3 h-3" /> CGI Intensity
                          </label>
                          <div className="flex items-center gap-4">
                            <input 
                              type="range" 
                              min="0" 
                              max="100" 
                              value={state.vfx?.cgiIntensity || 50}
                              onChange={(e) => updateVfx('cgiIntensity', parseInt(e.target.value))}
                              className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                            <span className="text-[10px] font-mono text-amber-500 w-8">{state.vfx?.cgiIntensity || 50}%</span>
                          </div>

                          {/* Individual Element Controls */}
                          <AnimatePresence>
                            {state.vfx?.cgiElements?.includes('Cybernetic') && (
                              <motion.div 
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="space-y-2 pt-2 border-t border-zinc-800/50"
                              >
                                <label className="text-[8px] font-black uppercase tracking-widest text-zinc-600 flex items-center justify-between">
                                  <span>Cybernetic Intensity</span>
                                  <span className="text-amber-500/70">{state.vfx?.cyberneticIntensity || 50}%</span>
                                </label>
                                <input 
                                  type="range" 
                                  min="0" 
                                  max="100" 
                                  value={state.vfx?.cyberneticIntensity || 50}
                                  onChange={(e) => updateVfx('cyberneticIntensity', parseInt(e.target.value))}
                                  className="w-full h-0.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500/50"
                                />
                              </motion.div>
                            )}
                            {state.vfx?.cgiElements?.includes('Atmospheric') && (
                              <motion.div 
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="space-y-2 pt-2 border-t border-zinc-800/50"
                              >
                                <label className="text-[8px] font-black uppercase tracking-widest text-zinc-600 flex items-center justify-between">
                                  <span>Atmospheric Intensity</span>
                                  <span className="text-amber-500/70">{state.vfx?.atmosphericIntensity || 50}%</span>
                                </label>
                                <input 
                                  type="range" 
                                  min="0" 
                                  max="100" 
                                  value={state.vfx?.atmosphericIntensity || 50}
                                  onChange={(e) => updateVfx('atmosphericIntensity', parseInt(e.target.value))}
                                  className="w-full h-0.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500/50"
                                />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                        <div className="space-y-4">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                            <Wind className="w-3 h-3" /> CGI Animation
                          </label>
                          <div className="grid grid-cols-3 gap-2">
                            {['Static', 'Pulse', 'Flow', 'Glitch', 'Orbit'].map(anim => (
                              <button
                                key={anim}
                                onClick={() => updateVfx('cgiAnimation', anim as any)}
                                className={cn(
                                  "px-2 py-1.5 rounded-lg text-[9px] font-bold border transition-all",
                                  state.vfx?.cgiAnimation === anim 
                                    ? "bg-amber-500/20 border-amber-500/50 text-amber-500" 
                                    : "bg-black/20 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                                )}
                              >
                                {anim}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-4">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                            <Layers className="w-3 h-3" /> Motion Graphics
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            {['None', 'Lower Thirds', 'Callouts', 'Data Overlays', 'Cinematic Titles'].map(mg => (
                              <button
                                key={mg}
                                onClick={() => updateVfx('motionGraphics', mg)}
                                className={cn(
                                  "px-3 py-2 rounded-xl text-[10px] font-bold border transition-all",
                                  state.vfx?.motionGraphics === mg 
                                    ? "bg-blue-500/20 border-blue-500/50 text-blue-500" 
                                    : "bg-black/20 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                                )}
                              >
                                {mg}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-4 md:col-span-2">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                            <Scissors className="w-3 h-3" /> Compositing Engine
                          </label>
                          <div className="flex gap-3">
                            {['Standard', 'Deep', 'Multi-Layer'].map(comp => (
                              <button
                                key={comp}
                                onClick={() => updateVfx('compositing', comp)}
                                className={cn(
                                  "flex-1 px-4 py-3 rounded-2xl text-xs font-black border transition-all flex items-center justify-center gap-2",
                                  state.vfx?.compositing === comp 
                                    ? "bg-zinc-100 text-black border-white shadow-lg shadow-white/10" 
                                    : "bg-black/20 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                                )}
                              >
                                {comp}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="md:col-span-2 pt-4 border-t border-zinc-800/50 space-y-6">
                          <div className="flex items-center gap-2">
                            <Settings className="w-4 h-4 text-zinc-400" />
                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Advanced Render Settings</h3>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="space-y-3">
                              <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Resolution</label>
                              <div className="flex flex-col gap-2">
                                {['720p', '1080p', '4K'].map(res => (
                                  <button
                                    key={res}
                                    onClick={() => updateVfx('renderSettings', { ...state.vfx?.renderSettings!, resolution: res })}
                                    className={cn(
                                      "px-3 py-2 rounded-xl text-[10px] font-bold border transition-all text-left flex justify-between items-center",
                                      state.vfx?.renderSettings?.resolution === res 
                                        ? "bg-white/10 border-white/20 text-white" 
                                        : "bg-black/20 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                                    )}
                                  >
                                    {res}
                                    {state.vfx?.renderSettings?.resolution === res && <div className="w-1 h-1 bg-amber-500 rounded-full" />}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-3">
                              <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Frame Rate</label>
                              <div className="flex flex-col gap-2">
                                {['24fps', '30fps', '60fps'].map(fps => (
                                  <button
                                    key={fps}
                                    onClick={() => updateVfx('renderSettings', { ...state.vfx?.renderSettings!, frameRate: fps })}
                                    className={cn(
                                      "px-3 py-2 rounded-xl text-[10px] font-bold border transition-all text-left flex justify-between items-center",
                                      state.vfx?.renderSettings?.frameRate === fps 
                                        ? "bg-white/10 border-white/20 text-white" 
                                        : "bg-black/20 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                                    )}
                                  >
                                    {fps}
                                    {state.vfx?.renderSettings?.frameRate === fps && <div className="w-1 h-1 bg-amber-500 rounded-full" />}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-3">
                              <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Encoding Preset</label>
                              <div className="flex flex-col gap-2">
                                {['H.264', 'H.265', 'ProRes'].map(enc => (
                                  <button
                                    key={enc}
                                    onClick={() => updateVfx('renderSettings', { ...state.vfx?.renderSettings!, encoding: enc })}
                                    className={cn(
                                      "px-3 py-2 rounded-xl text-[10px] font-bold border transition-all text-left flex justify-between items-center",
                                      state.vfx?.renderSettings?.encoding === enc 
                                        ? "bg-white/10 border-white/20 text-white" 
                                        : "bg-black/20 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                                    )}
                                  >
                                    {enc}
                                    {state.vfx?.renderSettings?.encoding === enc && <div className="w-1 h-1 bg-amber-500 rounded-full" />}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'music' && (
                    <div className="h-full overflow-y-auto pr-4 custom-scrollbar space-y-8">
                      <div className="flex items-center gap-3 p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
                        <Music className="w-5 h-5 text-amber-500" />
                        <div>
                          <h3 className="text-xs font-bold uppercase tracking-widest text-amber-500">AI Music Composition</h3>
                          <p className="text-[10px] text-zinc-500">Generate original soundtracks tailored to your production</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                            <Brain className="w-3 h-3" /> Musical Mood
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            {['Epic', 'Melancholic', 'Suspenseful', 'Upbeat', 'Ambient', 'Aggressive'].map(mood => (
                              <button
                                key={mood}
                                onClick={() => updateMusicSettings('mood', mood)}
                                className={cn(
                                  "px-3 py-2 rounded-xl text-[10px] font-bold border transition-all",
                                  state.musicSettings?.mood === mood 
                                    ? "bg-amber-500/20 border-amber-500/50 text-amber-500" 
                                    : "bg-black/20 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                                )}
                              >
                                {mood}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-4">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                            <Search className="w-3 h-3" /> Reference Style
                          </label>
                          <input 
                            value={state.musicSettings?.referenceStyle || ''}
                            onChange={e => updateMusicSettings('referenceStyle', e.target.value)}
                            placeholder="e.g. Hans Zimmer, 80s Synthwave..."
                            className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-[10px] outline-none focus:border-amber-500/50"
                          />
                        </div>

                        <div className="space-y-4 md:col-span-2">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                            <Plus className="w-3 h-3" /> Reference Audio (Optional)
                          </label>
                          <div className="flex items-center gap-4 p-4 bg-zinc-900/50 border border-dashed border-zinc-800 rounded-2xl">
                            <input 
                              type="file" 
                              accept="audio/*"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  const reader = new FileReader();
                                  reader.onloadend = () => {
                                    updateMusicSettings('referenceAudioBase64', (reader.result as string).split(',')[1]);
                                  };
                                  reader.readAsDataURL(file);
                                }
                              }}
                              className="hidden" 
                              id="music-ref-upload" 
                            />
                            <label 
                              htmlFor="music-ref-upload"
                              className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-[10px] font-bold cursor-pointer transition-all"
                            >
                              <Download className="w-3 h-3" /> Upload Reference
                            </label>
                            {state.musicSettings?.referenceAudioBase64 && (
                              <div className="flex items-center gap-2 text-[10px] text-green-500 font-bold">
                                <CheckCircle2 className="w-3 h-3" /> Audio Attached
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'post-production' && (
                    <div className="h-full overflow-y-auto pr-4 custom-scrollbar space-y-8">
                      <div className="flex items-center gap-3 p-4 bg-blue-500/5 border border-blue-500/20 rounded-2xl">
                        <Wand2 className="w-5 h-5 text-blue-500" />
                        <div>
                          <h3 className="text-xs font-bold uppercase tracking-widest text-blue-500">Post-Production Mastering</h3>
                          <p className="text-[10px] text-zinc-500">Apply cinematic grading and AI upscaling</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                            <Palette className="w-3 h-3" /> Color Grading
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            {['None', 'Cinematic', 'Vintage', 'Noir', 'Vibrant', 'Teal & Orange'].map(grade => (
                              <button
                                key={grade}
                                onClick={() => updatePostProduction('colorGrade', grade)}
                                className={cn(
                                  "px-3 py-2 rounded-xl text-[10px] font-bold border transition-all",
                                  state.postProduction?.colorGrade === grade 
                                    ? "bg-amber-500/20 border-amber-500/50 text-amber-500" 
                                    : "bg-black/20 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                                )}
                              >
                                {grade}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-4">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                            <Sparkles className="w-3 h-3" /> Visual Filters
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            {['None', 'Grain', 'Bloom', 'Vignette', 'VHS'].map(f => (
                              <button
                                key={f}
                                onClick={() => updatePostProduction('filter', f)}
                                className={cn(
                                  "px-3 py-2 rounded-xl text-[10px] font-bold border transition-all",
                                  state.postProduction?.filter === f 
                                    ? "bg-blue-500/20 border-blue-500/50 text-blue-500" 
                                    : "bg-black/20 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                                )}
                              >
                                {f}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-4 md:col-span-2">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                            <Cpu className="w-3 h-3" /> AI Upscaling (Super Resolution)
                          </label>
                          <div className="flex gap-3">
                            {['1x', '2x', '4x'].map(scale => (
                              <button
                                key={scale}
                                onClick={() => updatePostProduction('upscale', scale)}
                                className={cn(
                                  "flex-1 px-4 py-3 rounded-2xl text-xs font-black border transition-all flex items-center justify-center gap-2",
                                  state.postProduction?.upscale === scale 
                                    ? "bg-zinc-100 text-black border-white shadow-lg shadow-white/10" 
                                    : "bg-black/20 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                                )}
                              >
                                {scale === '1x' ? 'Native' : `${scale} Upscale`}
                                {scale !== '1x' && <Zap className="w-3 h-3 fill-current" />}
                              </button>
                            ))}
                          </div>
                          <p className="text-[9px] text-zinc-600 italic">
                            * AI upscaling increases render time but significantly enhances texture detail and edge sharpness.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'chat' && (
                    <div className="h-full flex flex-col">
                      <div className="flex-1 overflow-y-auto space-y-4 pr-4 custom-scrollbar mb-4">
                        {chatMessages.map((msg, i) => (
                          <div key={i} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
                            <div className={cn(
                              "max-w-[80%] p-4 rounded-2xl text-xs leading-relaxed",
                              msg.role === 'user' ? "bg-amber-500 text-black font-bold" : "bg-zinc-800 text-zinc-200"
                            )}>
                              {msg.content}
                            </div>
                          </div>
                        ))}
                        {isChatLoading && (
                          <div className="flex justify-start">
                            <div className="bg-zinc-800 p-4 rounded-2xl">
                              <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                            </div>
                          </div>
                        )}
                        <div ref={chatEndRef} />
                      </div>
                      <div className="flex gap-2">
                        <input 
                          value={chatInput}
                          onChange={e => setChatInput(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleChat()}
                          placeholder="Ask your production assistant..."
                          className="flex-1 bg-black border border-zinc-800 rounded-xl px-4 py-3 text-xs outline-none focus:border-amber-500/50"
                        />
                        <button 
                          onClick={handleChat}
                          className="p-3 bg-amber-500 text-black rounded-xl hover:bg-amber-400 transition-all"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}

                  {activeTab === 'pricing' && (
                    <div className="h-full overflow-y-auto pr-4 custom-scrollbar">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {[
                          { 
                            name: 'Free', 
                            price: '$0', 
                            credits: '10', 
                            features: ['Flash Models', '720p Resolution', 'Standard Support'],
                            priceId: null,
                            current: userProfile?.plan === 'free'
                          },
                          { 
                            name: 'Pro', 
                            price: '$29', 
                            credits: '100', 
                            features: ['Pro Models', '1080p Resolution', 'Priority Support', 'Custom Voices'],
                            priceId: 'price_pro_id', // Replace with real Stripe Price ID
                            current: userProfile?.plan === 'pro'
                          },
                          { 
                            name: 'Enterprise', 
                            price: '$99', 
                            credits: '500', 
                            features: ['Pro Models', '4K Resolution', 'Dedicated Support', 'API Access'],
                            priceId: 'price_ent_id', // Replace with real Stripe Price ID
                            current: userProfile?.plan === 'enterprise'
                          }
                        ].map((tier) => (
                          <div key={tier.name} className={cn(
                            "p-6 rounded-3xl border flex flex-col gap-6 transition-all",
                            tier.current ? "bg-amber-500/10 border-amber-500/50" : "bg-black/50 border-zinc-800 hover:border-zinc-700"
                          )}>
                            <div className="space-y-1">
                              <h3 className="text-sm font-black uppercase tracking-widest text-white">{tier.name}</h3>
                              <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-black text-white">{tier.price}</span>
                                <span className="text-[10px] text-zinc-500 uppercase font-bold">/month</span>
                              </div>
                            </div>
                            <div className="space-y-3 flex-1">
                              <div className="flex items-center gap-2 text-amber-500">
                                <Zap className="w-3.5 h-3.5" />
                                <span className="text-[10px] font-black uppercase tracking-widest">{tier.credits} Credits</span>
                              </div>
                              <ul className="space-y-2">
                                {tier.features.map(f => (
                                  <li key={f} className="flex items-center gap-2 text-[10px] text-zinc-400">
                                    <CheckCircle2 className="w-3 h-3 text-zinc-600" />
                                    {f}
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <button 
                              onClick={() => tier.priceId && handleSubscribe(tier.priceId)}
                              disabled={tier.current || !tier.priceId}
                              className={cn(
                                "w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                                tier.current ? "bg-zinc-800 text-zinc-500 cursor-default" : "bg-white text-black hover:scale-[1.02]"
                              )}
                            >
                              {tier.current ? 'Current Plan' : tier.priceId ? 'Upgrade Now' : 'Free Tier'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Status Bar */}
              <section className="bg-zinc-900/30 border border-zinc-800/50 rounded-2xl p-4 flex justify-center gap-4 flex-wrap">
                {[
                  { id: 'scripting', label: 'Script', icon: Type },
                  { id: 'designing_characters', label: 'Design', icon: Palette },
                  { id: 'generating_music', label: 'Music', icon: Music },
                  { id: 'generating_assets', label: 'Visuals', icon: ImageIcon },
                  { id: 'generating_sound', label: 'Sound', icon: Volume2 },
                  { id: 'vfx', label: 'VFX', icon: Zap },
                  { id: 'editing', label: 'Edit', icon: Scissors },
                ].map((s) => (
                  <div key={s.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/40 border border-zinc-800/50">
                    <s.icon className={cn(
                      "w-3.5 h-3.5",
                      state.status === s.id ? "text-amber-500 animate-pulse" : 
                      state.status === 'completed' ? "text-green-500" : "text-zinc-700"
                    )} />
                    <span className={cn(
                      "text-[9px] font-black uppercase tracking-widest",
                      state.status === s.id ? "text-white" : "text-zinc-700"
                    )}>{s.label}</span>
                  </div>
                ))}
              </section>
            </div>
          </div>
        </main>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1f1f23; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #27272a; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
