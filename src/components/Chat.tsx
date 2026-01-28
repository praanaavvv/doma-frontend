import { useState, useEffect, useRef, useCallback } from 'react';
import { useXmtp } from '../hooks/useXmtp';
import { useDomains } from '../hooks/useDomains';
import { useAccount } from 'wagmi';
import { DecodedMessage, IdentifierKind } from '@xmtp/browser-sdk';
import { getOwnerByDomain, syncConversation } from '../api/domaApi';

export const Chat = () => {
    const { address } = useAccount();
    const { client, initXmtp, isConnected, isLoading, error } = useXmtp();
    const { domains, selectedDomain, setSelectedDomain, conversations, refreshConversations } = useDomains(address);

    const [messages, setMessages] = useState<DecodedMessage[]>([]);
    const [recipientDomain, setRecipientDomain] = useState('');
    const [newMessage, setNewMessage] = useState('');
    const [conversation, setConversation] = useState<any>(null);
    const [isStartingChat, setIsStartingChat] = useState(false);
    const [recipientStatus, setRecipientStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
    const streamRef = useRef<any>(null);

    // Cleanup stream on unmount
    useEffect(() => {
        return () => {
            if (streamRef.current?.end) {
                streamRef.current.end();
            }
        };
    }, []);

    const joinConversation = useCallback(async (convId: string) => {
        if (!client || !convId) return;

        try {
            if (streamRef.current?.end) {
                streamRef.current.end();
            }

            console.log('Joining conversation:', convId);
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

            // Start streaming
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
        }
    }, [client]);

    const startNewChat = useCallback(async () => {
        if (!client || !selectedDomain || !recipientDomain) return;

        try {
            setIsStartingChat(true);
            console.log('Starting chat with domain:', recipientDomain);

            // Get wallet address for recipient domain
            const ownerResponse = await getOwnerByDomain(recipientDomain);
            const recipientAddress = ownerResponse.owner;
            console.log('Recipient address:', recipientAddress);

            // Check if on XMTP
            const identifier = { identifier: recipientAddress, identifierKind: IdentifierKind.Ethereum };
            const canMessageMap = await client.canMessage([identifier]);
            const canMessage = canMessageMap.get(identifier.identifier.toLowerCase()) || canMessageMap.get(identifier.identifier);

            if (!canMessage) {
                alert(`${recipientDomain} is not registered on XMTP yet.`);
                return;
            }

            // Sync conversations
            await client.conversations.sync();

            // Create a unique group name for this domain pair (sorted for consistency)
            const domainPair = [selectedDomain, recipientDomain].sort().join(':');
            const groupName = `doma:${domainPair}`;

            // Check if a group with this domain pair already exists
            const allConversations = await client.conversations.list();
            // Filter for groups only (DMs don't have names) and find by group name
            let conv = allConversations.find(c => 'name' in c && c.name === groupName);

            if (!conv) {
                // Create a new group for this domain pair
                console.log('Creating new group for domain pair:', groupName);
                conv = await client.conversations.createGroupWithIdentifiers([identifier], {
                    groupName: groupName,
                    groupDescription: `Chat between ${selectedDomain} and ${recipientDomain}`,
                });
            } else {
                console.log('Found existing group for domain pair:', groupName);
            }

            // Sync to backend
            await syncConversation({
                id: conv.id,
                senderDomain: selectedDomain,
                recipientDomain: recipientDomain,
            });

            // Refresh conversations list
            await refreshConversations();

            // Join the conversation
            await joinConversation(conv.id);
            setRecipientDomain('');
        } catch (e) {
            console.error('Error starting chat:', e);
            alert('Failed to start chat. Check console for details.');
        } finally {
            setIsStartingChat(false);
        }
    }, [client, selectedDomain, recipientDomain, joinConversation, refreshConversations]);

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

                {/* New Chat */}
                <div className="p-4 border-b border-gray-700 space-y-2">
                    <div className="text-xs text-gray-400">Chat with Domain</div>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="Enter domain..."
                            value={recipientDomain}
                            onChange={(e) => setRecipientDomain(e.target.value)}
                            className={`flex-1 bg-gray-700 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 ${recipientStatus === 'valid' ? 'focus:ring-green-500 ring-1 ring-green-500/50' :
                                recipientStatus === 'invalid' ? 'focus:ring-red-500 ring-1 ring-red-500/50' :
                                    'focus:ring-blue-500'
                                }`}
                        />
                    </div>
                    <button
                        onClick={startNewChat}
                        disabled={!recipientDomain || isStartingChat || recipientStatus !== 'valid'}
                        className="w-full px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-600 rounded-lg text-white text-sm font-semibold"
                    >
                        {isStartingChat ? 'Starting...' : 'Start Chat'}
                    </button>
                </div>

                {/* Conversations */}
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
            </div>

            {/* Chat Area */}
            <div className="flex-1 flex flex-col">
                {/* Chat Header */}
                <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-700">
                    <div className="text-white font-semibold">
                        {conversation ? (conversations.find(c => c.conversationId === conversation.id)?.withDomain || 'Chat') : 'Select a conversation'}
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {messages.map((msg) => (
                        <div key={msg.id} className={`flex ${msg.senderInboxId === client?.inboxId ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] px-4 py-2 rounded-2xl ${msg.senderInboxId === client?.inboxId
                                ? 'bg-blue-600 text-white rounded-br-none'
                                : 'bg-gray-700 text-gray-100 rounded-bl-none'
                                }`}>
                                <div>{typeof msg.content === 'string' ? msg.content : 'Unsupported content'}</div>
                            </div>
                        </div>
                    ))}
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
        </div>
    );
};
