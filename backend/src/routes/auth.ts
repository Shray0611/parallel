import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { registerSchema, loginSchema } from "../validations/auth.js";
import { env } from "../config/env.js";
import { requireAuth, AuthenticatedUser } from "../middleware/auth.js";
import { isDbConnected } from "../config/db.js";
import { inMemoryUsers, ensureDemoUser } from "../demo/seedUser.js";

export const authRouter = Router();

// Helper to generate JWT
function generateToken(user: AuthenticatedUser): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    },
    env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// POST /api/auth/register
authRouter.post("/register", async (req: Request, res: Response): Promise<void> => {
  const parseResult = registerSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: {
        message: parseResult.error.errors[0]?.message || "Invalid registration data",
        code: "VALIDATION_ERROR"
      }
    });
    return;
  }

  const { email, password, name, role } = parseResult.data;
  const normalizedEmail = email.toLowerCase().trim();

  // If MongoDB is connected
  if (isDbConnected()) {
    try {
      const existing = await User.findOne({ email: normalizedEmail });
      if (existing) {
        res.status(409).json({
          error: {
            message: "User with this email already exists",
            code: "EMAIL_ALREADY_EXISTS"
          }
        });
        return;
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      const user = await User.create({
        email: normalizedEmail,
        passwordHash,
        name,
        role
      });

      const tokenUser: AuthenticatedUser = {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role
      };

      const token = generateToken(tokenUser);

      res.status(201).json({
        token,
        user: tokenUser
      });
      return;
    } catch (err: any) {
      res.status(500).json({
        error: {
          message: err.message || "Failed to register user",
          code: "REGISTRATION_FAILED"
        }
      });
      return;
    }
  }

  // Fallback in-memory
  if (inMemoryUsers.has(normalizedEmail)) {
    res.status(409).json({
      error: {
        message: "User with this email already exists",
        code: "EMAIL_ALREADY_EXISTS"
      }
    });
    return;
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);
  const id = `user-${Date.now()}`;

  const tokenUser: AuthenticatedUser = {
    id,
    email: normalizedEmail,
    name,
    role
  };

  inMemoryUsers.set(normalizedEmail, {
    id,
    email: normalizedEmail,
    passwordHash,
    name,
    role
  });

  const token = generateToken(tokenUser);
  res.status(201).json({
    token,
    user: tokenUser
  });
});

// POST /api/auth/login
authRouter.post("/login", async (req: Request, res: Response): Promise<void> => {
  const parseResult = loginSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: {
        message: parseResult.error.errors[0]?.message || "Invalid credentials format",
        code: "VALIDATION_ERROR"
      }
    });
    return;
  }

  const { email, password } = parseResult.data;
  const normalizedEmail = email.toLowerCase().trim();

  // Ensure demo user is seeded
  await ensureDemoUser();

  // Try DB first if connected
  if (isDbConnected()) {
    try {
      const user = await User.findOne({ email: normalizedEmail });
      if (!user) {
        res.status(401).json({
          error: {
            message: "Invalid email or password",
            code: "INVALID_CREDENTIALS"
          }
        });
        return;
      }

      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        res.status(401).json({
          error: {
            message: "Invalid email or password",
            code: "INVALID_CREDENTIALS"
          }
        });
        return;
      }

      const tokenUser: AuthenticatedUser = {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role
      };

      const token = generateToken(tokenUser);
      res.json({
        token,
        user: tokenUser
      });
      return;
    } catch (err: any) {
      res.status(500).json({
        error: {
          message: err.message || "Failed to log in",
          code: "LOGIN_FAILED"
        }
      });
      return;
    }
  }

  // Fallback in-memory
  const memoryUser = inMemoryUsers.get(normalizedEmail);
  if (!memoryUser) {
    res.status(401).json({
      error: {
        message: "Invalid email or password",
        code: "INVALID_CREDENTIALS"
      }
    });
    return;
  }

  const isMatch = await bcrypt.compare(password, memoryUser.passwordHash);
  if (!isMatch) {
    res.status(401).json({
      error: {
        message: "Invalid email or password",
        code: "INVALID_CREDENTIALS"
      }
    });
    return;
  }

  const tokenUser: AuthenticatedUser = {
    id: memoryUser.id,
    email: memoryUser.email,
    name: memoryUser.name,
    role: memoryUser.role
  };

  const token = generateToken(tokenUser);
  res.json({
    token,
    user: tokenUser
  });
});

// GET /api/auth/me
authRouter.get("/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  res.json({
    user: req.user
  });
});
