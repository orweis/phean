export type DomainErrorCode = "invalid" | "not_found" | "forbidden" | "conflict";

/** An expected, user-facing failure. Adapters translate it to an MCP error result or a form message. */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const invalid = (message: string) => new DomainError("invalid", message);
export const forbidden = (message: string) => new DomainError("forbidden", message);
export const conflict = (message: string) => new DomainError("conflict", message);
export const notFound = (entity: string, id: string) =>
  new DomainError("not_found", `No ${entity} with id "${id}" in this workspace.`);

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
