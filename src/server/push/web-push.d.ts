// web-push 4 ships no types; this covers the part Phean uses.
declare module "web-push" {
  export interface PushSubscription {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }

  export interface RequestOptions {
    vapidDetails: { subject: string; publicKey: string; privateKey: string };
    TTL?: number;
    urgency?: "very-low" | "low" | "normal" | "high";
    topic?: string;
    contentEncoding?: "aes128gcm" | "aesgcm";
  }

  export interface RequestDetails {
    method: "POST";
    headers: Record<string, string | number>;
    body: Buffer | null;
    endpoint: string;
  }

  export function generateRequestDetails(subscription: PushSubscription, payload: string | Buffer, options: RequestOptions): RequestDetails;
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
}
