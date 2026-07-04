-- CreateTable article_blocks
CREATE TABLE "article_blocks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "article_id" INTEGER NOT NULL,
    "block_type" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "article_blocks_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "news_events" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "article_blocks_article_id_idx" ON "article_blocks"("article_id");
