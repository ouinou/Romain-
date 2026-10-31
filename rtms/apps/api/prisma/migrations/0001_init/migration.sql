-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret_enc" TEXT,
    "recovery_codes" JSONB NOT NULL DEFAULT '[]',
    "password_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "company_id" UUID NOT NULL,
    "role_key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("company_id","role_key","module","action")
);

-- CreateTable
CREATE TABLE "records" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "module" TEXT NOT NULL,
    "reference" TEXT,
    "status" TEXT,
    "data" JSONB NOT NULL,
    "computed" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" UUID,
    "cancel_reason" TEXT,

    CONSTRAINT "records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prev_hash" TEXT,
    "hash" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installation" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "installation_id" UUID NOT NULL,
    "license_token" TEXT,
    "last_check_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "licenses" (
    "id" UUID NOT NULL,
    "key_hash" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "max_devices" INTEGER NOT NULL DEFAULT 1,
    "max_users" INTEGER NOT NULL DEFAULT 10,
    "features" JSONB NOT NULL DEFAULT '[]',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_activations" (
    "id" UUID NOT NULL,
    "license_id" UUID NOT NULL,
    "installation_id" UUID NOT NULL,
    "device_hash" TEXT NOT NULL,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "license_activations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_events" (
    "id" BIGSERIAL NOT NULL,
    "license_id" UUID,
    "type" TEXT NOT NULL,
    "ip" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "license_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_company_id_idx" ON "users"("company_id");

-- CreateIndex
CREATE INDEX "records_company_id_module_created_at_idx" ON "records"("company_id", "module", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_company_id_at_idx" ON "audit_log"("company_id", "at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "installation_installation_id_key" ON "installation"("installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "licenses_key_hash_key" ON "licenses"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "license_activations_license_id_installation_id_device_hash_key" ON "license_activations"("license_id", "installation_id", "device_hash");

-- CreateIndex
CREATE INDEX "license_events_license_id_at_idx" ON "license_events"("license_id", "at" DESC);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "records" ADD CONSTRAINT "records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_activations" ADD CONSTRAINT "license_activations_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_events" ADD CONSTRAINT "license_events_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

