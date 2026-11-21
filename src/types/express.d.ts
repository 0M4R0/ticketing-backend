type AuthenticatedUser = {
  id: string;
  role: "user" | "admin" | "organizador";
  sessionId: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
