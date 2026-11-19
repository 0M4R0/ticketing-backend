type AuthenticatedUser = {
  id: number;
  role: "user" | "admin" | "organizador";
  sessionId: number;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
