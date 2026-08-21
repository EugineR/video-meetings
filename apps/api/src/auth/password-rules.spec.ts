import {
  isDifferentFromCurrent,
  meetsMinimumLength,
  MIN_PASSWORD_LENGTH,
} from './password-rules';

describe('meetsMinimumLength', () => {
  it('accepts a password at exactly the minimum length', () => {
    expect(meetsMinimumLength('a'.repeat(MIN_PASSWORD_LENGTH))).toBe(true);
  });

  it('accepts a password longer than the minimum length', () => {
    expect(meetsMinimumLength('a'.repeat(MIN_PASSWORD_LENGTH + 1))).toBe(true);
  });

  it('rejects a password shorter than the minimum length', () => {
    expect(meetsMinimumLength('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe(false);
  });
});

describe('isDifferentFromCurrent', () => {
  it('accepts a new password that differs from the current one', () => {
    expect(isDifferentFromCurrent('NewPassword456!', 'Password123!')).toBe(
      true,
    );
  });

  it('rejects a new password equal to the current one', () => {
    expect(isDifferentFromCurrent('Password123!', 'Password123!')).toBe(false);
  });
});
