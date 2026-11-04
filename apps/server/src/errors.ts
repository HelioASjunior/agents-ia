export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', `${what} não encontrado.`);
export const badRequest = (message: string, code = 'bad_request') => new AppError(400, code, message);
export const conflict = (message: string, code = 'conflict') => new AppError(409, code, message);
