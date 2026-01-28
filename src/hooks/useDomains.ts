import { useState, useEffect, useCallback } from 'react';
import { getDomainsForOwner, getConversationsForDomain } from '../api/domaApi';
import type { DomainInfo, Conversation } from '../api/domaApi';

export const useDomains = (walletAddress: string | undefined) => {
    const [domains, setDomains] = useState<DomainInfo[]>([]);
    const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    // Fetch domains when wallet address changes
    useEffect(() => {
        if (!walletAddress) {
            setDomains([]);
            setSelectedDomain(null);
            return;
        }

        const fetchDomains = async () => {
            try {
                setIsLoading(true);
                setError(null);
                const response = await getDomainsForOwner(walletAddress);
                setDomains(response.domains);

                // Auto-select first domain if available
                if (response.domains.length > 0 && !selectedDomain) {
                    setSelectedDomain(response.domains[0].domain);
                }
            } catch (e) {
                console.error('Failed to fetch domains:', e);
                setError(e as Error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchDomains();
    }, [walletAddress]);

    // Fetch conversations when selected domain changes
    useEffect(() => {
        if (!selectedDomain) {
            setConversations([]);
            return;
        }

        const fetchConversations = async () => {
            try {
                const response = await getConversationsForDomain(selectedDomain);
                setConversations(response.conversations);
            } catch (e) {
                console.error('Failed to fetch conversations:', e);
            }
        };

        fetchConversations();
    }, [selectedDomain]);

    const refreshConversations = useCallback(async () => {
        if (!selectedDomain) return;
        try {
            const response = await getConversationsForDomain(selectedDomain);
            setConversations(response.conversations);
        } catch (e) {
            console.error('Failed to refresh conversations:', e);
        }
    }, [selectedDomain]);

    return {
        domains,
        selectedDomain,
        setSelectedDomain,
        conversations,
        isLoading,
        error,
        refreshConversations,
    };
};
