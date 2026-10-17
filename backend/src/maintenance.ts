import type { AppDatabase } from "./db";

const nowIso = (): string => new Date().toISOString();

export function cleanupExpiredDeletedAccounts(database: AppDatabase): number {
  database
    .query("DELETE FROM recovery_challenges WHERE expires_at <= ?")
    .run(Date.now());
  database
    .query("DELETE FROM recovery_email_cooldowns WHERE last_sent_at < ?")
    .run(Date.now() - 3 * 24 * 60 * 60_000);
  database
    .query(
      "DELETE FROM moderation_evidence WHERE expires_at IS NOT NULL AND expires_at <= ?",
    )
    .run(nowIso());
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const accounts = database
    .query(
      "SELECT id FROM users WHERE account_status = 'deleting' AND deleted_at IS NOT NULL AND deleted_at <= ? AND account_cleanup_completed_at IS NULL",
    )
    .all(cutoff) as { id: string }[];
  for (const { id } of accounts) {
    const now = nowIso();
    database.transaction(() => {
      database
        .query(
          "UPDATE course_reviews SET content = '内容已删除', tags_json = '[]', author_label = '匿名同学' WHERE user_id = ? AND deleted_at IS NOT NULL",
        )
        .run(id);
      database
        .query(
          "UPDATE market_listings SET title = '已删除商品', description = '', location = '', images_json = '[]', moderation_status = 'removed' WHERE seller_id = ? AND deleted_at IS NOT NULL",
        )
        .run(id);
      database
        .query(
          "UPDATE skill_posts SET title = '已删除技能帖', description = '', tags_json = '[]', can_offer = '', wants = '', moderation_status = 'removed' WHERE user_id = ? AND deleted_at IS NOT NULL",
        )
        .run(id);
      database
        .query(
          "UPDATE tree_posts SET content = '内容已删除', topic = '校园生活', moderation_status = 'removed' WHERE user_id = ? AND deleted_at IS NOT NULL",
        )
        .run(id);
      database
        .query(
          "UPDATE content_comments SET content = '评论已删除', user_id = NULL, status = 'removed', updated_at = ? WHERE user_id = ? AND deleted_at IS NOT NULL",
        )
        .run(now, id);
      database
        .query("DELETE FROM content_revisions WHERE editor_id = ?")
        .run(id);
      database.query("DELETE FROM content_favorites WHERE user_id = ?").run(id);
      database
        .query("DELETE FROM user_blocks WHERE blocker_id = ? OR blocked_id = ?")
        .run(id, id);
      database
        .query("DELETE FROM notification_preferences WHERE user_id = ?")
        .run(id);
      database.query("DELETE FROM notifications WHERE user_id = ?").run(id);
      database
        .query(
          "UPDATE email_outbox SET recipient = '', subject = 'Account deleted', text_body = '', user_id = NULL, status = 'failed' WHERE user_id = ?",
        )
        .run(id);
      database
        .query(
          "UPDATE users SET email = NULL, email_verified = 0, department = '', display_name = '已注销用户', account_cleanup_completed_at = ?, updated_at = ? WHERE id = ? AND account_status = 'deleting'",
        )
        .run(now, now, id);
    })();
  }
  return accounts.length;
}
