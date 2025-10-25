-- PostgreSQL baseline migration for sessions table
CREATE TABLE IF NOT EXISTS "sessions" (
  "id" TEXT PRIMARY KEY,
  "shop" TEXT NOT NULL,
  "state" TEXT,
  "isOnline" BOOLEAN NOT NULL DEFAULT FALSE,
  "scope" TEXT,
  "expires" TIMESTAMP(3),
  "accessToken" TEXT NOT NULL,
  "userId" BIGINT,
  "firstName" TEXT,
  "lastName" TEXT,
  "email" TEXT,
  "accountOwner" BOOLEAN NOT NULL DEFAULT FALSE,
  "locale" TEXT,
  "collaborator" BOOLEAN NOT NULL DEFAULT FALSE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "sessions_shop_key" ON "sessions"("shop");
