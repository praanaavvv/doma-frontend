const MESSAGING_API_BASE = 'http://localhost:8080/messaging';

// Types
export interface PolicyOptions {
    consentMode?: 'auto_accept' | 'request' | 'deny_unknown';
    feeMode?: 'none' | 'flat' | 'per_message';
    feeAsset?: string;
    feeAmountWei?: string;
    feeWindowMinutes?: number;
    templateId?: string;
    branding?: string;
    autoReplyMessage?: string;
    visibility?: string;
    metaTags?: string;
}

export interface SubscriptionOptions {
    plan: string;
    billingCycle?: 'monthly' | 'annual' | 'per_use';
    subscriptionFeeWei?: string;
    payPerUseFeeWei?: string;
    perks?: string[];
}

export interface OnboardPayload {
    ownerWallet: string;
    messagingEnabled?: boolean;
    policy?: PolicyOptions;
    subscription?: SubscriptionOptions;
}

export interface VerificationRecord {
    method: string;
    status: string;
    token?: string;
}

export interface OnboardResponse {
    domain: string;
    ownerWallet: string;
    verification: {
        record: VerificationRecord;
        dns: any;
        instructions: string | null;
    };
    policy: PolicyOptions | null;
    subscription: SubscriptionOptions | null;
    snapshot: any;
}

export interface SubscriptionResponse {
    domain: string;
    subscription: SubscriptionOptions | null;
}

// API Functions
export async function onboardDomain(
    domain: string,
    ownerWallet: string,
    options?: {
        messagingEnabled?: boolean;
        policy?: PolicyOptions;
        subscription?: SubscriptionOptions;
    }
): Promise<OnboardResponse> {
    const res = await fetch(`${MESSAGING_API_BASE}/${encodeURIComponent(domain)}/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ownerWallet,
            messagingEnabled: options?.messagingEnabled ?? true,
            policy: options?.policy,
            subscription: options?.subscription,
        }),
    });

    if (!res.ok) {
        const error = await res.json().catch(() => ({ title: 'Onboarding failed' }));
        throw new Error(error.detail || error.title || 'Failed to onboard domain');
    }

    return res.json();
}

export async function updateSubscription(
    domain: string,
    subscription: SubscriptionOptions | null
): Promise<SubscriptionResponse> {
    const res = await fetch(`${MESSAGING_API_BASE}/${encodeURIComponent(domain)}/subscription`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription || {}),
    });

    if (!res.ok) {
        const error = await res.json().catch(() => ({ title: 'Subscription update failed' }));
        throw new Error(error.detail || error.title || 'Failed to update subscription');
    }

    return res.json();
}

// Policy API - uses /policies endpoint
const POLICIES_API_BASE = 'http://localhost:8080/policies';

export interface DomainPolicy extends PolicyOptions {
    ownerWallet?: string;
    isDefault?: boolean;
}

export interface PolicyResponse {
    policy: DomainPolicy;
}

export async function getDomainPolicy(domain: string, owner?: string): Promise<PolicyResponse> {
    const url = new URL(`${POLICIES_API_BASE}/${encodeURIComponent(domain)}`);
    if (owner) {
        url.searchParams.set('owner', owner);
    }

    const res = await fetch(url.toString());
    if (!res.ok) {
        const error = await res.json().catch(() => ({ title: 'Failed to fetch policy' }));
        throw new Error(error.detail || error.title || 'Failed to fetch domain policy');
    }

    return res.json();
}

// Check if domain is onboarded (has a real policy, not default)
export async function isDomainOnboarded(domain: string, owner?: string): Promise<boolean> {
    try {
        const response = await getDomainPolicy(domain, owner);
        // If domain has ownerWallet set in policy, it's been onboarded
        return !response.policy.feeMode;
    } catch {
        return false;
    }
}
