/**
 * AutoStartAgent Component
 *
 * Automatically starts the agent after database connection.
 * This component is mounted globally in _app.tsx to ensure auto-start works on all pages.
 */
import { useEffect, useState } from "react";
import { useMountedApp } from "@/reducers/store";

export function AutoStartAgent() {
  const app = useMountedApp();
  const { db, mediatorDID, initAgent, startAgent } = app;

  // 🔧 FIX #8: Track error state for user-visible feedback
  const [initError, setInitError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  // Initialize agent when database connects
  useEffect(() => {
    if (!app.agent.instance && db.instance) {
      console.log('🔄 [AutoStartAgent] Database connected, initializing agent...');

      try {
        initAgent({ mediatorDID, pluto: db.instance, defaultSeed: app.defaultSeed });
        setInitError(null); // Clear any previous errors
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown init error';
        console.error('❌ [AutoStartAgent] Agent initialization failed:', error);
        setInitError(errorMessage);
      }
    }
  }, [db.instance, app.agent.instance]);

  // Auto-start agent when it becomes available
  useEffect(() => {
    console.log('🔍 [AutoStartAgent] Auto-start check triggered:', {
      hasInstance: !!app.agent.instance,
      hasStarted: app.agent.hasStarted,
      isStarting: app.agent.isStarting,
      agentState: app.agent.instance?.state
    });

    if (app.agent.instance && !app.agent.hasStarted && !app.agent.isStarting) {
      console.log('🚀 [AutoStartAgent] Conditions met - starting agent automatically...');

      startAgent({ agent: app.agent.instance })
        .then(() => {
          console.log('✅ [AutoStartAgent] Agent started successfully');
          setStartError(null); // Clear any previous errors
        })
        .catch((error) => {
          const errorMessage = error instanceof Error ? error.message : 'Unknown start error';
          console.error('❌ [AutoStartAgent] Agent start failed:', error);
          setStartError(errorMessage);
        });
    } else {
      console.log('⏸️ [AutoStartAgent] Auto-start skipped - conditions not met');
    }
  }, [app.agent.instance, app.agent.hasStarted, app.agent.isStarting]);

  // 🔧 FIX #8: Render user-visible error notification if agent fails
  if (initError || startError) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white p-4 shadow-lg">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <span className="text-2xl">⚠️</span>
          <div className="flex-1">
            <p className="font-bold">Wallet Agent Failed to Start</p>
            <p className="text-sm text-red-100 mt-1">
              {initError || startError}
            </p>
          </div>
          <button
            className="px-4 py-2 bg-white text-red-600 rounded hover:bg-red-50 transition-colors font-semibold"
            onClick={() => window.location.reload()}
          >
            Reload Wallet
          </button>
        </div>
      </div>
    );
  }

  // This component doesn't render anything when no errors
  return null;
}
