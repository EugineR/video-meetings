import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  ProfileResponse,
  toProfileResponse,
} from '../../interfaces/profile-response.interface';
import { UsersRepository } from '../../users.repository';
import { GetProfileQuery } from '../get-profile.query';

@QueryHandler(GetProfileQuery)
export class GetProfileHandler implements IQueryHandler<
  GetProfileQuery,
  ProfileResponse
> {
  constructor(private readonly usersRepository: UsersRepository) {}

  async execute(query: GetProfileQuery): Promise<ProfileResponse> {
    const user = await this.usersRepository.findById(query.userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return toProfileResponse(user);
  }
}
