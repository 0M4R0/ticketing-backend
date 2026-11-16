declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        role: "user" | "admin" | "organizador";
        sessionId: number;
      };
    }
  }
}

export {};
