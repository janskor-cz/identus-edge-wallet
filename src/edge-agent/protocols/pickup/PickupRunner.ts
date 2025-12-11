import { AttachmentDescriptor, Message } from "../../../domain";
import { Mercury } from "../../../domain/buildingBlocks/Mercury";
import { AgentError, MercuryError } from "../../../domain/models/Errors";
import { ProtocolType } from "../ProtocolTypes";
import { PickupAttachment } from "../types";

type PickupResponse =
  | { type: "status"; message: Message }
  | { type: "delivery"; message: Message }
  | { type: 'report', message: Message };

export class PickupRunner {
  private message: PickupResponse;
  private mercury: Mercury;

  constructor(message: Message, mercury: Mercury) {
    switch (message.piuri) {
      case ProtocolType.PickupStatus:
        this.message = { type: "status", message: message };
        break;
      case ProtocolType.PickupDelivery:
        this.message = { type: "delivery", message: message };
        break;
      case ProtocolType.ProblemReporting:
        this.message = { type: "report", message: message };
        break;
      default:
        throw new AgentError.InvalidPickupDeliveryMessageError();
    }
    this.mercury = mercury;
  }

  private processAttachment(
    attachment: AttachmentDescriptor
  ): PickupAttachment | null {
    if (Message.isBase64Attachment(attachment.data)) {
      return {
        attachmentId: attachment.id,
        data: Buffer.from(attachment.data.base64, "base64").toString("utf8"),
      };
    } else if (Message.isJsonAttachment(attachment.data)) {
      return {
        attachmentId: attachment.id,
        data: "data" in attachment.data ?
          JSON.stringify(attachment.data.data) :
          JSON.stringify(attachment.data.json),
      };
    }

    return null;
  }

  private filterNullAttachments(
    attachment: PickupAttachment | null
  ): attachment is PickupAttachment {
    return attachment !== null;
  }

  async run(): Promise<Array<{ attachmentId: string; message: Message }>> {
    if (this.message.type === "delivery") {
      // 🔧 FIX #9: Use Promise.allSettled to gracefully handle DIDComm decryption failures
      // Some messages may fail to decrypt if peer DID keys aren't persisted yet
      // This is normal during connection establishment - failed messages will be retried on next poll
      const results = await Promise.allSettled(
        this.message.message.attachments
          .map(this.processAttachment)
          .filter(this.filterNullAttachments)
          .map(async (attachment) => ({
            attachmentId: attachment.attachmentId,
            message: await this.mercury.unpackMessage(attachment.data),
          }))
      );

      // Filter out failed decryptions and log warnings
      const successfulMessages = results
        .filter((result) => {
          if (result.status === 'rejected') {
            // Check if it's a DIDCommDecryptionError (expected, non-fatal)
            if (result.reason instanceof MercuryError.DIDCommDecryptionError) {
              console.warn('⚠️ [PickupRunner] Message decryption deferred - will retry on next poll');
              console.warn(`⚠️ [PickupRunner] Reason: ${result.reason.message}`);
            } else {
              // Unexpected error - log as error
              console.error('❌ [PickupRunner] Unexpected message unpacking failure:', result.reason);
            }
            return false;
          }
          return true;
        })
        .map((result) => (result as PromiseFulfilledResult<{ attachmentId: string; message: Message }>).value);

      return successfulMessages;
    } else if (this.message.type === "report") {
      return [
        {
          attachmentId: this.message.message.id,
          message: this.message.message
        }
      ]
    }

    return [];
  }
}
