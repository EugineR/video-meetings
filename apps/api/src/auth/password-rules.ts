export const PASSWORD_SALT_ROUNDS = 10;
export const MIN_PASSWORD_LENGTH = 8;

export function meetsMinimumLength(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}

export function isDifferentFromCurrent(
  newPassword: string,
  currentPassword: string,
): boolean {
  return newPassword !== currentPassword;
}
