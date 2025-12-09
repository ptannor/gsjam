import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, push, onValue, remove, update, get, child } from 'firebase/database';

// We store the app instance and db instance
let app: any = null;
let db: any = null;

export const initFirebase = (config: any) => {
    try {
        if (!config || !config.apiKey) return false;
        // prevent double init
        if (app) return true;
        
        app = initializeApp(config);
        db = getDatabase(app);
        return true;
    } catch (e) {
        console.error("Firebase init error", e);
        return false;
    }
};

export const isFirebaseReady = () => !!db;
export const getDb = () => db;

// Export Firebase functions for usage in App.tsx
export { ref, set, push, onValue, remove, update, get, child };