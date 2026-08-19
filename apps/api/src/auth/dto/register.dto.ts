import { IsEmail, IsString, MinLength } from 'class-validator';
import { MIN_PASSWORD_LENGTH } from '../password-rules';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  password: string;
}
