import { useCallback, useState } from 'react';
import { Client, IdentifierKind } from '@xmtp/browser-sdk';
import { useAccount, useWalletClient } from 'wagmi';
import { type Signer } from '@xmtp/browser-sdk';
import { hexToBytes } from 'viem';

export const useXmtp = () => {
    const { address } = useAccount();
    const { data: walletClient } = useWalletClient();
    const [client, setClient] = useState<Client | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const initXmtp = useCallback(async () => {
        console.log('initXmtp called', { walletClient: !!walletClient, address });
        if (!walletClient || !address) return;

        try {
            setIsLoading(true);
            setError(null);
            console.log('Starting XMTP client creation...');

            // Adapt viem wallet client to XMTP Signer
            const xmtpSigner: Signer = {
                type: 'EOA',
                getIdentifier: () => {
                    console.log('getIdentifier called');
                    return Promise.resolve({
                        identifier: address,
                        identifierKind: IdentifierKind.Ethereum,
                    })
                },
                signMessage: async (message: string) => {
                    console.log('signMessage requested', message);
                    // XMTP SDK sends a string message to be signed
                    const signature = await walletClient.signMessage({ message });
                    console.log('Message signed', signature);
                    return hexToBytes(signature);
                },
            };

            // Generate a stable encryption key from address (for persistence)
            const encoder = new TextEncoder();
            const keyData = encoder.encode(address.toLowerCase().padEnd(32, '0'));
            const dbEncryptionKey = keyData.slice(0, 32);

            try {
                console.log('Calling Client.create with persistent db...');
                const xmtpClient = await Client.create(xmtpSigner, {
                    env: 'dev',
                    dbPath: `xmtp-${address.toLowerCase()}`, // Persist using wallet address
                    dbEncryptionKey: dbEncryptionKey,
                });
                console.log('Client created!', xmtpClient.accountIdentifier);
                setClient(xmtpClient);
            } catch (createErr: any) {
                // Handle 10/10 installations detection
                const errMsg = createErr?.message || String(createErr);
                console.log('Client creation error:', errMsg);

                if (errMsg.includes('10/10') || errMsg.includes('registered 10 installations')) {
                    console.warn('Installation limit reached. Revoking excess installations...');

                    // Extract inboxId from error message
                    const inboxIdMatch = errMsg.match(/InboxID\s+([a-f0-9]+)/i);
                    if (!inboxIdMatch) {
                        throw new Error('Could not extract InboxID from error message');
                    }
                    const inboxId = inboxIdMatch[1];
                    console.log('Extracted inboxId:', inboxId);

                    try {
                        // Fetch current installations
                        const states = await Client.fetchInboxStates([inboxId], 'dev');
                        if (states.length === 0) {
                            throw new Error('Could not fetch inbox state');
                        }

                        const installations = states[0].installations;
                        console.log('Found installations:', installations.length);

                        // Keep only first 5, revoke the rest
                        if (installations.length > 5) {
                            const installationsToRevoke = installations.slice(5);
                            console.log('Revoking', installationsToRevoke.length, 'installations...');

                            // Revoke excess installations one by one
                            for (const installation of installationsToRevoke) {
                                console.log('Revoking installation:', installation.id);
                                await Client.revokeInstallations(
                                    xmtpSigner,
                                    states[0].inboxId,
                                    [installation.bytes], // Pass bytes (Uint8Array) not id (string)
                                    'dev'
                                );
                            }
                            console.log('Revocation complete. Retrying client creation...');
                        }

                        // Retry creation after revocation
                        const newClient = await Client.create(xmtpSigner, {
                            env: 'dev',
                            dbPath: `xmtp-${address.toLowerCase()}`,
                            dbEncryptionKey: dbEncryptionKey,
                        });
                        console.log('Client created after revocation!');
                        setClient(newClient);
                    } catch (recoveryErr: any) {
                        console.error('Failed to revoke installations:', recoveryErr);
                        setError(recoveryErr as Error);
                    }
                } else {
                    throw createErr;
                }
            }
        } catch (err) {
            console.error('Error initializing XMTP client:', err);
            setError(err as Error);
        } finally {
            setIsLoading(false);
        }
    }, [walletClient, address]);

    // Manual function to revoke excess installations (call this if InboxValidationFailed errors occur)
    const revokeExcessInstallations = useCallback(async () => {
        if (!client || !walletClient || !address) {
            console.error('Client not initialized');
            return;
        }

        try {
            setIsLoading(true);
            console.log('Fetching inbox state...');

            const inboxId = client.inboxId;
            if (!inboxId) {
                console.error('No inbox ID found');
                return;
            }
            const states = await Client.fetchInboxStates([inboxId], 'dev');

            if (states.length === 0) {
                console.error('Could not fetch inbox state');
                return;
            }

            const installations = states[0].installations;
            console.log('Found', installations.length, 'installations');

            // Keep only first 2, revoke the rest
            if (installations.length > 2) {
                const installationsToRevoke = installations.slice(2);
                console.log('Revoking', installationsToRevoke.length, 'excess installations...');

                const xmtpSigner: Signer = {
                    type: 'EOA',
                    getIdentifier: () => Promise.resolve({
                        identifier: address,
                        identifierKind: IdentifierKind.Ethereum,
                    }),
                    signMessage: async (message: string) => {
                        const signature = await walletClient.signMessage({ message });
                        return hexToBytes(signature);
                    },
                };

                for (const installation of installationsToRevoke) {
                    console.log('Revoking installation:', installation.id);
                    await Client.revokeInstallations(
                        xmtpSigner,
                        states[0].inboxId,
                        [installation.bytes],
                        'dev'
                    );
                }

                console.log('Revocation complete! Please refresh the page.');
                alert('Revoked ' + installationsToRevoke.length + ' installations. Please refresh the page.');
            } else {
                console.log('No excess installations to revoke');
                alert('No excess installations to revoke (' + installations.length + ' current)');
            }
        } catch (err) {
            console.error('Error revoking installations:', err);
            setError(err as Error);
        } finally {
            setIsLoading(false);
        }
    }, [client, walletClient, address]);

    return {
        client,
        isLoading,
        error,
        initXmtp,
        revokeExcessInstallations,
        isConnected: !!client,
    };
};
