-- CreateTable
CREATE TABLE "ig_sources" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ig_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ig_posts" (
    "id" TEXT NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "caption" TEXT,
    "url" TEXT NOT NULL,
    "imageUrl" TEXT,
    "mediaType" TEXT,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ig_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ig_sources_handle_key" ON "ig_sources"("handle");

-- CreateIndex
CREATE INDEX "ig_posts_sourceId_idx" ON "ig_posts"("sourceId");

-- AddForeignKey
ALTER TABLE "ig_posts" ADD CONSTRAINT "ig_posts_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ig_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
