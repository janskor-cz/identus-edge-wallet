export class InvalidURLError extends Error {
  constructor(message?: string) {
    super(message || "Invalid URL error occurred");
  }
}

export class NoSenderDIDSetError extends Error {
  constructor(message?: string) {
    super(message || "No sender DID set error occurred");
  }
}

export class NoRecipientDIDSetError extends Error {
  constructor(message?: string) {
    super(message || "No recipient DID set error occurred");
  }
}

export class NoDIDReceiverSetError extends Error {
  constructor(message?: string) {
    super(message || "No DID receiver set error occurred");
  }
}

export class NoValidServiceFoundError extends Error {
  constructor(message?: string) {
    super(message || "No valid service found error occurred");
  }
}

export class FromFieldNotSetError extends Error {
  constructor(message?: string) {
    super(message || "From field not set error occurred");
  }
}

export class UnknownAttachmentDataError extends Error {
  constructor(message?: string) {
    super(message || "Unknown attachment data error occurred");
  }
}

export class MessageAttachmentWithoutIDError extends Error {
  constructor(message?: string) {
    super(message || "Message attachment without ID error occurred");
  }
}

export class MessageInvalidBodyDataError extends Error {
  constructor(message?: string) {
    super(message || "Message invalid body data error occurred");
  }
}

export class UnknownPackingMessageError extends Error {
  constructor(message?: string) {
    super(message || "Unknown packing message error occurred");
  }
}

export class CouldNotResolveDIDError extends Error {
  constructor(message?: string) {
    super(message || "Could not resolve DID error occurred");
  }
}

export class DidCommError extends Error {
  constructor(message?: string) {
    super(message || "DID communication error occurred");
  }
}

export class UrlSessionError extends Error {
  statusCode: number;
  error?: Error;

  constructor(message?: string, statusCode?: number, error?: Error) {
    super(message || "URL session error occurred");
    this.statusCode = statusCode || 500;
    this.error = error;
  }
}

/**
 * DIDCommDecryptionError
 *
 * Thrown when DIDComm message decryption fails due to missing recipient secrets/keys.
 * This is a NON-FATAL error that occurs during connection establishment when encrypted
 * messages arrive before peer DID keys are persisted to storage.
 *
 * The SDK will retry decryption on the next message poll when keys become available.
 */
export class DIDCommDecryptionError extends Error {
  constructor(message?: string) {
    super(message || "DIDComm message decryption deferred - recipient keys not yet available");
    this.name = "DIDCommDecryptionError";
  }
}
