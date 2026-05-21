export type RegisterRequest = {
  nickname: string;
  password: string;
  passwordConfirm: string;
};

export type AuthUser = {
  id: string;
  nickname: string;
  createdAt: number;
};

export type RegisterResponse =
  | {
      ok: true;
      user: AuthUser;
    }
  | {
      ok: false;
      message: string;
    };
