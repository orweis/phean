/** What Better Auth's error codes mean for the person, in words; never the raw code alone. */
const MESSAGES: Record<string, string> = {
  INVALID_CODE: "That code didn't match. Enter the newest code from your authenticator app.",
  INVALID_BACKUP_CODE: "That backup code didn't match, or it has been used already.",
  INVALID_TWO_FACTOR_COOKIE: "This sign-in has expired. Sign in again.",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "Too many wrong codes. Sign in again to start over.",
  ACCOUNT_TEMPORARILY_LOCKED: "Too many wrong codes. Wait a few minutes, then try again.",
  TOTP_ALREADY_ENABLED: "Two-factor is already on.",
  TWO_FACTOR_NOT_ENABLED: "Two-factor is not on.",
  INVALID_PASSWORD: "That password is not right.",
  PASSWORD_TOO_SHORT: "That password is too short.",
  PASSWORD_TOO_LONG: "That password is too long.",
  PASSWORD_ALREADY_SET: "You already have a password. Change it instead.",
  CREDENTIAL_ACCOUNT_NOT_FOUND: "You have no password yet. Set one first.",
  FAILED_TO_UNLINK_LAST_ACCOUNT: "That is your only way to sign in. Add another before you remove it.",
  ACCOUNT_NOT_FOUND: "That sign-in method is not connected.",
  SESSION_NOT_FRESH: "For your safety, sign out and sign in again before you change this.",
  // A provider callback's `error`, lower-case, when connecting GitHub or Google from the account page.
  account_already_linked_to_different_user: "That account already signs in to another Phean account.",
  "email_doesn't_match": "That account's email address does not match yours.",
  unable_to_link_account: "The provider has not verified that account's email address, so it could not be connected.",
  access_denied: "Connecting was cancelled at the provider.",
};

/** Better Auth's failure shape, as the client and server both report it. */
export interface AuthFailure {
  code?: string;
  message?: string;
  status?: number;
}

export function authErrorMessage(failure: AuthFailure | null | undefined, fallback = "Something went wrong. Please try again."): string {
  if (!failure) return fallback;
  if (failure.status === 429) return "Too many tries. Wait a few seconds, then try again.";
  return (failure.code && MESSAGES[failure.code]) ?? fallback;
}

/** The message for a provider callback's `error` query value, or null when there is none. */
export function callbackErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return MESSAGES[code] ?? "Connecting did not complete. Try again.";
}
