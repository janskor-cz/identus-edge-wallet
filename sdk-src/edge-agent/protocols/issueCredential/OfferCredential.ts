import { uuid } from "@stablelib/uuid";
import { AgentError } from "../../../domain/models/Errors";
import { AttachmentDescriptor, DID, Message } from "../../../domain";
import { ProtocolType } from "../ProtocolTypes";
import { CredentialPreview, validateCredentialPreview } from "./CredentialPreview";
import { isNil, isObject } from "../../../utils";

/**
 * Specification: 
 * https://github.com/decentralized-identity/waci-didcomm/tree/main/issue_credential#offer-credential
 */

export interface OfferCredentialBody {
  // optional field that indicates the goal of the message sender
  goal_code?: any;
  // an optional field to help coordinate credential replacement
  replacement_id?: string;
  // an optional field that provides human readable information about this Credential Offer
  comment?: string;
  // a JSON-LD object that represents the credential data that Issuer is willing to issue
  // Made optional to support Cloud Agent offers that may not include preview in body
  credential_preview?: CredentialPreview;
}

export class OfferCredential {
  public static type = ProtocolType.DidcommOfferCredential;

  constructor(
    public body: OfferCredentialBody,
    public attachments: AttachmentDescriptor[],
    public from?: DID,
    public to?: DID,
    public thid?: string,
    public id: string = uuid()
  ) {
    this.validate();
  }

  private validate() {
    // credential_preview is optional and may have various formats
    // Cloud Agent may send offers without preview or with non-standard preview formats
    // Actual credential data is in attachments, so no validation needed
  }

  makeMessage(): Message {
    const body = JSON.stringify(this.body);
    return new Message(
      body,
      this.id,
      OfferCredential.type,
      this.from,
      this.to,
      this.attachments,
      this.thid
    );
  }

  static fromMessage(msg: Message): OfferCredential {
    if (
      msg.piuri !== ProtocolType.DidcommOfferCredential
      || isNil(msg.from)
    ) {
      throw new AgentError.InvalidOfferCredentialMessageError(
        "Invalid offer credential message error."
      );
    }

    // Only validate that body is an object
    // credential_preview is optional - may be in attachments instead
    if (!isObject(msg.body)) {
      throw new AgentError.InvalidOfferCredentialBodyError("Invalid body");
    }

    return new OfferCredential(
      msg.body as any,
      msg.attachments,
      msg.from,
      msg.to,
      msg.thid,
      msg.id
    );
  }
}
