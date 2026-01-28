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

            try {
                console.log('Calling Client.create...');
                const xmtpClient = await Client.create(xmtpSigner, {
                    env: 'dev',
                });
                console.log('Client created!', xmtpClient.accountIdentifier);
                setClient(xmtpClient);
            } catch (createErr: any) {
                // Handle 10/10 installations detection
                const errMsg = createErr?.message || String(createErr);
                console.log('Client creation error:', errMsg);

                if (errMsg.includes('10/10') || errMsg.includes('registered 10 installations')) {
                    console.warn('Installation limit reached. Revoking other installations...');
                    // Create a client without registering to access revoke functionality
                    try {
                        const tempClient = await Client.create(xmtpSigner, {
                            env: 'dev',
                            disableAutoRegister: true,
                        });

                        await tempClient.revokeAllOtherInstallations();
                        console.log('Revocation complete. Retrying client creation...');

                        // Retry creation after revocation
                        const newItem = await Client.create(xmtpSigner, {
                            env: 'dev',
                        });
                        setClient(newItem);
                    } catch (recoveryErr: any) {
                        console.error('Failed to revoke installations:', recoveryErr);
                        // If we can't even create a temp client or revoke, we must surface the original error
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

    return {
        client,
        isLoading,
        error,
        initXmtp,
        isConnected: !!client,
    };
};
