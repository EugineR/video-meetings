import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class TokenService {
  constructor(private readonly jwtService: JwtService) {}

  sign(userId: string, email: string): string {
    return this.jwtService.sign({ sub: userId, email });
  }
}
