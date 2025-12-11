import { MountSDK } from '@/components/Agent';
import { AutoStartAgent } from '@/components/AutoStartAgent';
import WasmMemoryGuard from '@/components/WasmMemoryGuard';
import { PresentationRequestModal } from '@/components/PresentationRequestModal';
import { CredentialOfferModal } from '@/components/CredentialOfferModal';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { routeMemoryCleanup } from '@/utils/RouteMemoryCleanup';
import { memoryMonitor } from '@/utils/MemoryMonitor';
import { testEncryptionRoundtrip, testEncryptionWithStoredKeys } from '@/utils/messageEncryption';
import { initSecureDashboardBridge, cleanupSecureDashboardBridge } from '@/utils/SecureDashboardBridge';

function App({ Component, pageProps }) {
    const router = useRouter();

    useEffect(() => {
        // Initialize memory management systems
        memoryMonitor.startMonitoring();
        routeMemoryCleanup.initialize(router);

        // Initialize Secure Dashboard Bridge (BroadcastChannel for local decryption)
        if (typeof window !== 'undefined') {
            initSecureDashboardBridge('bob');
        }

        // 🧪 Expose test functions for debugging encrypted messaging
        if (typeof window !== 'undefined') {
            (window as any).testEncryptionRoundtrip = testEncryptionRoundtrip;
            (window as any).testEncryptionWithStoredKeys = testEncryptionWithStoredKeys;
            console.log('🧪 [DEBUG] Test functions exposed:');
            console.log('  - window.testEncryptionRoundtrip() - Manual key input');
            console.log('  - window.testEncryptionWithStoredKeys() - Auto localStorage retrieval');
        }

        // 🔧 FIX #7: Add global error handlers to prevent silent crashes
        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            console.error('🚨 [Global] Unhandled Promise Rejection:', event.reason);
            console.error('🚨 [Global] Promise:', event.promise);

            // Prevent default behavior (silent crash)
            event.preventDefault();

            // Show user-visible error notification
            alert('⚠️ Wallet Error: An unexpected error occurred. Please reload the wallet if issues persist.');
        };

        const handleError = (event: ErrorEvent) => {
            console.error('🚨 [Global] Uncaught Error:', event.error);
            console.error('🚨 [Global] Message:', event.message);
            console.error('🚨 [Global] File:', event.filename);
            console.error('🚨 [Global] Line:', event.lineno);

            // Prevent default behavior
            event.preventDefault();

            // Show user-visible error notification
            alert('⚠️ Wallet Error: An unexpected error occurred. Please reload the wallet if issues persist.');
        };

        // Attach global error handlers
        window.addEventListener('unhandledrejection', handleUnhandledRejection);
        window.addEventListener('error', handleError);

        console.log('✅ [Global] Error handlers attached');

        // Cleanup on app unmount
        return () => {
            routeMemoryCleanup.destroy();
            memoryMonitor.destroy();
            cleanupSecureDashboardBridge();

            // Remove global error handlers
            window.removeEventListener('unhandledrejection', handleUnhandledRejection);
            window.removeEventListener('error', handleError);
        };
    }, [router]);

    return (
        <ErrorBoundary
            componentName="App Root"
            fallback={
                <div className="min-h-screen flex items-center justify-center bg-gray-100">
                    <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <span className="text-4xl">⚠️</span>
                            <h2 className="text-2xl font-bold text-gray-800">Wallet Error</h2>
                        </div>
                        <p className="text-gray-600 mb-6">
                            The wallet encountered an unexpected error. This could be due to a temporary issue or corrupted state.
                        </p>
                        <button
                            className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
                            onClick={() => window.location.reload()}
                        >
                            Reload Wallet
                        </button>
                    </div>
                </div>
            }
        >
            <MountSDK>
                <AutoStartAgent />
                <WasmMemoryGuard />
                <PresentationRequestModal />
                <CredentialOfferModal />
                <Component {...pageProps} />
            </MountSDK>
        </ErrorBoundary>
    );
}

export default App;