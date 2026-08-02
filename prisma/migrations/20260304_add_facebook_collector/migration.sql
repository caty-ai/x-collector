-- CreateTable
CREATE TABLE "FbSource" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'group',
    "url" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FbSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FbPost" (
    "postId" TEXT NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "author" TEXT NOT NULL,
    "authorId" TEXT,
    "authorUrl" TEXT,
    "text" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "reactionCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "image" TEXT,
    "topComments" JSONB,
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewStatus" TEXT NOT NULL DEFAULT 'new',
    "reviewNote" TEXT,
    "reviewedBy" TEXT,

    CONSTRAINT "FbPost_pkey" PRIMARY KEY ("postId")
);

-- CreateIndex
CREATE UNIQUE INDEX "FbSource_url_key" ON "FbSource"("url");

-- CreateIndex
CREATE INDEX "FbPost_sourceId_idx" ON "FbPost"("sourceId");

-- AddForeignKey
ALTER TABLE "FbPost" ADD CONSTRAINT "FbPost_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "FbSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
