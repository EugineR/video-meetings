import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Prisma's "record to update/delete not found" error code. */
const PRISMA_NOT_FOUND_CODE = 'P2025';

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  create(email: string, hashedPassword: string): Promise<User> {
    return this.prisma.user.create({
      data: { email, password: hashedPassword },
    });
  }

  /**
   * Returns `null` (instead of throwing) if the user row is already gone,
   * so callers can treat that as a normal "not found" rather than an
   * unhandled Prisma error.
   */
  async updateName(id: string, name: string | null): Promise<User | null> {
    try {
      return await this.prisma.user.update({ where: { id }, data: { name } });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === PRISMA_NOT_FOUND_CODE
      ) {
        return null;
      }
      throw err;
    }
  }
}
