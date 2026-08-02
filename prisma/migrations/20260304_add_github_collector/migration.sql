-- CreateTable
CREATE TABLE "gh_sources" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'repo',
    "repo" TEXT,
    "query" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gh_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gh_items" (
    "id" TEXT NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'release',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "url" TEXT NOT NULL,
    "author" TEXT,
    "tagName" TEXT,
    "stars" INTEGER,
    "forks" INTEGER,
    "language" TEXT,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gh_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gh_sources_type_repo_key" ON "gh_sources"("type", "repo");

-- CreateIndex
CREATE INDEX "gh_items_sourceId_idx" ON "gh_items"("sourceId");

-- AddForeignKey
ALTER TABLE "gh_items" ADD CONSTRAINT "gh_items_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "gh_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
