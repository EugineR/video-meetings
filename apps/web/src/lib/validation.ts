/**
 * The single client-side email shape check, shared by `/login` and `/register`
 * so both surfaces accept and reject exactly the same addresses. Deliberately
 * permissive — the API validates the address for real; this only turns an
 * obvious typo into an inline message before a request is made.
 */
export const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
