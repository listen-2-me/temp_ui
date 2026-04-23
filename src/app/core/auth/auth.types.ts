export interface AuthTokens {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  tokenType: string;
}

export interface OtpInitResponse {
  status: 'otp_sent' | string;
}

export interface User {
  id?: string;
  phoneNumber?: string;
  [key: string]: unknown;
}

export type AuthMode = 'login' | 'register';
