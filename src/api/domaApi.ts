const API_BASE = 'https://xmtp-messaging-domain.onrender.com';

// Types
export interface DomainInfo {
    domain: string;
    tokenized: boolean;
    verificationStatus: string;
    verificationMethod: string;
    messagingEnabled: boolean;
    pricingTier: string;
    feeWei: string;
    feeEther: string;
}

export interface DomainsResponse {
    owner: string;
    domains: DomainInfo[];
    verificationRecords: any[];
    doma: {
        source: string;
        domains: string[];
    };
    ttl: number;
}

export interface Conversation {
    conversationId: string;
    withDomain: string;
    createdAt: string;
}

export interface ConversationsResponse {
    domain: string;
    conversations: Conversation[];
}

export interface GroupConversation {
    conversationId: string;
    withDomain: string;
    createdAt: string;
    metadata: {
        admin: string | null;
        name: string | null;
    };
}

export interface OwnerResponse {
    owner: string;
}

export interface SyncConversationPayload {
    id: string;
    senderDomain: string;
    recipientDomain: string;
}

// API Functions
export async function getDomainsForOwner(owner: string): Promise<DomainsResponse> {
    const res = await fetch(`${API_BASE}?owner=${owner}`);
    if (!res.ok) throw new Error('Failed to fetch domains');
    return res.json();
}

export async function getOwnerByDomain(domain: string): Promise<OwnerResponse> {
    const res = await fetch(`${API_BASE}/owner?domain=${encodeURIComponent(domain)}`);
    if (!res.ok) throw new Error('Failed to fetch owner');
    return res.json();
}

export async function getConversationsForDomain(domain: string): Promise<ConversationsResponse> {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(domain)}/conversations`);
    if (!res.ok) throw new Error('Failed to fetch conversations');
    return res.json();
}

export async function syncConversation(payload: SyncConversationPayload): Promise<{ id: string; status: string }> {
    const res = await fetch(`${API_BASE}/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Failed to sync conversation');
    return res.json();
}

export async function upsertDomainGroupConversation(domain: string, conversationId: string, groupName?: string): Promise<void> {
    const res = await fetch(`${API_BASE}/group-conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, conversationId, groupName }),
    });
    if (!res.ok) throw new Error('Failed to upsert group conversation');
}

export async function getGroupConversations(domain: string): Promise<GroupConversation[]> {
    const res = await fetch(`${API_BASE}/group-conversations?domain=${encodeURIComponent(domain)}`);
    if (!res.ok) throw new Error('Failed to fetch group conversations');
    return res.json();
}

export async function getGroupConversationMembers(conversationId: string): Promise<string[]> {
    const res = await fetch(`${API_BASE}/group-conversations/members?conversationId=${encodeURIComponent(conversationId)}`);
    if (!res.ok) throw new Error('Failed to fetch group members');
    return res.json();
}
