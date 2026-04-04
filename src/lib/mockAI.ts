
import { ProductionState, Scene, ChatMessage } from '../types';

const SAMPLE_IMAGES = [
  'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=800&q=80',
  'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&q=80',
  'https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?w=800&q=80',
  'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&q=80',
  'https://images.unsplash.com/photo-1506318137071-a8e063b4b477?w=800&q=80',
  'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&q=80',
  'https://images.unsplash.com/photo-1534214526114-0ea4d47b04f2?w=800&q=80',
  'https://images.unsplash.com/photo-1501854140801-50d01674d821?w=800&q=80'
];

const SAMPLE_VIDEOS = [
  'https://assets.mixkit.co/videos/preview/mixkit-stars-in-the-night-sky-4115-large.mp4',
  'https://assets.mixkit.co/videos/preview/mixkit-flying-over-a-snowy-mountain-range-at-sunset-4114-large.mp4',
  'https://assets.mixkit.co/videos/preview/mixkit-digital-animation-of-a-futuristic-city-4113-large.mp4'
];

export const MockAI = {
  generateScript: async (concept: string, genre: string): Promise<string> => {
    await new Promise(r => setTimeout(r, 1500));
    return `
# ${concept.toUpperCase()}
## A ${genre} Production

### INT. COMMAND CENTER - NIGHT
The room is bathed in the cool blue glow of holographic displays. **CAPTAIN ELARA** (30s, sharp features) stares at the data stream.

**ELARA**
We're running out of time. The core is destabilizing.

**KAI** (V.O.)
We have to jump now, or we lose the ship.

### EXT. DEEP SPACE - CONTINUOUS
The ship, a sleek silver needle, hangs against the backdrop of a dying star.

---
*This is a simulated script generated in Offline Mode.*
    `;
  },

  generateStoryboard: async (script: string): Promise<Scene[]> => {
    await new Promise(r => setTimeout(r, 2000));
    const scenes: Scene[] = [
      {
        id: 1,
        description: "Close up of Elara's eyes reflecting blue data.",
        visualPrompt: "Cinematic close up, sharp focus, blue lighting, futuristic interface reflections.",
        cameraMovement: "Slow Zoom In",
        lighting: "Cool Cyan",
        duration: 5,
        sectionType: 'Intro',
        transitionType: 'Crossfade',
        ambiencePreset: 'Cyberpunk City',
        sfxPreset: 'Digital Glitch',
        soundDesignPrompt: "Low hum of computers, occasional digital chirps."
      },
      {
        id: 2,
        description: "The ship floating in front of a massive nebula.",
        visualPrompt: "Wide shot, epic scale, vibrant nebula, sleek spaceship, high detail.",
        cameraMovement: "Pan Right",
        lighting: "Vibrant Purple",
        duration: 8,
        sectionType: 'Verse',
        transitionType: 'Zoom',
        ambiencePreset: 'Deep Space',
        sfxPreset: 'Mechanical Whir',
        soundDesignPrompt: "Deep space rumble, ethereal synth pads."
      },
      {
        id: 3,
        description: "The core begins to glow with intense white light.",
        visualPrompt: "Extreme close up, blinding light, energy particles, high contrast.",
        cameraMovement: "Static",
        lighting: "Blinding White",
        duration: 4,
        sectionType: 'Chorus',
        transitionType: 'Glitch',
        ambiencePreset: 'Industrial Factory',
        sfxPreset: 'Explosion',
        soundDesignPrompt: "Energy buildup, high pitched whine."
      }
    ];
    return scenes;
  },

  generateCharacterTokens: async (script: string): Promise<string> => {
    await new Promise(r => setTimeout(r, 1000));
    return `
### ELARA
- **Face**: Sharp jawline, piercing silver eyes, focused expression.
- **Outfit**: Dark gray tactical suit with glowing blue accents.
- **Appearance**: Short cropped black hair, athletic build.

### KAI
- **Face**: Friendly but tired, stubble, hazel eyes.
- **Outfit**: Scuffed pilot jacket over a simple tunic.
- **Appearance**: Messy brown hair, tall and lean.
    `;
  },

  generateAsset: async (prompt: string, type: 'image' | 'video'): Promise<string> => {
    await new Promise(r => setTimeout(r, 3000));
    if (type === 'video') {
      return SAMPLE_VIDEOS[Math.floor(Math.random() * SAMPLE_VIDEOS.length)];
    }
    return SAMPLE_IMAGES[Math.floor(Math.random() * SAMPLE_IMAGES.length)];
  },

  generateChatResponse: async (input: string, history: any[]): Promise<string> => {
    await new Promise(r => setTimeout(r, 1000));
    const responses = [
      "That sounds like a great direction for the script!",
      "I've analyzed your concept and I think we should lean more into the atmospheric elements.",
      "In Offline Mode, I can help you structure your ideas even without a live connection.",
      "The cinematic quality of this project is looking promising.",
      "Would you like me to refine the character motivations?"
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
};
