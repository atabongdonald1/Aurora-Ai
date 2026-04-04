
import { ProductionState, UserProfile, ChatMessage } from '../types';

const STORAGE_KEYS = {
  PRODUCTIONS: 'aurora_local_productions',
  USER: 'aurora_local_user',
  CHATS: 'aurora_local_chats'
};

export const LocalPersistence = {
  getProductions: (): ProductionState[] => {
    const data = localStorage.getItem(STORAGE_KEYS.PRODUCTIONS);
    return data ? JSON.parse(data) : [];
  },

  saveProduction: (prod: ProductionState) => {
    const prods = LocalPersistence.getProductions();
    const index = prods.findIndex(p => p.id === prod.id);
    if (index >= 0) {
      prods[index] = { ...prod, updatedAt: new Date().toISOString() };
    } else {
      prods.unshift({ ...prod, id: prod.id || `local_${Date.now()}`, createdAt: new Date().toISOString() });
    }
    localStorage.setItem(STORAGE_KEYS.PRODUCTIONS, JSON.stringify(prods));
  },

  deleteProduction: (id: string) => {
    const prods = LocalPersistence.getProductions().filter(p => p.id !== id);
    localStorage.setItem(STORAGE_KEYS.PRODUCTIONS, JSON.stringify(prods));
  },

  getUser: (): UserProfile => {
    const data = localStorage.getItem(STORAGE_KEYS.USER);
    if (data) return JSON.parse(data);
    
    const defaultUser: UserProfile = {
      uid: 'local_guest',
      email: 'guest@local.studio',
      displayName: 'Guest Director',
      photoURL: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Guest',
      plan: 'enterprise', // Give guest full access in offline mode
      credits: 9999,
      createdAt: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(defaultUser));
    return defaultUser;
  },

  updateUser: (user: Partial<UserProfile>) => {
    const current = LocalPersistence.getUser();
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({ ...current, ...user }));
  },

  getChats: (): ChatMessage[] => {
    const data = localStorage.getItem(STORAGE_KEYS.CHATS);
    return data ? JSON.parse(data) : [];
  },

  saveChat: (msg: ChatMessage) => {
    const chats = LocalPersistence.getChats();
    chats.push({ ...msg, id: `msg_${Date.now()}` });
    localStorage.setItem(STORAGE_KEYS.CHATS, JSON.stringify(chats));
  }
};
