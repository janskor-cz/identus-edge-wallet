import { MountSDK } from '@/components/Agent';
import WasmMemoryGuard from '@/components/WasmMemoryGuard';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { routeMemoryCleanup } from '@/utils/RouteMemoryCleanup';
import { memoryMonitor } from '@/utils/MemoryMonitor';

function App({ Component, pageProps }) {
    const router = useRouter();

    useEffect(() => {
        // Initialize memory management systems
        memoryMonitor.startMonitoring();
        routeMemoryCleanup.initialize(router);

        // Cleanup on app unmount
        return () => {
            routeMemoryCleanup.destroy();
            memoryMonitor.destroy();
        };
    }, [router]);

    return (
        <MountSDK>
            <WasmMemoryGuard />
            <Component {...pageProps} />
        </MountSDK>
    );
}

export default App;