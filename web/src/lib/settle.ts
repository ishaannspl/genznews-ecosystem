import { RepositoryError } from "./repository";

/**
 * Resolves to the value, or to `null` when the read failed with a RepositoryError,
 * so a per-request page can render ErrorState inline. Any other error is rethrown.
 */
export async function orNullOnRepositoryError<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof RepositoryError) return null;
    throw error;
  }
}
