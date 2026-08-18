import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

  updateName(id: string, name: string | null): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { name } });
  }
}
