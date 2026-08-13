import {
  IsArray,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsString,
} from 'class-validator';

export class CreateMeetingDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsDateString()
  date: string;

  @IsArray()
  @IsEmail({}, { each: true })
  participants: string[];
}
