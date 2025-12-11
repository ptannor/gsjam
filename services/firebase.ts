import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, push, onValue, remove, update, get, child } from 'firebase/database';

// We store the app instance and db instance
let app: any = null;
let db: any = null;

export const initFirebase = (config: any) => {
    try {
        // Validation: If keys are missing or still default placeholders, return false to force Local Storage
        if (
            !config || 
            !config.apiKey || 
            config.apiKey === "YOUR_API_KEY" || 
            config.projectId === "YOUR_PROJECT"
        ) {
            console.log("Firebase config missing or invalid. Using Local Storage.");
            return false;
        }

        // prevent double init
        if (app) return true;
        
        // Use the named import to access initializeApp
        app = initializeApp(config);
        db = getDatabase(app);
        console.log("Firebase connected successfully.");
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