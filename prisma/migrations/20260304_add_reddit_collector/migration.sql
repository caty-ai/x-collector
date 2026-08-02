-- CreateTable
CREATE TABLE "reddit_sources" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "subreddit" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxPosts" INTEGER NOT NULL DEFAULT 25,
    "lastFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reddit_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reddit_posts" (
    "id" TEXT NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT,
    "url" TEXT NOT NULL,
    "author" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "upvoteRatio" DOUBLE PRECISION,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reddit_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reddit_sources_subreddit_key" ON "reddit_sources"("subreddit");

-- CreateIndex
CREATE INDEX "reddit_posts_sourceId_idx" ON "reddit_posts"("sourceId");

-- AddForeignKey
ALTER TABLE "reddit_posts" ADD CONSTRAINT "reddit_posts_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "reddit_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
