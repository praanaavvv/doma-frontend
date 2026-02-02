import { useState, useEffect, useRef, useCallback } from 'react';
import { useXmtp } from '../hooks/useXmtp';
import { useDomains } from '../hooks/useDomains';
import { useAccount } from 'wagmi';
import { DecodedMessage, IdentifierKind } from '@xmtp/browser-sdk';
import { getOwnerByDomain, syncConversation, getGroupConversations, getGroupConversationMembers, upsertDomainGroupConversation, type GroupConversation, type GroupMember } from '../api/domaApi';
import { isDomainOnboarded, onboardDomain } from '../api/messagingApi';

type TabType = 'contacts' | 'groups';

export const Chat = () => {
    const { address } = useAccount();
    const { client, initXmtp, isConnected, isLoading, error, revokeExcessInstallations } = useXmtp();
    const { domains, selectedDomain, setSelectedDomain, conversations, refreshConversations } = useDomains(address);

    const [messages, setMessages] = useState<DecodedMessage[]>([]);
    const [recipientDomain, setRecipientDomain] = useState('');
    const [newMessage, setNewMessage] = useState('');
    const [conversation, setConversation] = useState<any>(null);
    const [isStartingChat, setIsStartingChat] = useState(false);
    const [recipientStatus, setRecipientStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
    const [onboardingStatus, setOnboardingStatus] = useState<{
        isOnboarding: boolean;
        currentDomain: string | null;
        completedDomains: string[];
        failedDomains: string[];
    }>({ isOnboarding: false, currentDomain: null, completedDomains: [], failedDomains: [] });
    const streamRef = useRef<any>(null);

    // Tab state
    const [activeTab, setActiveTab] = useState<TabType>('contacts');

    // Group state
    const [groupConversations, setGroupConversations] = useState<GroupConversation[]>([]);
    const [selectedGroupMembers, setSelectedGroupMembers] = useState<GroupMember[]>([]);
    const [isCreatingGroup, setIsCreatingGroup] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [addMemberDomain, setAddMemberDomain] = useState('');
    const [isAddingMember, setIsAddingMember] = useState(false);
    const [showAddMemberModal, setShowAddMemberModal] = useState(false);
    const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null); // Track group ID independently of XMTP
    const [inboxToDomain, setInboxToDomain] = useState<Map<string, string>>(new Map()); // Map inboxId/wallet to domain

    // Fetch group conversations when domain changes
    useEffect(() => {
        if (!selectedDomain || !isConnected) return;

        const fetchGroups = async () => {
            try {
                const response = await getGroupConversations(selectedDomain);
                setGroupConversations(response || []);
            } catch (e) {
                console.error('Failed to fetch group conversations:', e);
                setGroupConversations([]);
            }
        };

        fetchGroups();
    }, [selectedDomain, isConnected]);

    // Fetch group members when a group is selected (uses backend, not XMTP)
    useEffect(() => {
        if (!selectedGroupId || activeTab !== 'groups') return;

        const fetchMembers = async () => {
            try {
                const response = await getGroupConversationMembers(selectedGroupId);
                const members = response.members || [];
                setSelectedGroupMembers(members);

                // Build inboxId/wallet -> domain mapping for group members
                const newMapping = new Map<string, string>();
                for (const member of members) {
                    try {
                        const ownerRes = await getOwnerByDomain(member.domain);
                        const wallet = ownerRes.owner.toLowerCase();
                        newMapping.set(wallet, member.domain);
                        // Also try setting with various formats
                        newMapping.set(ownerRes.owner, member.domain);
                    } catch (e) {
                        console.warn(`Failed to get owner for ${member.domain}:`, e);
                    }
                }
                setInboxToDomain(newMapping);
            } catch (e) {
                console.error('Failed to fetch group members:', e);
                setSelectedGroupMembers([]);
            }
        };

        fetchMembers();
    }, [selectedGroupId, activeTab]);

    // Auto-onboard domains after XMTP connects
    useEffect(() => {
        if (!isConnected || !address || domains.length === 0) return;

        const onboardDomains = async () => {
            setOnboardingStatus(prev => ({ ...prev, isOnboarding: true }));

            for (const domainInfo of domains) {
                const domain = domainInfo.domain;
                setOnboardingStatus(prev => ({ ...prev, currentDomain: domain }));

                try {
                    const isOnboarded = await isDomainOnboarded(domain, address);

                    if (!isOnboarded) {
                        await onboardDomain(domain, address, {
                            messagingEnabled: true,
                            policy: { consentMode: 'auto_accept', feeMode: 'none' },
                        });
                        setOnboardingStatus(prev => ({
                            ...prev,
                            completedDomains: [...prev.completedDomains, domain],
                        }));
                    } else {
                        setOnboardingStatus(prev => ({
                            ...prev,
                            completedDomains: [...prev.completedDomains, domain],
                        }));
                    }
                } catch (err) {
                    console.error(`Failed to onboard domain ${domain}:`, err);
                    setOnboardingStatus(prev => ({
                        ...prev,
                        failedDomains: [...prev.failedDomains, domain],
                    }));
                }
            }

            setOnboardingStatus(prev => ({ ...prev, isOnboarding: false, currentDomain: null }));
        };

        onboardDomains();
    }, [isConnected, address, domains]);

    // Cleanup stream on unmount
    useEffect(() => {
        return () => {
            if (streamRef.current?.end) {
                streamRef.current.end();
            }
        };
    }, []);

    // Reset chat state when switching domains
    useEffect(() => {
        if (streamRef.current?.end) {
            streamRef.current.end();
        }
        setConversation(null);
        setMessages([]);
        setNewMessage('');
    }, [selectedDomain]);

    const joinConversation = useCallback(async (convId: string, isGroup: boolean = false) => {
        if (!client || !convId) return;

        // Always set the group ID for backend member lookup (works even if XMTP fails)
        if (isGroup) {
            setSelectedGroupId(convId);
        }

        try {
            if (streamRef.current?.end) {
                streamRef.current.end();
            }

            // Sync may fail due to XMTP inbox issues, but we can still try to get the conversation
            try {
                await client.conversations.sync();
            } catch (syncErr) {
                console.warn('Conversations sync failed, continuing anyway:', syncErr);
            }

            const conv = await client.conversations.getConversationById(convId);
            if (!conv) {
                console.warn('XMTP conversation not found - showing group info from backend only');
                setConversation(null);
                setMessages([]);
                // Group info will still show from backend via selectedGroupId
                return;
            }

            setConversation(conv);

            // Conversation sync may also fail, but we can still try to get messages
            try {
                await conv.sync();
            } catch (convSyncErr) {
                console.warn('Conversation sync failed, continuing anyway:', convSyncErr);
            }

            const msgs = await conv.messages();
            setMessages(msgs);

            const stream = await conv.stream();
            streamRef.current = stream;

            (async () => {
                try {
                    for await (const msg of stream) {
                        setMessages((prev) => {
                            if (prev.some(m => m.id === msg.id)) return prev;
                            return [...prev, msg];
                        });
                    }
                } catch (e) {
                    console.error('Stream error:', e);
                }
            })();
        } catch (e) {
            console.error('Error joining conversation:', e);
            // Still show group info from backend
            if (isGroup) {
                setConversation(null);
                setMessages([]);
            }
        }
    }, [client]);

    const startNewChat = useCallback(async () => {
        if (!client || !selectedDomain || !recipientDomain) return;

        try {
            setIsStartingChat(true);

            const ownerResponse = await getOwnerByDomain(recipientDomain);
            const recipientAddress = ownerResponse.owner;

            const identifier = { identifier: recipientAddress, identifierKind: IdentifierKind.Ethereum };
            const canMessageMap = await client.canMessage([identifier]);
            const canMessage = canMessageMap.get(identifier.identifier.toLowerCase()) || canMessageMap.get(identifier.identifier);

            if (!canMessage) {
                alert(`${recipientDomain} is not registered on XMTP yet.`);
                return;
            }

            await client.conversations.sync();

            const domainPair = [selectedDomain, recipientDomain].sort().join(':');
            const groupName = `doma:${domainPair}`;

            const allConversations = await client.conversations.list();
            let conv = allConversations.find(c => 'name' in c && c.name === groupName);

            if (!conv) {
                conv = await client.conversations.createGroupWithIdentifiers([identifier], {
                    groupName: groupName,
                    groupDescription: `Chat between ${selectedDomain} and ${recipientDomain}`,
                });
            }

            await syncConversation({
                id: conv.id,
                senderDomain: selectedDomain,
                recipientDomain: recipientDomain,
            });

            await refreshConversations();
            await joinConversation(conv.id);
            setRecipientDomain('');
        } catch (e) {
            console.error('Error starting chat:', e);
            alert('Failed to start chat. Check console for details.');
        } finally {
            setIsStartingChat(false);
        }
    }, [client, selectedDomain, recipientDomain, joinConversation, refreshConversations]);

    const createGroup = useCallback(async () => {
        if (!client || !selectedDomain || !newGroupName) return;

        try {
            setIsCreatingGroup(true);

            // Use the group name as the display name
            const groupName = newGroupName;

            // Create OPTIMISTIC group - stays local until members are added
            // This avoids the InboxValidationFailed sync issues
            console.log('Creating optimistic XMTP group...');
            const conv = await client.conversations.createGroupOptimistic({
                groupName: groupName,
                groupDescription: `Group: ${newGroupName}`,
            });
            console.log('Created optimistic XMTP group with ID:', conv.id);

            // Register creator's domain in backend with the conversation ID
            console.log('Registering with backend...');
            try {
                await upsertDomainGroupConversation(selectedDomain, conv.id);
                console.log('Backend registration complete');
            } catch (backendErr) {
                console.error('Backend registration failed:', backendErr);
            }

            // Refresh group list
            console.log('Refreshing group list...');
            try {
                const response = await getGroupConversations(selectedDomain);
                setGroupConversations(response || []);
            } catch (fetchErr) {
                console.error('Failed to refresh groups:', fetchErr);
            }

            setNewGroupName('');

            // Set this as the current conversation (no sync needed for optimistic group)
            setConversation(conv);
            setSelectedGroupId(conv.id);
            setMessages([]);
            console.log('Group creation complete! Add members to sync to network.');
        } catch (e) {
            console.error('Error creating group:', e);
            alert('Failed to create group. Check console for details.');
        } finally {
            setIsCreatingGroup(false);
        }
    }, [client, selectedDomain, newGroupName]);

    const addMemberToGroup = useCallback(async () => {
        if (!client || !selectedGroupId || !addMemberDomain) return;

        try {
            setIsAddingMember(true);

            // Get wallet address for the domain
            const ownerResponse = await getOwnerByDomain(addMemberDomain);
            const memberAddress = ownerResponse.owner;

            // Check if they're on XMTP
            const identifier = { identifier: memberAddress, identifierKind: IdentifierKind.Ethereum };
            const canMessageMap = await client.canMessage([identifier]);
            const canMessage = canMessageMap.get(identifier.identifier.toLowerCase()) || canMessageMap.get(identifier.identifier);

            if (!canMessage) {
                alert(`${addMemberDomain} is not registered on XMTP yet.`);
                return;
            }

            // Try to add to XMTP group (may fail due to InboxValidationFailed)
            let xmtpSuccess = false;
            if (conversation) {
                try {
                    await conversation.addMembersByIdentifiers([identifier]);
                    xmtpSuccess = true;
                    console.log('XMTP member added successfully');
                } catch (xmtpErr) {
                    console.warn('XMTP addMember failed (InboxValidationFailed), continuing with backend registration:', xmtpErr);
                    // Continue anyway - we'll still register in backend
                }
            } else {
                console.log('No XMTP conversation - registering in backend only');
            }

            // ALWAYS register in backend (this is what matters for your group management)
            await upsertDomainGroupConversation(addMemberDomain, selectedGroupId);
            console.log('Backend registration complete for:', addMemberDomain);

            // Refresh members from backend
            try {
                const response = await getGroupConversationMembers(selectedGroupId);
                setSelectedGroupMembers(response.members || []);
            } catch (fetchErr) {
                console.warn('Failed to refresh members list:', fetchErr);
            }

            setAddMemberDomain('');
            setShowAddMemberModal(false);

            if (!xmtpSuccess) {
                alert(`Member ${addMemberDomain} added to group database. Note: XMTP sync had issues - they may need to refresh to see messages.`);
            }
        } catch (e) {
            console.error('Error adding member:', e);
            alert('Failed to add member. Check console for details.');
        } finally {
            setIsAddingMember(false);
        }
    }, [client, conversation, selectedGroupId, addMemberDomain]);

    // Check recipient domain status
    useEffect(() => {
        if (!recipientDomain) {
            setRecipientStatus('idle');
            return;
        }

        const checkDomain = async () => {
            setRecipientStatus('checking');
            try {
                const ownerResponse = await getOwnerByDomain(recipientDomain);
                if (ownerResponse.owner) {
                    setRecipientStatus('valid');
                } else {
                    setRecipientStatus('invalid');
                }
            } catch {
                setRecipientStatus('invalid');
            }
        };

        const timeout = setTimeout(checkDomain, 500);
        return () => clearTimeout(timeout);
    }, [recipientDomain]);

    const sendMessage = async () => {
        if (!conversation || !newMessage) return;
        try {
            await conversation.sendText(newMessage);
            setNewMessage('');
        } catch (e) {
            console.error('Error sending message:', e);
        }
    };

    if (error) {
        return <div className="p-4 text-red-500">Error: {error.message}</div>;
    }
    if (!isConnected) {
        return (
            <div className="flex flex-col items-center justify-center p-8 bg-gray-900 rounded-xl shadow-2xl border border-blue-500/20">
                <h2 className="text-2xl mb-6 font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">Doma Chat</h2>
                <div className="text-gray-400 mb-6 text-center max-w-md">
                    Connect your wallet to start chatting with your domains.
                </div>
                <button
                    onClick={initXmtp}
                    disabled={isLoading}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 rounded-lg text-white font-semibold transition-all shadow-lg hover:shadow-blue-500/30"
                >
                    {isLoading ? 'Connecting...' : 'Connect to XMTP'}
                </button>
            </div>
        );
    }

    return (
        <div className="flex h-[650px] w-full max-w-4xl bg-gray-900 rounded-xl border border-gray-800 shadow-2xl overflow-hidden">
            {/* Sidebar */}
            <div className="w-72 bg-gray-800 border-r border-gray-700 flex flex-col">
                {/* Domain Selector */}
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

                {/* Onboarding Status */}
                {onboardingStatus.isOnboarding && (
                    <div className="p-3 bg-blue-900/30 border-b border-gray-700">
                        <div className="flex items-center gap-2 text-sm text-blue-300">
                            <div className="animate-spin h-4 w-4 border-2 border-blue-400 border-t-transparent rounded-full"></div>
                            <span>Setting up {onboardingStatus.currentDomain}...</span>
                        </div>
                    </div>
                )}
                {!onboardingStatus.isOnboarding && onboardingStatus.failedDomains.length > 0 && (
                    <div className="p-3 bg-red-900/30 border-b border-gray-700">
                        <div className="text-xs text-red-300">
                            Failed to setup: {onboardingStatus.failedDomains.join(', ')}
                        </div>
                    </div>
                )}

                {/* Revoke Installations Button - shows if there are XMTP issues */}
                <div className="p-2 border-b border-gray-700">
                    <button
                        onClick={revokeExcessInstallations}
                        disabled={isLoading}
                        className="w-full px-3 py-2 bg-orange-600/30 hover:bg-orange-600/50 text-orange-300 text-xs rounded transition-all disabled:opacity-50"
                        title="Click if you see InboxValidationFailed errors"
                    >
                        🔧 Fix XMTP Issues
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-700">
                    <button
                        onClick={() => setActiveTab('contacts')}
                        className={`flex-1 py-3 text-sm font-medium transition-all ${activeTab === 'contacts'
                            ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-700/30'
                            : 'text-gray-400 hover:text-gray-200'
                            }`}
                    >
                        Contacts
                    </button>
                    <button
                        onClick={() => setActiveTab('groups')}
                        className={`flex-1 py-3 text-sm font-medium transition-all ${activeTab === 'groups'
                            ? 'text-emerald-400 border-b-2 border-emerald-400 bg-gray-700/30'
                            : 'text-gray-400 hover:text-gray-200'
                            }`}
                    >
                        Groups
                    </button>
                </div>

                {/* Tab Content */}
                {activeTab === 'contacts' ? (
                    <>
                        {/* New Chat */}
                        <div className="p-4 border-b border-gray-700 space-y-2">
                            <div className="text-xs text-gray-400">Chat with Domain</div>
                            <input
                                type="text"
                                placeholder="Enter domain..."
                                value={recipientDomain}
                                onChange={(e) => setRecipientDomain(e.target.value)}
                                className={`w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 ${recipientStatus === 'valid' ? 'focus:ring-green-500 ring-1 ring-green-500/50' :
                                    recipientStatus === 'invalid' ? 'focus:ring-red-500 ring-1 ring-red-500/50' :
                                        'focus:ring-blue-500'
                                    }`}
                            />
                            <button
                                onClick={startNewChat}
                                disabled={!recipientDomain || isStartingChat || recipientStatus !== 'valid'}
                                className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 rounded-lg text-white text-sm font-semibold"
                            >
                                {isStartingChat ? 'Starting...' : 'Start Chat'}
                            </button>
                        </div>

                        {/* Contacts List */}
                        <div className="flex-1 overflow-y-auto">
                            <div className="p-2 text-xs text-gray-400 uppercase tracking-wider">Conversations</div>
                            {conversations.length === 0 ? (
                                <div className="px-4 py-2 text-gray-500 text-sm">No conversations yet</div>
                            ) : (
                                conversations.map(c => (
                                    <button
                                        key={c.conversationId}
                                        onClick={() => joinConversation(c.conversationId)}
                                        className={`w-full px-4 py-3 text-left hover:bg-gray-700/50 transition-all ${conversation?.id === c.conversationId ? 'bg-blue-600/20 border-l-2 border-blue-500' : ''
                                            }`}
                                    >
                                        <div className="text-white text-sm font-medium">{c.withDomain}</div>
                                        <div className="text-gray-400 text-xs">{new Date(c.createdAt).toLocaleDateString()}</div>
                                    </button>
                                ))
                            )}
                        </div>
                    </>
                ) : (
                    <>
                        {/* Create Group */}
                        <div className="p-4 border-b border-gray-700 space-y-2">
                            <div className="text-xs text-gray-400">Create New Group</div>
                            <input
                                type="text"
                                placeholder="Group name..."
                                value={newGroupName}
                                onChange={(e) => setNewGroupName(e.target.value)}
                                className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                            <button
                                onClick={createGroup}
                                disabled={!newGroupName || isCreatingGroup}
                                className="w-full px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-600 rounded-lg text-white text-sm font-semibold"
                            >
                                {isCreatingGroup ? 'Creating...' : 'Create Group'}
                            </button>
                        </div>

                        {/* Groups List */}
                        <div className="flex-1 overflow-y-auto">
                            <div className="p-2 text-xs text-gray-400 uppercase tracking-wider">Groups</div>
                            {groupConversations.length === 0 ? (
                                <div className="px-4 py-2 text-gray-500 text-sm">No groups yet</div>
                            ) : (
                                groupConversations.map(g => (
                                    <button
                                        key={g.conversationId}
                                        onClick={() => joinConversation(g.conversationId, true)}
                                        className={`w-full px-4 py-3 text-left hover:bg-gray-700/50 transition-all ${selectedGroupId === g.conversationId ? 'bg-emerald-600/20 border-l-2 border-emerald-500' : ''
                                            }`}
                                    >
                                        <div className="text-white text-sm font-medium">{g.name || g.conversationId}</div>
                                        <div className="text-gray-400 text-xs">{new Date(g.createdAt).toLocaleDateString()}</div>
                                    </button>
                                ))
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Chat Area */}
            <div className="flex-1 flex flex-col">
                {/* Chat Header */}
                <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-700 flex justify-between items-center">
                    <div className="text-white font-semibold">
                        {activeTab === 'groups' && selectedGroupId ? (
                            groupConversations.find(g => g.conversationId === selectedGroupId)?.name || 'Group Chat'
                        ) : conversation ? (
                            conversations.find(c => c.conversationId === conversation.id)?.withDomain || 'Chat'
                        ) : 'Select a conversation'}
                    </div>
                    {selectedGroupId && activeTab === 'groups' && (
                        <button
                            onClick={() => setShowAddMemberModal(true)}
                            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-white text-sm"
                        >
                            + Add Member
                        </button>
                    )}
                </div>

                {/* Group Members (shown for groups - from backend, not XMTP) */}
                {selectedGroupId && activeTab === 'groups' && selectedGroupMembers.length > 0 && (
                    <div className="px-4 py-2 bg-gray-800/30 border-b border-gray-700 flex gap-2 flex-wrap">
                        <span className="text-xs text-gray-400">Members:</span>
                        {selectedGroupMembers.map(m => (
                            <span key={m.domain} className="text-xs bg-gray-700 text-gray-200 px-2 py-1 rounded">
                                {m.domain}
                            </span>
                        ))}
                    </div>
                )}

                {/* XMTP sync status warning */}
                {selectedGroupId && activeTab === 'groups' && !conversation && (
                    <div className="px-4 py-2 bg-yellow-900/30 border-b border-gray-700">
                        <div className="text-xs text-yellow-300">
                            ⚠️ XMTP sync pending - Group info shown from database. Messages may not appear yet.
                        </div>
                    </div>
                )}

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {messages.map((msg) => {
                        const isOwnMessage = msg.senderInboxId === client?.inboxId;
                        // Try to find sender domain from our mapping (try various formats)
                        const senderDomain = inboxToDomain.get(msg.senderInboxId)
                            || inboxToDomain.get(msg.senderInboxId?.toLowerCase())
                            || null;

                        return (
                            <div key={msg.id} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[80%] ${isOwnMessage ? '' : 'flex flex-col'}`}>
                                    {/* Show sender domain for group messages (not own messages) */}
                                    {!isOwnMessage && activeTab === 'groups' && (
                                        <div className="text-xs text-emerald-400 mb-1 ml-1">
                                            {senderDomain || msg.senderInboxId?.slice(0, 8) + '...'}
                                        </div>
                                    )}
                                    <div className={`px-4 py-2 rounded-2xl ${isOwnMessage
                                        ? 'bg-blue-600 text-white rounded-br-none'
                                        : 'bg-gray-700 text-gray-100 rounded-bl-none'
                                        }`}>
                                        <div>{typeof msg.content === 'string' ? msg.content : 'Unsupported content'}</div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {messages.length === 0 && conversation && (
                        <div className="text-center text-gray-500 mt-10">Start chatting...</div>
                    )}
                    {!conversation && (
                        <div className="text-center text-gray-500 mt-10">Select or start a conversation</div>
                    )}
                </div>

                {/* Message Input */}
                <div className="p-4 bg-gray-800 border-t border-gray-700 flex gap-2">
                    <input
                        type="text"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                        placeholder="Type a message..."
                        className="flex-1 bg-gray-700 text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={!conversation}
                    />
                    <button
                        onClick={sendMessage}
                        disabled={!conversation || !newMessage}
                        className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 rounded-lg text-white font-semibold transition-all"
                    >
                        Send
                    </button>
                </div>
            </div>

            {/* Add Member Modal */}
            {showAddMemberModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-gray-800 rounded-xl p-6 w-96 border border-gray-700">
                        <h3 className="text-lg font-semibold text-white mb-4">Add Member to Group</h3>
                        <input
                            type="text"
                            placeholder="Enter domain..."
                            value={addMemberDomain}
                            onChange={(e) => setAddMemberDomain(e.target.value)}
                            className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-4"
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowAddMemberModal(false)}
                                className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-white text-sm"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={addMemberToGroup}
                                disabled={!addMemberDomain || isAddingMember}
                                className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-600 rounded-lg text-white text-sm font-semibold"
                            >
                                {isAddingMember ? 'Adding...' : 'Add'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
