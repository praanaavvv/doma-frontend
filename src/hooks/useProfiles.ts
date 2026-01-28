import { useState, useEffect, useCallback } from 'react';

export interface Profile {
    id: string;
    name: string;
    conversationId: string;
    createdAt: number;
}

const STORAGE_KEY = 'xmtp-profiles';

export const useProfiles = () => {
    const [profiles, setProfiles] = useState<Profile[]>([]);

    // Load profiles from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                setProfiles(JSON.parse(stored));
            }
        } catch (e) {
            console.error('Failed to load profiles:', e);
        }
    }, []);

    // Save profiles to localStorage
    const saveProfiles = useCallback((newProfiles: Profile[]) => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(newProfiles));
            setProfiles(newProfiles);
        } catch (e) {
            console.error('Failed to save profiles:', e);
        }
    }, []);

    const addProfile = useCallback((name: string, conversationId: string) => {
        const newProfile: Profile = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name,
            conversationId,
            createdAt: Date.now(),
        };
        saveProfiles([...profiles, newProfile]);
        return newProfile;
    }, [profiles, saveProfiles]);

    const removeProfile = useCallback((id: string) => {
        saveProfiles(profiles.filter(p => p.id !== id));
    }, [profiles, saveProfiles]);

    const getProfileByConversationId = useCallback((conversationId: string) => {
        return profiles.find(p => p.conversationId === conversationId);
    }, [profiles]);

    return {
        profiles,
        addProfile,
        removeProfile,
        getProfileByConversationId,
    };
};
