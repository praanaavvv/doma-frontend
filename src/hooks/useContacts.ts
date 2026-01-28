import { useState, useEffect, useCallback } from 'react';

export interface Contact {
    id: string;
    name: string;
    inboxId: string;
    createdAt: number;
}

const STORAGE_KEY = 'xmtp-contacts';

export const useContacts = () => {
    const [contacts, setContacts] = useState<Contact[]>([]);

    // Load contacts from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                setContacts(JSON.parse(stored));
            }
        } catch (e) {
            console.error('Failed to load contacts:', e);
        }
    }, []);

    // Save contacts to localStorage
    const saveContacts = useCallback((newContacts: Contact[]) => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(newContacts));
            setContacts(newContacts);
        } catch (e) {
            console.error('Failed to save contacts:', e);
        }
    }, []);

    const addContact = useCallback((name: string, inboxId: string) => {
        const newContact: Contact = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name,
            inboxId,
            createdAt: Date.now(),
        };
        saveContacts([...contacts, newContact]);
        return newContact;
    }, [contacts, saveContacts]);

    const removeContact = useCallback((id: string) => {
        saveContacts(contacts.filter(c => c.id !== id));
    }, [contacts, saveContacts]);

    const getContactByInboxId = useCallback((inboxId: string) => {
        return contacts.find(c => c.inboxId === inboxId);
    }, [contacts]);

    return {
        contacts,
        addContact,
        removeContact,
        getContactByInboxId,
    };
};
