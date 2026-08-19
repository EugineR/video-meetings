import { IsString, MinLength } from 'class-validator';
import { MIN_PASSWORD_LENGTH } from '../../auth/password-rules';

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  newPassword: string;
}
