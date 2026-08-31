/**
 * The client-side email shape check behind `validateEmail`. Deliberately permissive — the API
 * validates the address for real; this only turns an obvious typo into an inline message before
 * a request is made. Module-private on purpose: a caller gets the rule through `validateEmail`,
 * so `/login` and `/register` cannot drift apart on the pattern *or* on the wording.
 */
const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

/**
 * Mirrors `MIN_PASSWORD_LENGTH` in `apps/api/src/auth/password-rules.ts`, which backs both
 * `RegisterDto` and `ChangePasswordDto`. Exported for the `minLength` attribute; the rule itself
 * is `validatePasswordLength` below.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Mirrors `@MaxLength(100)` on `name` in `apps/api/src/users/dto/update-profile.dto.ts`, so the
 * display-name field stops accepting characters at the point the API would start rejecting them.
 */
export const MAX_DISPLAY_NAME_LENGTH = 100;

/** The hint under every field that sets a new password — one sentence, stated once. */
export const PASSWORD_LENGTH_HINT = `Must be at least ${MIN_PASSWORD_LENGTH} characters.`;

/**
 * The email rule shared by `/login` and `/register`, message included: a blank field and a
 * malformed address are distinguished, because "Email is required" on a typo helps nobody.
 */
export function validateEmail(value: string): string | null {
  if (!value) return 'Email is required';
  return EMAIL_PATTERN.test(value)
    ? null
    : 'Please enter a valid email address';
}

/**
 * The minimum-length rule shared by `/register` and `PasswordSection`, message included, so the
 * API's minimum is stated once on the client. Checking it here is also what keeps a 400 from
 * `PUT /users/me/password` unambiguous — see `PasswordSection`.
 */
export function validatePasswordLength(value: string): string | null {
  return value.length >= MIN_PASSWORD_LENGTH
    ? null
    : `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
}
