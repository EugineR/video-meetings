export class CreateUserCommand {
  constructor(
    public readonly name: string,
    public readonly email: string,
    public readonly hashedPassword: string,
  ) {}
}
