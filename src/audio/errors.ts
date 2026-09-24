/** Thrown for anything wrong with a user-supplied audio file: undecodable,
 * empty, wrong type. Never lets a decode failure surface as an unhandled
 * rejection (T-009). */
export class AudioInputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AudioInputError";
  }
}
