import { useState, useCallback } from 'react';
import { onboardDomain, updateSubscription } from '../api/messagingApi';
import type { PolicyOptions, SubscriptionOptions, OnboardResponse } from '../api/messagingApi';

interface OnboardingState {
    isOnboarding: boolean;
    error: Error | null;
    lastOnboardResponse: OnboardResponse | null;
}

export const useOnboarding = () => {
    const [state, setState] = useState<OnboardingState>({
        isOnboarding: false,
        error: null,
        lastOnboardResponse: null,
    });

    const onboard = useCallback(async (
        domain: string,
        ownerWallet: string,
        options?: {
            messagingEnabled?: boolean;
            policy?: PolicyOptions;
            subscription?: SubscriptionOptions;
        }
    ): Promise<OnboardResponse | null> => {
        setState(prev => ({ ...prev, isOnboarding: true, error: null }));

        try {
            const response = await onboardDomain(domain, ownerWallet, options);
            setState(prev => ({
                ...prev,
                isOnboarding: false,
                lastOnboardResponse: response,
            }));
            return response;
        } catch (err) {
            const error = err instanceof Error ? err : new Error('Onboarding failed');
            setState(prev => ({ ...prev, isOnboarding: false, error }));
            return null;
        }
    }, []);

    const setSubscription = useCallback(async (
        domain: string,
        subscription: SubscriptionOptions | null
    ): Promise<boolean> => {
        setState(prev => ({ ...prev, isOnboarding: true, error: null }));

        try {
            await updateSubscription(domain, subscription);
            setState(prev => ({ ...prev, isOnboarding: false }));
            return true;
        } catch (err) {
            const error = err instanceof Error ? err : new Error('Subscription update failed');
            setState(prev => ({ ...prev, isOnboarding: false, error }));
            return false;
        }
    }, []);

    return {
        isOnboarding: state.isOnboarding,
        error: state.error,
        lastOnboardResponse: state.lastOnboardResponse,
        onboard,
        setSubscription,
    };
};
