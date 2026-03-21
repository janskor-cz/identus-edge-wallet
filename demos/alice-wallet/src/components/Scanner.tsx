/**
 * Multipurpose QR Scanner Component
 *
 * Reusable scanner for OOB invitations, proof requests, credential offers, etc.
 * Uses @yudiel/react-qr-scanner for camera access and QR detection.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Scanner as QRScanner } from '@yudiel/react-qr-scanner';
import { parseQRMessage, validateQRMessage, MessageType, ScanResult } from '@/utils/qrMessageParser';

// Camera permission states
type CameraState = 'checking' | 'granted' | 'denied' | 'not-found' | 'error';

export interface ScannerProps {
  // Extensibility: Filter by allowed message types
  allowedTypes?: MessageType[];

  // Callback for successful scan
  onScan: (result: ScanResult) => void;

  // Callback for errors
  onError?: (error: Error) => void;

  // UI customization
  className?: string;
  showOverlay?: boolean;

  // Camera preferences
  preferredCamera?: 'front' | 'back';
  enableTorch?: boolean;

  // Behavior
  scanMode?: 'single' | 'continuous';
  pauseAfterScan?: boolean;

  // Auto-dismiss
  autoClose?: boolean;
  autoCloseDelay?: number; // milliseconds
}

export const Scanner: React.FC<ScannerProps> = ({
  allowedTypes,
  onScan,
  onError,
  className = '',
  showOverlay = true,
  preferredCamera = 'back',
  enableTorch = false,
  scanMode = 'single',
  pauseAfterScan = true,
  autoClose = false,
  autoCloseDelay = 2000,
}) => {
  const [isPaused, setIsPaused] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false); // Start false until camera ready
  const [error, setError] = useState<string | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>('checking');

  // Check camera permissions and availability on mount
  useEffect(() => {
    const checkCameraAccess = async () => {
      console.log('📷 [Scanner] Checking camera access...');

      try {
        // Check if mediaDevices API is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          console.error('❌ [Scanner] MediaDevices API not available');
          setCameraState('error');
          setError('Camera API not available. Please use a modern browser with HTTPS.');
          return;
        }

        // Check for available video devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        console.log(`📷 [Scanner] Found ${videoDevices.length} camera(s):`,
          videoDevices.map(d => d.label || 'unnamed').join(', '));

        if (videoDevices.length === 0) {
          console.error('❌ [Scanner] No camera found on device');
          setCameraState('not-found');
          setError('No camera found. Please connect a camera and try again.');
          return;
        }

        // Try to get camera permission
        console.log('📷 [Scanner] Requesting camera permission...');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: preferredCamera === 'front' ? 'user' : 'environment'
          }
        });

        // Success! Stop the test stream
        stream.getTracks().forEach(track => track.stop());
        console.log('✅ [Scanner] Camera access granted');
        setCameraState('granted');
        setScanning(true);

      } catch (err: any) {
        console.error('❌ [Scanner] Camera access error:', err);

        // Handle specific error types
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          console.error('❌ [Scanner] Camera permission denied by user');
          setCameraState('denied');
          setError('Camera permission denied. Please allow camera access in your browser settings and reload the page.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          console.error('❌ [Scanner] No camera found');
          setCameraState('not-found');
          setError('No camera found. Please connect a camera and try again.');
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          console.error('❌ [Scanner] Camera is in use by another application');
          setCameraState('error');
          setError('Camera is in use by another application. Please close other apps using the camera.');
        } else if (err.name === 'OverconstrainedError') {
          console.error('❌ [Scanner] Camera constraints not satisfiable');
          setCameraState('error');
          setError('Camera does not support required features. Try a different camera.');
        } else {
          console.error('❌ [Scanner] Unknown camera error:', err.name, err.message);
          setCameraState('error');
          setError(`Camera error: ${err.message || err.name || 'Unknown error'}`);
        }

        onError?.(new Error(error || 'Camera access failed'));
      }
    };

    checkCameraAccess();
  }, [preferredCamera]);

  // Handle QR code detection
  const handleDecode = async (result: string) => {
    // Prevent duplicate scans
    if (result === lastScan && pauseAfterScan) {
      console.log('⚠️ [Scanner] Duplicate scan detected, ignoring');
      return;
    }

    console.log('📷 [Scanner] QR code detected:', result.substring(0, 50) + '...');
    setLastScan(result);
    setError(null);

    try {
      // Parse QR code content
      const parsedResult = await parseQRMessage(result);
      console.log('✅ [Scanner] Message type detected:', parsedResult.messageType);

      // Filter by allowed types if specified
      if (allowedTypes && allowedTypes.length > 0) {
        if (!allowedTypes.includes(parsedResult.messageType)) {
          throw new Error(
            `This scanner only accepts: ${allowedTypes.join(', ')}. ` +
            `Scanned message type is: ${parsedResult.messageType}`
          );
        }
      }

      // Validate message for security
      await validateQRMessage(parsedResult);

      // Pause scanner if single-scan mode
      if (scanMode === 'single') {
        setIsPaused(true);
        setScanning(false);
      }

      // Success callback
      onScan(parsedResult);

      // Auto-close if enabled
      if (autoClose && autoCloseDelay > 0) {
        console.log(`🕐 [Scanner] Auto-closing in ${autoCloseDelay}ms...`);
        setTimeout(() => {
          console.log('✅ [Scanner] Auto-closed successfully');
        }, autoCloseDelay);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown scan error');
      console.error('❌ [Scanner] Scan error:', error.message);
      setError(error.message);
      onError?.(error);

      // Reset for next scan
      setLastScan(null);
    }
  };

  // Handle scanner errors (camera access, etc.)
  const handleError = (err: unknown) => {
    // Handle empty object rejections from @yudiel/react-qr-scanner
    let errorMessage = 'Scanner error';

    if (err === null || err === undefined) {
      console.error('❌ [Scanner] Received null/undefined error');
      errorMessage = 'Scanner failed to initialize. Please check camera permissions.';
    } else if (typeof err === 'object' && Object.keys(err as object).length === 0) {
      // Empty object {} - common issue with this library
      console.error('❌ [Scanner] Received empty error object {}');
      errorMessage = 'Camera initialization failed. Please ensure camera permissions are granted and no other app is using the camera.';
    } else if (err instanceof Error) {
      console.error('❌ [Scanner] Camera error:', err.name, err.message);
      errorMessage = err.message;
    } else if (typeof err === 'string') {
      console.error('❌ [Scanner] Camera error string:', err);
      errorMessage = err;
    } else {
      console.error('❌ [Scanner] Unknown error type:', typeof err, err);
      errorMessage = 'Unknown scanner error occurred.';
    }

    // Enhance common error messages
    if (errorMessage.includes('Permission') || errorMessage.includes('NotAllowed')) {
      errorMessage = 'Camera permission denied. Please allow camera access in your browser settings and reload.';
    } else if (errorMessage.includes('NotFound')) {
      errorMessage = 'No camera found. Please check your device has a working camera.';
    }

    console.error('❌ [Scanner] Final error message:', errorMessage);
    setError(errorMessage);
    setCameraState('error');
    onError?.(new Error(errorMessage));
  };

  // Reset scanner
  const resetScanner = () => {
    setIsPaused(false);
    setScanning(true);
    setLastScan(null);
    setError(null);
    console.log('🔄 [Scanner] Reset and ready for next scan');
  };

  return (
    <div className={`scanner-container ${className}`}>
      {/* Scanner view */}
      <div className="scanner-view relative">
        {/* Camera checking state */}
        {cameraState === 'checking' && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
            <div className="text-center text-white">
              <div className="animate-spin w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-lg font-semibold">Checking camera access...</p>
              <p className="text-sm text-gray-400 mt-2">Please allow camera permission if prompted</p>
            </div>
          </div>
        )}

        {/* Camera permission denied state */}
        {cameraState === 'denied' && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-900 p-6">
            <div className="text-center text-white max-w-md">
              <div className="text-6xl mb-4">🚫</div>
              <p className="text-xl font-semibold mb-2">Camera Permission Denied</p>
              <p className="text-sm mb-4">Please allow camera access in your browser settings:</p>
              <ol className="text-left text-sm space-y-2 mb-4">
                <li>1. Click the camera/lock icon in the address bar</li>
                <li>2. Allow camera access for this site</li>
                <li>3. Reload the page</li>
              </ol>
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-2 bg-white text-red-600 rounded-lg font-semibold hover:bg-gray-100"
              >
                Reload Page
              </button>
            </div>
          </div>
        )}

        {/* No camera found state */}
        {cameraState === 'not-found' && (
          <div className="absolute inset-0 flex items-center justify-center bg-yellow-900 p-6">
            <div className="text-center text-white max-w-md">
              <div className="text-6xl mb-4">📷</div>
              <p className="text-xl font-semibold mb-2">No Camera Found</p>
              <p className="text-sm">Please connect a camera to your device and try again.</p>
              <button
                onClick={() => window.location.reload()}
                className="mt-4 px-6 py-2 bg-white text-yellow-600 rounded-lg font-semibold hover:bg-gray-100"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Scanner ready - show QR scanner */}
        {cameraState === 'granted' && scanning && (
          <QRScanner
            onDecode={handleDecode}
            onError={handleError}
            paused={isPaused}
            constraints={{
              facingMode: preferredCamera === 'front' ? 'user' : 'environment',
            }}
            scanDelay={500} // Prevent rapid duplicate scans
            components={{
              audio: false, // Disabled - causes Safari/iOS crash
              torch: false, // Disabled - not supported on all devices
              finder: true, // Show viewfinder overlay
            }}
            styles={{
              container: {
                width: '100%',
                height: '100%',
                position: 'relative',
              },
            }}
          />
        )}

        {/* Overlay with scanning guide */}
        {showOverlay && scanning && (
          <div className="scanner-overlay absolute inset-0 pointer-events-none flex items-center justify-center">
            {/* Target box */}
            <div className="scanner-target-box relative w-64 h-64 border-4 border-blue-500 rounded-lg">
              {/* Corner decorations */}
              <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-lg"></div>
              <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-lg"></div>
              <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-lg"></div>
              <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-lg"></div>

              {/* Scanning line animation */}
              <div className="scanner-line absolute top-0 left-0 w-full h-1 bg-blue-400 animate-scan"></div>
            </div>

            {/* Hint text */}
            <p className="scanner-hint absolute bottom-8 left-0 right-0 text-center text-white text-sm bg-black bg-opacity-50 px-4 py-2 mx-4 rounded">
              {allowedTypes && allowedTypes.length === 1
                ? `Scan ${allowedTypes[0].replace(/-/g, ' ')} QR code`
                : 'Scan QR code for invitation or proof request'}
            </p>
          </div>
        )}

        {/* Success state */}
        {!scanning && !error && (
          <div className="scanner-success absolute inset-0 flex items-center justify-center bg-green-500 bg-opacity-90">
            <div className="text-center text-white">
              <div className="text-6xl mb-4">✓</div>
              <p className="text-xl font-semibold">QR Code Scanned!</p>
              <p className="text-sm mt-2">Processing...</p>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="scanner-error absolute inset-0 flex items-center justify-center bg-red-500 bg-opacity-90 p-6">
            <div className="text-center text-white max-w-md">
              <div className="text-6xl mb-4">⚠</div>
              <p className="text-lg font-semibold mb-2">Scan Error</p>
              <p className="text-sm">{error}</p>
              <button
                onClick={resetScanner}
                className="mt-4 px-6 py-2 bg-white text-red-600 rounded-lg font-semibold hover:bg-gray-100 transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Scanner controls */}
      {scanning && (
        <div className="scanner-controls mt-4 flex justify-center gap-3">
          <button
            onClick={() => setIsPaused(!isPaused)}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            {isPaused ? '▶ Resume' : '⏸ Pause'}
          </button>
        </div>
      )}

      {/* Custom styles for animations */}
      <style jsx>{`
        @keyframes scan {
          0% {
            transform: translateY(0);
            opacity: 0;
          }
          50% {
            opacity: 1;
          }
          100% {
            transform: translateY(256px);
            opacity: 0;
          }
        }

        .animate-scan {
          animation: scan 2s ease-in-out infinite;
        }

        .scanner-view {
          min-height: 400px;
          background: #000;
          border-radius: 8px;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
};

export default Scanner;
