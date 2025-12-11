import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAppDispatch } from '../src/store/hooks';
import { useCredentials } from '../src/reducers/app';
import { acceptPresentationRequest } from '../src/actions';
import styles from '../styles/Verify.module.css';

interface ProofRequest {
  id: string;
  challengeId: string;
  type: string;
  credentialType: string;
  challenge: string;
  verifyUrl: string;
  walletUrl: string;
  useExistingConnection: boolean;
}

const VerifyPage: React.FC = () => {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const credentials = useCredentials();
  const { request } = router.query;

  const [proofRequest, setProofRequest] = useState<ProofRequest | null>(null);
  const [selectedCredential, setSelectedCredential] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [matchingCredentials, setMatchingCredentials] = useState<any[]>([]);

  // Parse the proof request when component mounts or request changes
  useEffect(() => {
    if (request && typeof request === 'string') {
      try {
        const decoded = Buffer.from(request, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        setProofRequest(parsed);
        console.log('📋 Parsed proof request:', parsed);
      } catch (e) {
        console.error('Failed to parse proof request:', e);
        setError('Invalid proof request format');
      }
    }
  }, [request]);

  // Filter credentials based on proof request type
  useEffect(() => {
    if (proofRequest && credentials) {
      const matching = credentials.filter(cred => {
        // Check if credential type matches the requested type
        const credType = cred.type || [];
        const hasMatchingType = credType.some((t: string) =>
          t.includes(proofRequest.credentialType) ||
          t === proofRequest.credentialType
        );

        // Also check the credential data for type field
        const credData = cred.credentialData || cred.claims || {};
        const dataHasType = credData.type?.includes(proofRequest.credentialType);

        return hasMatchingType || dataHasType;
      });

      console.log(`🔍 Found ${matching.length} matching ${proofRequest.credentialType} credentials`);
      setMatchingCredentials(matching);
    }
  }, [proofRequest, credentials]);

  const handleSelectCredential = (credential: any) => {
    setSelectedCredential(credential);
    setError(null);
  };

  const handleSubmitProof = async () => {
    if (!selectedCredential || !proofRequest) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // Prepare the credential data for submission
      const credentialData = selectedCredential.credentialData ||
                            selectedCredential.claims ||
                            selectedCredential;

      // Extract the verification URL, adjusting if needed
      let verifyUrl = proofRequest.verifyUrl;

      // Replace localhost with actual server IP if needed
      if (verifyUrl.includes('localhost')) {
        verifyUrl = verifyUrl.replace('http://localhost:3004', 'http://91.99.4.54:3005');
        verifyUrl = verifyUrl.replace('http://localhost:3005', 'http://91.99.4.54:3005');
      }

      console.log('📤 Submitting proof to:', verifyUrl);
      console.log('📋 Credential data:', credentialData);

      // Submit the proof
      const response = await fetch(verifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          presentationId: proofRequest.id,
          challengeId: proofRequest.challengeId,
          credential: credentialData,
          credentialData: credentialData,
          userInfo: credentialData
        }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        console.log('✅ Proof submitted successfully:', result);
        setSuccess(true);

        // Redirect after successful submission
        setTimeout(() => {
          if (result.redirectUrl) {
            window.location.href = result.redirectUrl;
          } else {
            router.push('/credentials');
          }
        }, 2000);
      } else {
        throw new Error(result.error || 'Failed to submit proof');
      }
    } catch (e: any) {
      console.error('❌ Error submitting proof:', e);
      setError(e.message || 'Failed to submit proof');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!request) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <h2>No Proof Request</h2>
          <p>No proof request was provided. Please go back and try again.</p>
          <button onClick={() => router.push('/')} className={styles.button}>
            Go Home
          </button>
        </div>
      </div>
    );
  }

  if (error && !proofRequest) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <h2>Invalid Request</h2>
          <p>{error}</p>
          <button onClick={() => router.push('/')} className={styles.button}>
            Go Home
          </button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className={styles.container}>
        <div className={styles.success}>
          <h2>✅ Proof Submitted Successfully</h2>
          <p>Your credential has been verified. Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>🔐 Credential Verification Request</h1>

      {proofRequest && (
        <div className={styles.requestDetails}>
          <h2>Request Details</h2>
          <div className={styles.detail}>
            <strong>Type:</strong> {proofRequest.credentialType}
          </div>
          <div className={styles.detail}>
            <strong>Challenge:</strong> {proofRequest.challenge}
          </div>
          <div className={styles.detail}>
            <strong>Request ID:</strong> {proofRequest.id}
          </div>
        </div>
      )}

      <div className={styles.credentialSection}>
        <h2>Select Credential</h2>

        {matchingCredentials.length === 0 ? (
          <div className={styles.noCredentials}>
            <p>No matching {proofRequest?.credentialType} credentials found in your wallet.</p>
            <p>Please obtain a {proofRequest?.credentialType} credential first.</p>
            <button onClick={() => router.push('/credentials')} className={styles.button}>
              View Credentials
            </button>
          </div>
        ) : (
          <div className={styles.credentialList}>
            {matchingCredentials.map((credential, index) => {
              const credData = credential.credentialData || credential.claims || {};
              const isSelected = selectedCredential === credential;

              return (
                <div
                  key={index}
                  className={`${styles.credentialCard} ${isSelected ? styles.selected : ''}`}
                  onClick={() => handleSelectCredential(credential)}
                >
                  <h3>{proofRequest?.credentialType} Credential</h3>
                  <div className={styles.credentialDetails}>
                    {credData.firstName && (
                      <div><strong>Name:</strong> {credData.firstName} {credData.lastName}</div>
                    )}
                    {credData.dateOfBirth && (
                      <div><strong>Date of Birth:</strong> {credData.dateOfBirth}</div>
                    )}
                    {credData.uniqueId && (
                      <div><strong>ID:</strong> {credData.uniqueId}</div>
                    )}
                    {credData.gender && (
                      <div><strong>Gender:</strong> {credData.gender}</div>
                    )}
                  </div>
                  {isSelected && (
                    <div className={styles.selectedBadge}>✓ Selected</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedCredential && (
        <div className={styles.submitSection}>
          <button
            onClick={handleSubmitProof}
            disabled={isSubmitting}
            className={`${styles.button} ${styles.submitButton}`}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Proof'}
          </button>
        </div>
      )}

      {error && (
        <div className={styles.errorMessage}>
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  );
};

export default VerifyPage;