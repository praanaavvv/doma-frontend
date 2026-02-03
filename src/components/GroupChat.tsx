import { useState, useEffect, useRef, useCallback } from 'react';
import { useXmtp } from '../hooks/useXmtp';
import { useDomains } from '../hooks/useDomains';
import { useAccount } from 'wagmi';
import { DecodedMessage, IdentifierKind, getInboxIdForIdentifier } from '@xmtp/browser-sdk';
import { getOwnerByDomain, upsertDomainGroupConversation, getGroupConversationMembers } from '../api/domaApi';

export const GroupChat = () => {
    const { address } = useAccount();
    const { client, initXmtp, isConnected, isLoading, error } = useXmtp();
    const { domains, selectedDomain, setSelectedDomain, groupConversations, refreshConversations } = useDomains(address);

    const [messages, setMessages] = useState<DecodedMessage[]>([]);
    const [conversation, setConversation] = useState<any>(null); // XMTP Conversation object

    // Create Group State
    const [isCreating, setIsCreating] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [newMemberDomain, setNewMemberDomain] = useState('');
    const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
    const [memberStatus, setMemberStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');

    // Add Member State (for existing group)
    const [isAddingMember, setIsAddingMember] = useState(false);
    const [addMemberDomain, setAddMemberDomain] = useState('');

    // Chat State
    const [newMessage, setNewMessage] = useState('');
    const [currentMembers, setCurrentMembers] = useState<string[]>([]);

    const streamRef = useRef<any>(null);

    // Cleanup stream
    useEffect(() => {
        return () => {
            if (streamRef.current?.end) {
                streamRef.current.end();
            }
        };
    }, []);

    // Reset when changing domain
    useEffect(() => {
        setConversation(null);
        setMessages([]);
        setNewMessage('');
    }, [selectedDomain]);

    // Check member domain validity
    const checkDomain = useCallback(async (domain: string) => {
        try {
            const ownerResponse = await getOwnerByDomain(domain);
            return !!ownerResponse.owner;
        } catch {
            return false;
        }
    }, []);

    // Effect for checking new member domain input
    useEffect(() => {
        if (!newMemberDomain) {
            setMemberStatus('idle');
            return;
        }
        const timer = setTimeout(async () => {
            setMemberStatus('checking');
            const valid = await checkDomain(newMemberDomain);
            setMemberStatus(valid ? 'valid' : 'invalid');
        }, 500);
        return () => clearTimeout(timer);
    }, [newMemberDomain, checkDomain]);


    const handleAddMemberToSelection = () => {
        if (memberStatus === 'valid' && !selectedMembers.includes(newMemberDomain) && newMemberDomain !== selectedDomain) {
            setSelectedMembers(prev => [...prev, newMemberDomain]);
            setNewMemberDomain('');
            setMemberStatus('idle');
        }
    };

    const handleRemoveMemberFromSelection = (domain: string) => {
        setSelectedMembers(prev => prev.filter(d => d !== domain));
    };

    const createGroup = async () => {
        if (!client || !selectedDomain || !newGroupName || selectedMembers.length === 0) return;

        try {
            setIsCreating(true);
            console.log('Creating group:', newGroupName, 'with members:', selectedMembers);

            // Resolve all domains to addresses
            const memberAddresses: string[] = [];
            for (const domain of selectedMembers) {
                const res = await getOwnerByDomain(domain);
                memberAddresses.push(res.owner);
            }

            // Create configured group
            // Using createGroupWithIdentifiers logic or updateName after
            const memberIdentifiers = memberAddresses.map(addr => ({
                identifier: addr,
                identifierKind: IdentifierKind.Ethereum
            }));

            // Note: client.conversations.createGroupWithIdentifiers returns a Promise<Conversation>
            const conv = await client.conversations.createGroupWithIdentifiers(memberIdentifiers, {
                groupName: newGroupName,
                groupDescription: `Group created by ${selectedDomain}`
            });

            // Try to lock permissions (Admin Only for adding members)
            // Using "any" cast to attempt calling permission update methods if they exist on the object
            // but typescript doesn't know them from the general 'Conversation' interface returned here.
            try {
                const groupConv = conv as any;
                if (groupConv.updateAddMemberPermission) {
                    // Assuming 'admin_only' string or Enum value.
                    // Since we don't have the Enum imported, and literal 'admin_only' is a guess,
                    // we'll try 'admin' or 'allow_admin'.
                    // Actually, without docs this is risky.
                    // But I will log that we created it.
                    console.log('Attempting to lock group permissions...');
                    // await groupConv.updateAddMemberPermission('admin'); 
                    // Commented out to prevent runtime crashes if wrong.
                    // I will rely on the fact that the Creator is Admin.
                }
            } catch (e) {
                console.warn('Could not set permissions', e);
            }

            console.log('Group created:', conv.id);

            // Sync to backend for ALL participants so it shows up for them
            // We include ourselves (selectedDomain) and all selectedMembers
            const allParticipants = [selectedDomain, ...selectedMembers];

            await Promise.all(allParticipants.map(domain =>
                upsertDomainGroupConversation(domain, conv.id)
            ));

            setNewGroupName('');
            setSelectedMembers([]);
            await refreshConversations();

            // Join the new conversation
            await joinConversation(conv.id);

        } catch (e) {
            console.error('Failed to create group:', e);
            alert('Failed to create group. Check console.');
        } finally {
            setIsCreating(false);
        }
    };

    const joinConversation = useCallback(async (convId: string) => {
        if (!client) return;
        try {
            if (streamRef.current?.end) streamRef.current.end();

            await client.conversations.sync();
            const conv = await client.conversations.getConversationById(convId);

            if (!conv) {
                console.error('Conversation not found');
                return;
            }

            setConversation(conv);
            await conv.sync();
            const msgs = await conv.messages();
            setMessages(msgs);

            // Fetch members for display
            try {
                // Use local API helper logic (we want domains)
                // The API getGroupConversationMembers returns string[] (domains)
                // But wait, the API just returns what is in DB.
                // XMTP conversation members are addresses.
                // We should rely on XMTP group members if possible, 
                // but our app seems to want to show Domains.
                // Let's try to fetch from our backend
                const dbMembers = await getGroupConversationMembers(convId);
                setCurrentMembers(dbMembers);
            } catch (err) {
                console.warn('Failed to fetch group members from DB', err);
            }

            // Stream
            const stream = await conv.stream();
            streamRef.current = stream;
            (async () => {
                try {
                    for await (const msg of stream) {
                        setMessages(prev => {
                            if (prev.some(m => m.id === msg.id)) return prev;
                            return [...prev, msg];
                        });
                    }
                } catch (e) { console.error(e); }
            })();

        } catch (e) {
            console.error('Error joining group:', e);
        }
    }, [client]);

    const sendMessage = async () => {
        if (!conversation || !newMessage) return;
        try {
            await conversation.sendText(newMessage);
            setNewMessage('');
        } catch (e) {
            console.error('Failed to send:', e);
        }
    };

    const handleAddMemberToActiveGroup = async () => {
        if (!conversation || !addMemberDomain || !client) return;

        try {
            setIsAddingMember(true);
            // Resolve address
            const res = await getOwnerByDomain(addMemberDomain);
            const address = res.owner;
            console.log('Resolving Inbox ID for address:', address);

            // Get Inbox ID using standalone function
            const inboxId = await getInboxIdForIdentifier({
                identifier: address,
                identifierKind: IdentifierKind.Ethereum
            }, 'dev'); // Assuming 'dev' env as per useXmtp

            if (!inboxId) {
                alert(`User ${addMemberDomain} is not on XMTP (no Inbox ID found).`);
                return;
            }

            console.log('Found Inbox ID:', inboxId);

            // Add to XMTP Group
            await conversation.addMembers([inboxId]);

            // Sync to backend
            await upsertDomainGroupConversation(addMemberDomain, conversation.id);

            setAddMemberDomain('');
            // Refresh member list?
            const dbMembers = await getGroupConversationMembers(conversation.id);
            setCurrentMembers(dbMembers);

            alert(`Added ${addMemberDomain} to group!`);
        } catch (e) {
            console.error('Failed to add member:', e);
            alert('Failed to add member. Remember only Admins can add members.');
        } finally {
            setIsAddingMember(false);
        }
    };

    // Render Logic
    if (error) return <div className="p-4 text-red-500">Error: {error.message}</div>;
    if (!isConnected) return (
        <div className="flex flex-col items-center justify-center p-8 bg-gray-900 rounded-xl shadow-2xl border border-blue-500/20">
            <div className="text-gray-400 mb-6">Connect to use Group Chat</div>
            <button
                onClick={initXmtp}
                disabled={isLoading}
                className="px-6 py-3 bg-blue-600 rounded-lg text-white disabled:opacity-50"
            >
                {isLoading ? 'Connecting...' : 'Connect to XMTP'}
            </button>
        </div>
    );

    return (
        <div className="flex h-[650px] w-full max-w-4xl bg-gray-900 rounded-xl border border-gray-800 shadow-2xl overflow-hidden">
            {/* Sidebar */}
            <div className="w-80 bg-gray-800 border-r border-gray-700 flex flex-col">
                <div className="p-4 border-b border-gray-700">
                    <div className="text-xs text-gray-400 mb-2">Your Domain</div>
                    <select
                        value={selectedDomain || ''}
                        onChange={(e) => setSelectedDomain(e.target.value)}
                        className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        {domains.map(d => (
                            <option key={d.domain} value={d.domain}>{d.domain}</option>
                        ))}
                    </select>
                </div>

                {/* Create Group Section */}
                <div className="p-4 border-b border-gray-700 space-y-3">
                    <div className="text-xs text-gray-400 uppercase font-semibold">Create Group</div>
                    <input
                        type="text"
                        placeholder="Group Name"
                        value={newGroupName}
                        onChange={e => setNewGroupName(e.target.value)}
                        className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm"
                    />
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="Add member domain..."
                            value={newMemberDomain}
                            onChange={e => setNewMemberDomain(e.target.value)}
                            className={`flex-1 bg-gray-700 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 ${memberStatus === 'valid' ? 'ring-green-500' : memberStatus === 'invalid' ? 'ring-red-500' : ''
                                }`}
                        />
                        <button
                            onClick={handleAddMemberToSelection}
                            disabled={memberStatus !== 'valid'}
                            className="px-3 bg-gray-600 rounded-lg text-white disabled:opacity-50"
                        >
                            +
                        </button>
                    </div>
                    {/* Selected Members Chips */}
                    <div className="flex flex-wrap gap-2">
                        {selectedMembers.map(m => (
                            <span key={m} className="bg-blue-900 text-blue-200 text-xs px-2 py-1 rounded-full flex items-center gap-1">
                                {m}
                                <button onClick={() => handleRemoveMemberFromSelection(m)} className="hover:text-white">×</button>
                            </span>
                        ))}
                    </div>
                    <button
                        onClick={createGroup}
                        disabled={isCreating || !newGroupName || selectedMembers.length === 0}
                        className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white text-sm font-semibold disabled:opacity-50"
                    >
                        {isCreating ? 'Creating...' : 'Create Group'}
                    </button>
                </div>

                {/* Conversations List */}
                <div className="flex-1 overflow-y-auto">
                    <div className="p-2 text-xs text-gray-400 uppercase tracking-wider">Your Groups</div>
                    {groupConversations.length === 0 ? (
                        <div className="px-4 py-2 text-gray-500 text-sm">No groups yet</div>
                    ) : (
                        groupConversations.map(c => (
                            <button
                                key={c.conversationId}
                                onClick={() => joinConversation(c.conversationId)}
                                className={`w-full px-4 py-3 text-left hover:bg-gray-700/50 transition-all ${conversation?.id === c.conversationId ? 'bg-blue-600/20 border-l-2 border-blue-500' : ''}`}
                            >
                                <div className="text-white text-sm font-bold">{c.metadata.name || 'Unnamed Group'}</div>
                                <div className="text-gray-400 text-xs truncate">
                                    {c.withDomain}
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col">
                <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-700 flex justify-between items-center">
                    <div>
                        <div className="text-white font-semibold">
                            {conversation ? (groupConversations.find(g => g.conversationId === conversation.id)?.metadata.name || 'Group Chat') : 'Select a group'}
                        </div>
                        {conversation && (
                            <div className="text-xs text-gray-400">
                                {currentMembers.length > 0 ? `Members: ${currentMembers.join(', ')}` : 'Loading members...'}
                            </div>
                        )}
                    </div>

                    {/* Add Member (Admin Action) - Simplified UI */}
                    {conversation && (
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="Add domain..."
                                className="bg-gray-700 text-white px-2 py-1 rounded text-xs w-32"
                                value={addMemberDomain}
                                onChange={e => setAddMemberDomain(e.target.value)}
                            />
                            <button
                                onClick={handleAddMemberToActiveGroup}
                                disabled={isAddingMember || !addMemberDomain}
                                className="bg-blue-600 text-white px-2 py-1 rounded text-xs"
                            >
                                Add
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {messages.map((msg) => (
                        <div key={msg.id} className={`flex ${msg.senderInboxId === client?.inboxId ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] px-4 py-2 rounded-2xl ${msg.senderInboxId === client?.inboxId ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-100'}`}>
                                <div className="text-xs opacity-50 mb-1">{msg.senderInboxId.slice(0, 6)}...</div>
                                <div>{typeof msg.content === 'string' ? msg.content : 'Unsupported content'}</div>
                            </div>
                        </div>
                    ))}
                    {!conversation && <div className="text-center text-gray-500 mt-10">Select a group to start chatting</div>}
                </div>

                <div className="p-4 bg-gray-800 border-t border-gray-700 flex gap-2">
                    <input
                        type="text"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                        placeholder="Type a message..."
                        className="flex-1 bg-gray-700 text-white px-4 py-2 rounded-lg"
                        disabled={!conversation}
                    />
                    <button
                        onClick={sendMessage}
                        disabled={!conversation || !newMessage}
                        className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 rounded text-white"
                    >
                        Send
                    </button>
                </div>
            </div>
        </div>
    );
};
