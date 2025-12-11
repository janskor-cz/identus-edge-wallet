/**
 * Scanner Modal Component
 *
 * Full-screen modal overlay for QR scanning.
 * Can be opened from anywhere in the app for quick scanning.
 */

import React, { useEffect } from 'react';
import { Scanner } from './Scanner';
import { MessageType, ScanResult } from '@/utils/qrMessageParser';

export interface ScannerModalProps {
  // Modal state
  isOpen: boolean;
  onClose: () => void;

  // Scanner props
  allowedTypes?: MessageType[];
  onScan: (result: ScanResult) => void;
  onError?: (error: Error) => void;

  // UI customization
  title?: string;
  subtitle?: string;
  preferredCamera?: 'front' | 'back';
}

export const ScannerModal: React.FC<ScannerModalProps> = ({
  isOpen,
  onClose,
  allowedTypes,
  onScan,
  onError,
  title = 'Scan QR Code',
  subtitle = 'Position the QR code within the frame',
  preferredCamera = 'back',
}) => {
  // Close on Escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleScan = (result: ScanResult) => {
    console.log('✅ [ScannerModal] Scan successful, closing modal');
    onScan(result);
    // Note: Parent component should handle routing and can call onClose if needed
  };

  const handleError = (error: Error) => {
    console.error('❌ [ScannerModal] Scan error:', error);
    onError?.(error);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="scanner-modal-backdrop fixed inset-0 bg-black bg-opacity-75 z-50 animate-fadeIn"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal content */}
      <div className="scanner-modal fixed inset-0 z-50 flex items-center justify-center p-4 animate-slideUp">
        <div
          className="scanner-modal-content bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside
        >
          {/* Header */}
          <div className="scanner-modal-header p-6 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {title}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {subtitle}
                </p>
              </div>
              <button
                onClick={onClose}
                className="scanner-close-button p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                aria-label="Close scanner"
              >
                <svg
                  className="w-6 h-6 text-gray-600 dark:text-gray-400"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>
          </div>

          {/* Scanner */}
          <div className="scanner-modal-body p-6">
            <Scanner
              allowedTypes={allowedTypes}
              onScan={handleScan}
              onError={handleError}
              preferredCamera={preferredCamera}
              scanMode="single"
              pauseAfterScan={true}
              showOverlay={true}
            />
          </div>

          {/* Footer with info */}
          <div className="scanner-modal-footer p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <div className="flex items-start gap-3 text-sm text-gray-600 dark:text-gray-400">
              <div className="flex-shrink-0 text-blue-500 mt-0.5">
                <svg
                  className="w-5 h-5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Security Tips:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Only scan QR codes from trusted sources</li>
                  <li>Verify the sender before accepting invitations</li>
                  <li>Camera access is required for scanning</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Animations */}
      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fadeIn {
          animation: fadeIn 0.2s ease-out;
        }

        .animate-slideUp {
          animation: slideUp 0.3s ease-out;
        }

        .scanner-close-button:hover svg {
          transform: rotate(90deg);
          transition: transform 0.2s ease-in-out;
        }
      `}</style>
    </>
  );
};

export default ScannerModal;
