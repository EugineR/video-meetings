import {
  assertKnownAvatarMimeTypes,
  isAllowedAvatarFile,
  parseAllowedMimeTypes,
} from './avatar-file-filter';

describe('parseAllowedMimeTypes', () => {
  it('splits, trims and drops empty entries', () => {
    expect(
      parseAllowedMimeTypes(' image/jpeg, image/png ,, image/webp'),
    ).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });
});

describe('isAllowedAvatarFile', () => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];

  it('accepts a MIME type + matching extension pair on the allowlist', () => {
    expect(isAllowedAvatarFile('image/png', 'avatar.png', allowed)).toBe(true);
  });

  it('accepts both .jpg and .jpeg extensions for image/jpeg', () => {
    expect(isAllowedAvatarFile('image/jpeg', 'avatar.jpg', allowed)).toBe(true);
    expect(isAllowedAvatarFile('image/jpeg', 'avatar.jpeg', allowed)).toBe(
      true,
    );
  });

  it('rejects a MIME type not on the allowlist', () => {
    expect(isAllowedAvatarFile('text/plain', 'notes.txt', allowed)).toBe(false);
  });

  it('rejects an allowlisted MIME type paired with the wrong extension', () => {
    expect(isAllowedAvatarFile('image/png', 'avatar.exe', allowed)).toBe(false);
  });

  it('rejects a disallowed MIME type paired with an allowlisted extension', () => {
    expect(isAllowedAvatarFile('image/gif', 'avatar.png', allowed)).toBe(false);
  });

  it('is case-insensitive on the extension', () => {
    expect(isAllowedAvatarFile('image/png', 'AVATAR.PNG', allowed)).toBe(true);
  });
});

describe('assertKnownAvatarMimeTypes', () => {
  it('does not throw for MIME types with a known extension mapping', () => {
    expect(() =>
      assertKnownAvatarMimeTypes(['image/jpeg', 'image/png', 'image/webp']),
    ).not.toThrow();
  });

  it('throws for a MIME type with no known extension mapping', () => {
    expect(() =>
      assertKnownAvatarMimeTypes(['image/png', 'image/gif']),
    ).toThrow(/image\/gif/);
  });
});
