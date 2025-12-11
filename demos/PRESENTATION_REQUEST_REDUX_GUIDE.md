# Redux State Management for Presentation Requests

## Implementation Summary

Redux state management for presentation requests has been successfully implemented in both Alice and Bob wallets to support a manual VC selection workflow. Users receive presentation requests in Redux state, which triggers a UI modal allowing them to manually select which credential to share.

---

## Architecture Overview

### Redux Toolkit Pattern

This implementation uses **Redux Toolkit's `createSlice`** pattern with four new reducer actions for managing presentation request lifecycle.

### State Structure

```typescript
// Type Definitions
export type PresentationRequestStatus = 'pending' | 'sent' | 'declined';

export type PresentationRequest = {
    id: string;                          // Request message ID
    from: string;                        // Sender DID
    requestMessage: SDK.Domain.Message;  // Full RequestPresentation message
    timestamp: string;                   // ISO timestamp (ISO 8601 format)
    status: PresentationRequestStatus;
};

// Added to RootState
export type RootState = {
    // ... existing state fields ...
    presentationRequests: PresentationRequest[];  // New field
};

// Initial State
export const initialState: RootState = {
    // ... existing fields ...
    presentationRequests: [],  // Initialize as empty array
};
```

---

## Redux Actions

### 1. `presentationRequestReceived`

**Purpose**: Add a new presentation request when received via DIDComm

**Usage**:
```typescript
import { useDispatch } from 'react-redux';
import { reduxActions } from '@/reducers/app';

// When presentation request arrives
dispatch(reduxActions.presentationRequestReceived({
    id: message.id,
    from: message.from.toString(),
    requestMessage: message,
    timestamp: new Date().toISOString()
}));
```

**Payload**:
```typescript
{
    id: string;                          // Message ID (unique identifier)
    from: string;                        // Sender DID as string
    requestMessage: SDK.Domain.Message;  // Complete message object
    timestamp: string;                   // ISO 8601 timestamp
}
```

**Behavior**:
- Adds request to `state.presentationRequests` array
- Sets initial status to `'pending'`
- Does not modify existing requests
- Triggers UI to display modal/notification

**When to Call**:
- Message listener receives `PresentationRequest` message type
- Inside `agent.addListener(type: SDK.ListenerKey.MESSAGE)` callback
- After validating message is a presentation request

---

### 2. `presentationRequestResponded`

**Purpose**: Mark request as sent after user selects and sends a VC

**Usage**:
```typescript
// After successfully sending VerifiablePresentation
const sendPresentation = async (requestId: string, selectedVC: any) => {
    try {
        // Send presentation via SDK
        await agent.sendVerifiablePresentation(selectedVC);

        // Update Redux state
        dispatch(reduxActions.presentationRequestResponded({
            requestId: requestId
        }));
    } catch (error) {
        console.error('Failed to send presentation:', error);
    }
};
```

**Payload**:
```typescript
{
    requestId: string;  // ID of the presentation request
}
```

**Behavior**:
- Finds request by ID in `state.presentationRequests`
- Updates `status` from `'pending'` to `'sent'`
- Request remains in state for history/audit trail
- Does not remove request from array

**When to Call**:
- After `agent.sendMessage()` succeeds
- After presentation submission is confirmed
- Before closing modal/notification UI

---

### 3. `presentationRequestDeclined`

**Purpose**: Mark request as declined when user rejects

**Usage**:
```typescript
// When user clicks "Decline" button
const handleDecline = (requestId: string) => {
    dispatch(reduxActions.presentationRequestDeclined({
        requestId: requestId
    }));

    // Optionally close modal
    setModalOpen(false);
};
```

**Payload**:
```typescript
{
    requestId: string;  // ID of the presentation request
}
```

**Behavior**:
- Finds request by ID in `state.presentationRequests`
- Updates `status` from `'pending'` to `'declined'`
- Request remains in state for history
- Does not send rejection message (UI-only state change)

**When to Call**:
- User clicks "Reject" or "Decline" button
- User dismisses modal without responding
- Timeout expires without user action

---

### 4. `clearOldPresentationRequests`

**Purpose**: Cleanup old completed requests (housekeeping)

**Usage**:
```typescript
// Cleanup requests older than 7 days
const cleanupOldRequests = () => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    dispatch(reduxActions.clearOldPresentationRequests({
        olderThan: sevenDaysAgo.toISOString()
    }));
};

// Call on app startup or periodically
useEffect(() => {
    cleanupOldRequests();
}, []);
```

**Payload**:
```typescript
{
    olderThan: string;  // ISO 8601 timestamp threshold
}
```

**Behavior**:
- Filters `state.presentationRequests` array
- **Keeps ALL `'pending'` requests** (regardless of age)
- Removes `'sent'` and `'declined'` requests older than threshold
- Does not affect pending requests

**When to Call**:
- Application startup
- Periodic background task (e.g., every hour)
- Before displaying request list (for performance)
- User-triggered "Clear History" action

---

## Integration Guide

### Step 1: Import Redux Actions

```typescript
import { useSelector, useDispatch } from 'react-redux';
import { reduxActions } from '@/reducers/app';
import type { RootState, PresentationRequest } from '@/reducers/app';
```

### Step 2: Access State in Components

```typescript
const PresentationModal: React.FC = () => {
    const dispatch = useDispatch();
    const presentationRequests = useSelector(
        (state: RootState) => state.presentationRequests
    );

    // Filter for pending requests only
    const pendingRequests = presentationRequests.filter(
        req => req.status === 'pending'
    );

    return (
        <div>
            {pendingRequests.length > 0 && (
                <Modal>
                    <h2>Presentation Request</h2>
                    <p>From: {pendingRequests[0].from}</p>
                    {/* VC selection UI */}
                </Modal>
            )}
        </div>
    );
};
```

### Step 3: Handle Incoming Requests

```typescript
// In message listener (e.g., actions/index.ts or component)
agent.addListener(SDK.ListenerKey.MESSAGE, async (messages: SDK.Domain.Message[]) => {
    messages.forEach((message) => {
        // Check if message is presentation request
        if (message.piuri === 'https://didcomm.org/present-proof/3.0/request-presentation') {
            // Add to Redux state
            dispatch(reduxActions.presentationRequestReceived({
                id: message.id,
                from: message.from.toString(),
                requestMessage: message,
                timestamp: new Date().toISOString()
            }));
        }
    });
});
```

### Step 4: User Selection and Response

```typescript
const handleVCSelection = async (
    requestId: string,
    selectedCredential: SDK.Domain.Credential
) => {
    try {
        // Get request details
        const request = presentationRequests.find(req => req.id === requestId);
        if (!request) throw new Error('Request not found');

        // Create verifiable presentation
        const presentation = await agent.preparePresentation(
            request.requestMessage,
            selectedCredential
        );

        // Send presentation
        await agent.sendMessage(presentation);

        // Update Redux state to 'sent'
        dispatch(reduxActions.presentationRequestResponded({
            requestId: requestId
        }));

        console.log('✅ Presentation sent successfully');
    } catch (error) {
        console.error('❌ Failed to send presentation:', error);
    }
};

const handleDecline = (requestId: string) => {
    dispatch(reduxActions.presentationRequestDeclined({
        requestId: requestId
    }));
};
```

---

## State Lifecycle Example

### Scenario: Alice requests presentation from Bob

```
1. Initial State
   Bob's state.presentationRequests = []

2. Alice sends presentation request
   → Bob's message listener receives request
   → dispatch(presentationRequestReceived(...))

   Bob's state.presentationRequests = [
       {
           id: 'msg-123',
           from: 'did:peer:alice...',
           requestMessage: { /* full message */ },
           timestamp: '2025-10-25T10:30:00.000Z',
           status: 'pending'  ← NEW REQUEST
       }
   ]

3. Bob's UI shows modal with pending request
   → User sees "Alice is requesting proof of your Security Clearance VC"

4a. Bob selects VC and sends presentation
    → dispatch(presentationRequestResponded({ requestId: 'msg-123' }))

    Bob's state.presentationRequests = [
        {
            id: 'msg-123',
            from: 'did:peer:alice...',
            requestMessage: { /* full message */ },
            timestamp: '2025-10-25T10:30:00.000Z',
            status: 'sent'  ← UPDATED
        }
    ]

4b. OR Bob declines request
    → dispatch(presentationRequestDeclined({ requestId: 'msg-123' }))

    Bob's state.presentationRequests = [
        {
            id: 'msg-123',
            from: 'did:peer:alice...',
            requestMessage: { /* full message */ },
            timestamp: '2025-10-25T10:30:00.000Z',
            status: 'declined'  ← UPDATED
        }
    ]

5. Periodic cleanup (7 days later)
   → dispatch(clearOldPresentationRequests({ olderThan: '2025-11-01T00:00:00.000Z' }))

   Bob's state.presentationRequests = []  ← OLD REQUEST REMOVED
```

---

## UI Component Example

### Complete Modal Component

```typescript
import React, { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { reduxActions } from '@/reducers/app';
import type { RootState, PresentationRequest } from '@/reducers/app';
import SDK from '@hyperledger/identus-edge-agent-sdk';

export const PresentationRequestModal: React.FC = () => {
    const dispatch = useDispatch();
    const [selectedVC, setSelectedVC] = useState<string | null>(null);

    // Get pending requests from Redux
    const pendingRequests = useSelector((state: RootState) =>
        state.presentationRequests.filter(req => req.status === 'pending')
    );

    // Get available credentials
    const credentials = useSelector((state: RootState) => state.credentials);
    const agent = useSelector((state: RootState) => state.agent.instance);

    if (pendingRequests.length === 0) return null;

    const currentRequest = pendingRequests[0]; // Show first pending request

    const handleSend = async () => {
        if (!selectedVC || !agent) return;

        try {
            const credential = credentials.find(c => c.id === selectedVC);
            if (!credential) throw new Error('Credential not found');

            // Send presentation
            const presentation = await agent.preparePresentation(
                currentRequest.requestMessage,
                credential
            );
            await agent.sendMessage(presentation);

            // Update state
            dispatch(reduxActions.presentationRequestResponded({
                requestId: currentRequest.id
            }));

            alert('✅ Presentation sent successfully!');
        } catch (error) {
            console.error('Failed to send presentation:', error);
            alert('❌ Failed to send presentation');
        }
    };

    const handleDecline = () => {
        dispatch(reduxActions.presentationRequestDeclined({
            requestId: currentRequest.id
        }));
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2>Presentation Request</h2>
                <p>From: {currentRequest.from}</p>
                <p>Received: {new Date(currentRequest.timestamp).toLocaleString()}</p>

                <h3>Select a Credential to Share:</h3>
                <select
                    value={selectedVC || ''}
                    onChange={(e) => setSelectedVC(e.target.value)}
                >
                    <option value="">-- Select Credential --</option>
                    {credentials.map(cred => (
                        <option key={cred.id} value={cred.id}>
                            {cred.credentialSubject?.type || 'Unknown Credential'}
                        </option>
                    ))}
                </select>

                <div className="modal-actions">
                    <button onClick={handleSend} disabled={!selectedVC}>
                        Send Presentation
                    </button>
                    <button onClick={handleDecline}>
                        Decline Request
                    </button>
                </div>
            </div>
        </div>
    );
};
```

---

## Selectors for Common Queries

### Get Pending Requests Count

```typescript
const pendingCount = useSelector((state: RootState) =>
    state.presentationRequests.filter(req => req.status === 'pending').length
);
```

### Get Requests from Specific Sender

```typescript
const requestsFromAlice = useSelector((state: RootState) =>
    state.presentationRequests.filter(req =>
        req.from.includes('alice') && req.status === 'pending'
    )
);
```

### Get Request History

```typescript
const completedRequests = useSelector((state: RootState) =>
    state.presentationRequests.filter(req =>
        req.status === 'sent' || req.status === 'declined'
    )
);
```

---

## Files Modified

### Alice Wallet
**File**: `/root/clean-identus-wallet/sdk-v6-test/sdk-ts/demos/alice-wallet/src/reducers/app.ts`

**Lines Modified**:
- **157-174**: Added `PresentationRequestStatus` and `PresentationRequest` type definitions
- **192**: Added `presentationRequests: PresentationRequest[]` to `RootState`
- **118**: Initialized `presentationRequests: []` in `initialState`
- **294-351**: Added four reducer actions:
  - `presentationRequestReceived` (lines 295-312)
  - `presentationRequestResponded` (lines 313-324)
  - `presentationRequestDeclined` (lines 325-336)
  - `clearOldPresentationRequests` (lines 337-351)

### Bob Wallet
**File**: `/root/clean-identus-wallet/sdk-v6-test/sdk-ts/demos/bob-wallet/src/reducers/app.ts`

**Lines Modified**: (Identical to Alice wallet)
- **157-174**: Type definitions
- **192**: `RootState` update
- **118**: Initial state
- **294-351**: Reducer actions

---

## Action Names Available

When using `reduxActions` exported from the slice:

```typescript
import { reduxActions } from '@/reducers/app';

// Action creators available:
reduxActions.presentationRequestReceived(payload)
reduxActions.presentationRequestResponded(payload)
reduxActions.presentationRequestDeclined(payload)
reduxActions.clearOldPresentationRequests(payload)
```

Redux Toolkit automatically generates:
- Action creators
- Action type constants (e.g., `"app/presentationRequestReceived"`)
- TypeScript types for payloads

---

## TypeScript Types

All types are exported from `reducers/app.ts`:

```typescript
// Import types
import type {
    PresentationRequest,
    PresentationRequestStatus,
    RootState
} from '@/reducers/app';

// Use in component props
interface Props {
    request: PresentationRequest;
}

// Type-safe status checks
const isPending = (status: PresentationRequestStatus) => status === 'pending';
```

---

## Testing Strategy

### Unit Tests

```typescript
import appReducer, { initialState, reduxActions } from './reducers/app';

describe('Presentation Request Reducers', () => {
    it('should add presentation request', () => {
        const action = reduxActions.presentationRequestReceived({
            id: 'test-123',
            from: 'did:peer:test',
            requestMessage: {} as any,
            timestamp: '2025-10-25T10:00:00.000Z'
        });

        const newState = appReducer(initialState, action);

        expect(newState.presentationRequests).toHaveLength(1);
        expect(newState.presentationRequests[0].status).toBe('pending');
    });

    it('should mark request as sent', () => {
        const stateWithRequest = {
            ...initialState,
            presentationRequests: [{
                id: 'test-123',
                from: 'did:peer:test',
                requestMessage: {} as any,
                timestamp: '2025-10-25T10:00:00.000Z',
                status: 'pending' as const
            }]
        };

        const action = reduxActions.presentationRequestResponded({
            requestId: 'test-123'
        });

        const newState = appReducer(stateWithRequest, action);

        expect(newState.presentationRequests[0].status).toBe('sent');
    });
});
```

---

## Best Practices

### 1. Always Use ISO Timestamps
```typescript
// ✅ CORRECT
timestamp: new Date().toISOString()  // "2025-10-25T10:30:00.000Z"

// ❌ WRONG
timestamp: new Date().toString()     // "Fri Oct 25 2025 10:30:00"
```

### 2. Check Request Exists Before Updating
```typescript
// ✅ CORRECT
const request = presentationRequests.find(req => req.id === requestId);
if (request) {
    dispatch(reduxActions.presentationRequestResponded({ requestId }));
}

// ❌ WRONG - assumes request exists
dispatch(reduxActions.presentationRequestResponded({ requestId }));
```

### 3. Filter by Status in UI
```typescript
// ✅ CORRECT - only show pending
const pendingRequests = presentationRequests.filter(r => r.status === 'pending');

// ❌ WRONG - shows all requests
const allRequests = presentationRequests;
```

### 4. Cleanup Periodically
```typescript
// ✅ CORRECT - cleanup on mount
useEffect(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    dispatch(reduxActions.clearOldPresentationRequests({
        olderThan: thirtyDaysAgo.toISOString()
    }));
}, [dispatch]);
```

---

## Troubleshooting

### Issue: Requests not appearing in state

**Check**:
1. Message listener is calling `presentationRequestReceived`
2. Payload has all required fields (id, from, requestMessage, timestamp)
3. Redux DevTools shows action was dispatched

### Issue: Status not updating after sending

**Check**:
1. `requestId` matches the original request ID
2. Action is dispatched AFTER successful send
3. Request exists in array before update

### Issue: Old requests piling up

**Solution**:
- Call `clearOldPresentationRequests` periodically
- Consider adding cleanup on app startup
- Adjust threshold based on requirements (7 days, 30 days, etc.)

---

## Next Steps

1. **Implement Message Listener**: Add logic to detect presentation requests in message listener
2. **Create UI Modal**: Build React component to display pending requests
3. **VC Selection Logic**: Implement credential matching and selection
4. **Response Handling**: Integrate with SDK's presentation sending
5. **Error Handling**: Add try-catch and user feedback
6. **Testing**: Write unit tests for reducers and integration tests for workflow

---

## Related Documentation

- **Redux Toolkit**: https://redux-toolkit.js.org/
- **DIDComm Present Proof Protocol**: https://identity.foundation/didcomm-messaging/spec/#present-proof-protocol
- **Hyperledger Identus SDK**: https://github.com/hyperledger/identus-edge-agent-sdk-ts

---

**Document Version**: 1.0
**Implementation Date**: 2025-10-25
**Status**: Complete and Ready for Integration
**Both Wallets**: Alice and Bob have matching implementations
