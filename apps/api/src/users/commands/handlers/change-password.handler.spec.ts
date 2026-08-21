import { BadRequestException, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { TokenService } from '../../../auth/token.service';
import { UsersRepository } from '../../users.repository';
import { ChangePasswordCommand } from '../change-password.command';
import { ChangePasswordHandler } from './change-password.handler';

describe('ChangePasswordHandler', () => {
  const userId = 'user-1';
  const currentPassword = 'Password123!';
  const newPassword = 'NewPassword456!';

  let user: User;
  let findById: jest.Mock;
  let updatePassword: jest.Mock;
  let sign: jest.Mock;
  let handler: ChangePasswordHandler;

  beforeEach(async () => {
    user = {
      id: userId,
      email: 'owner@example.com',
      password: await bcrypt.hash(currentPassword, 4),
      name: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    findById = jest.fn().mockResolvedValue(user);
    updatePassword = jest.fn().mockResolvedValue(user);
    sign = jest.fn().mockReturnValue('signed-token');

    const usersRepository = {
      findById,
      updatePassword,
    } as unknown as UsersRepository;
    const tokenService = { sign } as unknown as TokenService;

    handler = new ChangePasswordHandler(usersRepository, tokenService);
  });

  it('rejects a wrong current password and never persists a new one', async () => {
    await expect(
      handler.execute(
        new ChangePasswordCommand(userId, 'WrongPassword!', newPassword),
      ),
    ).rejects.toThrow(BadRequestException);

    expect(updatePassword).not.toHaveBeenCalled();
  });

  it('rejects a new password equal to the current one', async () => {
    await expect(
      handler.execute(
        new ChangePasswordCommand(userId, currentPassword, currentPassword),
      ),
    ).rejects.toThrow(BadRequestException);

    expect(updatePassword).not.toHaveBeenCalled();
  });

  it('hashes and persists the new password, returning a freshly signed token', async () => {
    const result = await handler.execute(
      new ChangePasswordCommand(userId, currentPassword, newPassword),
    );

    expect(updatePassword).toHaveBeenCalledWith(userId, expect.any(String));
    const [, storedHash] = updatePassword.mock.calls[0] as [string, string];
    await expect(bcrypt.compare(newPassword, storedHash)).resolves.toBe(true);

    expect(sign).toHaveBeenCalledWith(userId, user.email);
    expect(result).toEqual({ accessToken: 'signed-token' });
  });

  it('throws NotFoundException when the user no longer exists', async () => {
    findById.mockResolvedValue(null);

    await expect(
      handler.execute(
        new ChangePasswordCommand(userId, currentPassword, newPassword),
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
