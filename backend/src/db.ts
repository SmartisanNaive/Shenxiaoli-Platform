import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";

export type AppDatabase = Database;
export const SCHEMA_VERSION = 10;

export interface DatabaseOptions {
  path?: string;
  seedDemoUsers?: boolean;
  migrate?: boolean;
}

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  department TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('student', 'moderator')),
  is_admin INTEGER NOT NULL DEFAULT 0,
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'banned', 'deleting')),
  suspended_until TEXT,
  deleted_at TEXT,
  account_cleanup_completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  english_title TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  course_type TEXT NOT NULL DEFAULT '',
  enrollment_type TEXT NOT NULL DEFAULT '',
  credits REAL NOT NULL DEFAULT 0,
  term TEXT NOT NULL DEFAULT '',
  assessment TEXT NOT NULL DEFAULT '',
  difficulty REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS course_reviews (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  offering_id TEXT REFERENCES course_offerings(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_label TEXT NOT NULL DEFAULT '匿名同学',
  rating REAL NOT NULL CHECK (rating >= 1 AND rating <= 10),
  difficulty REAL NOT NULL CHECK (difficulty >= 1 AND difficulty <= 5),
  workload REAL NOT NULL CHECK (workload >= 1 AND workload <= 5),
  content TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  term TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('visible', 'hidden', 'removed')),
  deleted_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS course_review_once_idx
  ON course_reviews(course_id, user_id, term) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS course_reviews_public_idx
  ON course_reviews(course_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS market_listings (
  id TEXT PRIMARY KEY,
  seller_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL CHECK (price >= 0),
  condition TEXT NOT NULL,
  location TEXT NOT NULL,
  description TEXT NOT NULL,
  images_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('active', 'reserved', 'sold', 'removed')),
  moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('visible', 'hidden', 'removed')),
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS listings_public_idx
  ON market_listings(status, created_at DESC);

CREATE TABLE IF NOT EXISTS skill_posts (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('offer', 'request')),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  can_offer TEXT NOT NULL DEFAULT '',
  wants TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('active', 'hidden', 'removed')),
  moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('visible', 'hidden', 'removed')),
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS skill_posts_public_idx ON skill_posts(status, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS tree_posts (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '校园生活',
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('visible', 'hidden', 'removed')),
  deleted_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tree_posts_public_idx ON tree_posts(status, created_at DESC);

CREATE TABLE IF NOT EXISTS tree_reactions (
  post_id TEXT NOT NULL REFERENCES tree_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS contact_requests (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('listing', 'skill')),
  target_id TEXT NOT NULL,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS contacts_recipient_idx ON contact_requests(recipient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('tree-hole', 'review', 'listing', 'skill', 'comment', 'message')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at TEXT NOT NULL,
  UNIQUE (reporter_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_audit (
  id TEXT PRIMARY KEY,
  moderator_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  expiresAt INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(userId);
CREATE TABLE IF NOT EXISTS auth_accounts (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt INTEGER,
  refreshTokenExpiresAt INTEGER,
  scope TEXT,
  password TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_accounts_user_idx ON auth_accounts(userId);
CREATE TABLE IF NOT EXISTS auth_verifications (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER,
  updatedAt INTEGER
);
CREATE INDEX IF NOT EXISTS auth_verifications_identifier_idx ON auth_verifications(identifier);
CREATE TABLE IF NOT EXISTS auth_email_cooldowns (
  email_hash TEXT PRIMARY KEY,
  last_sent_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS account_deletion_codes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback_rate_limits (
  source_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  contact_request_id TEXT NOT NULL UNIQUE REFERENCES contact_requests(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_message_at TEXT
);
CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TEXT,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conversations_participant_idx ON conversation_participants(user_id, conversation_id);
CREATE TABLE IF NOT EXISTS contact_conversation_links (
  request_id TEXT PRIMARY KEY REFERENCES contact_requests(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (sender_id, client_id)
);
CREATE INDEX IF NOT EXISTS messages_history_idx ON messages(conversation_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS content_comments (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('review', 'listing', 'skill', 'tree-hole')),
  target_id TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  parent_id TEXT REFERENCES content_comments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'removed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS comments_target_idx ON content_comments(target_type, target_id, created_at);
CREATE TABLE IF NOT EXISTS content_favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('course', 'review', 'listing', 'skill', 'tree-hole')),
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS favorites_user_idx ON content_favorites(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS content_revisions (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  editor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  href TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  social_email_enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TEXT NOT NULL,
  last_error TEXT NOT NULL DEFAULT '',
  resend_id TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS email_outbox_pending_idx ON email_outbox(status, run_after);
CREATE TABLE IF NOT EXISTS email_webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  resend_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS moderation_cases (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_moderator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'actioned', 'dismissed', 'appealed', 'reinstated')),
  action TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  appeal_reason TEXT NOT NULL DEFAULT '',
  appellant_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  appeal_reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  appeal_outcome TEXT NOT NULL DEFAULT '',
  report_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_penalties (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
  penalty_type TEXT NOT NULL CHECK (penalty_type IN ('warning', 'mute', 'ban')),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS penalties_user_idx ON user_penalties(user_id, revoked_at, ends_at);

CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS teachers_name_idx ON teachers(name);
CREATE TABLE IF NOT EXISTS course_offerings (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  term TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  import_batch_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (course_id, term, section)
);
CREATE TABLE IF NOT EXISTS offering_teachers (
  offering_id TEXT NOT NULL REFERENCES course_offerings(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
  PRIMARY KEY (offering_id, teacher_id)
);
CREATE TABLE IF NOT EXISTS course_import_batches (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS course_import_previews (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback_tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  email TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_collaborations (
  id TEXT PRIMARY KEY,
  request_post_id TEXT NOT NULL REFERENCES skill_posts(id) ON DELETE RESTRICT,
  offer_post_id TEXT NOT NULL REFERENCES skill_posts(id) ON DELETE RESTRICT,
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'active', 'completed', 'cancelled', 'disputed')),
  scope TEXT NOT NULL,
  started_at TEXT,
  requester_completed_at TEXT,
  provider_completed_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS collaborations_active_request_idx ON skill_collaborations(request_post_id) WHERE status IN ('proposed', 'active', 'disputed');
CREATE TABLE IF NOT EXISTS skill_feedback (
  id TEXT PRIMARY KEY,
  collaboration_id TEXT NOT NULL REFERENCES skill_collaborations(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(collaboration_id, author_id)
);

CREATE TABLE IF NOT EXISTS rate_limits (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, action, window_start)
);
`;

const DEMO_COURSES = [
  {
    id: "course-icga503",
    code: "ICGA503",
    title: "组学数据分析",
    english: "Omics Data Analysis",
    department: "细胞与基因技术研究院",
    type: "专业课",
    enrollment: "选修",
    credits: 2,
    term: "秋季",
    assessment: "考查",
    difficulty: 3.7,
    rating: 9.1,
    content: "示例评价：课程内容前沿，适合有数据分析基础的同学。",
  },
  {
    id: "course-fbee501",
    code: "FBEE501",
    title: "人脑智能与机器智能",
    english: "Human Brain Intelligence",
    department: "生物医学工程学院",
    type: "专业课",
    enrollment: "必修",
    credits: 3,
    term: "秋季",
    assessment: "考试",
    difficulty: 4.1,
    rating: 8.8,
    content: "示例评价：课程覆盖交叉学科主题，项目与汇报需要投入时间。",
  },
  {
    id: "course-fpsb503",
    code: "FPSB503",
    title: "R编程与转录组数据分析入门",
    english: "",
    department: "药学院",
    type: "专业课",
    enrollment: "选修",
    credits: 2,
    term: "春季",
    assessment: "考查",
    difficulty: 3.2,
    rating: 8.5,
    content: "示例评价：建议先熟悉基础 R 语法，再跟随课程练习。",
  },
  {
    id: "course-fsbb503",
    code: "FSBB503",
    title: "计算生物与模拟",
    english: "",
    department: "合成生物学院",
    type: "专业课",
    enrollment: "选修",
    credits: 3,
    term: "秋季",
    assessment: "考查",
    difficulty: 4.5,
    rating: 9.3,
    content: "示例评价：项目比重较高，建议提前安排团队协作。",
  },
];

const DEMO_LISTINGS = [
  {
    id: "listing-keyboard",
    title: "Keychron K2 机械键盘",
    category: "数码电子",
    price: 220,
    condition: "九成新",
    location: "图书馆门前",
    description: "红轴热插拔，蓝牙双模。开发演示商品，请勿据此联系真实卖家。",
  },
  {
    id: "listing-python-book",
    title: "Python 编程与数据科学教材",
    category: "教材书籍",
    price: 45,
    condition: "八成新",
    location: "第一食堂",
    description: "示例二手教材，仅用于本地开发演示。",
  },
  {
    id: "listing-lamp",
    title: "宿舍台灯",
    category: "宿舍用品",
    price: 30,
    condition: "九成新",
    location: "学生宿舍区",
    description: "示例商品数据，可在本地测试分类和详情。",
  },
];

const DEMO_SKILLS = [
  {
    id: "skill-rna-seq",
    kind: "offer",
    title: "组学数据分析 / R",
    category: "数据与科研",
    description: "开发演示内容：可一起梳理 RNA-seq 入门流程与 R 语言基础。",
    tags: ["R", "RNA-seq", "DESeq2"],
    canOffer: "组学分析 / R 入门",
    wants: "嵌入式开发交流",
  },
  {
    id: "skill-design",
    kind: "offer",
    title: "科研图表与信息设计",
    category: "设计创作",
    description: "开发演示内容：交流论文配图、演示文稿与信息排版方法。",
    tags: ["可视化", "排版", "科研表达"],
    canOffer: "图表与设计反馈",
    wants: "生物实验经验交流",
  },
  {
    id: "skill-embedded-help",
    kind: "request",
    title: "求助：STM32 外设调试",
    category: "工程开发",
    description:
      "开发演示内容：正在学习嵌入式开发，希望找同学一起排查基础问题。",
    tags: ["STM32", "嵌入式"],
    canOffer: "整理问题记录与复盘",
    wants: "STM32 调试建议",
  },
];

const DEMO_TREE_POSTS = [
  {
    id: "tree-lab",
    topic: "科研",
    content:
      "刚开始做科研，实验进度比预想慢很多。大家刚进实验室时也有过这种阶段吗？",
  },
  {
    id: "tree-course",
    topic: "选课",
    content: "有人修过组学数据分析吗？想了解作业和实验安排。",
  },
  {
    id: "tree-library",
    topic: "校园生活",
    content: "图书馆靠窗的位置今天阳光很好，提醒自己中途记得起来活动一下。",
  },
];

export function createDatabase(options: DatabaseOptions = {}): AppDatabase {
  const filename =
    options.path ?? resolve(import.meta.dir, "../data/shenxiaoli.sqlite");
  if (filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename, { create: true, strict: true });
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  if (options.migrate !== false) {
    migrateDatabase(db);
  } else {
    const hasMigrations = db
      .query(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
      )
      .get();
    const version = hasMigrations
      ? (db
          .query("SELECT MAX(version) AS version FROM schema_migrations")
          .get() as { version: number | null } | null)
      : null;
    if ((version?.version ?? 0) < SCHEMA_VERSION) {
      db.close();
      throw new Error(
        "Database migrations are incomplete; run `bun run src/migrate.ts` before starting the service.",
      );
    }
  }
  seedDatabase(db, Boolean(options.seedDemoUsers));
  return db;
}

function migrateDatabase(db: AppDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const addColumn = (table: string, name: string, definition: string): void => {
    const columns = db.query(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  };
  const legacy = db
    .query("SELECT version FROM schema_migrations WHERE version = 1")
    .get();
  if (!legacy) {
    db.exec("BEGIN IMMEDIATE");
    try {
      addColumn("users", "email", "TEXT");
      addColumn("users", "email_verified", "INTEGER NOT NULL DEFAULT 0");
      addColumn("users", "is_admin", "INTEGER NOT NULL DEFAULT 0");
      addColumn("users", "account_status", "TEXT NOT NULL DEFAULT 'active'");
      addColumn("users", "suspended_until", "TEXT");
      addColumn("users", "deleted_at", "TEXT");
      addColumn("users", "updated_at", "TEXT NOT NULL DEFAULT ''");
      addColumn(
        "course_reviews",
        "moderation_status",
        "TEXT NOT NULL DEFAULT 'visible'",
      );
      addColumn("course_reviews", "deleted_at", "TEXT");
      addColumn(
        "market_listings",
        "moderation_status",
        "TEXT NOT NULL DEFAULT 'visible'",
      );
      addColumn("market_listings", "deleted_at", "TEXT");
      addColumn(
        "skill_posts",
        "moderation_status",
        "TEXT NOT NULL DEFAULT 'visible'",
      );
      addColumn("skill_posts", "deleted_at", "TEXT");
      addColumn(
        "tree_posts",
        "moderation_status",
        "TEXT NOT NULL DEFAULT 'visible'",
      );
      addColumn("tree_posts", "deleted_at", "TEXT");
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email) WHERE email IS NOT NULL;
        UPDATE users SET updated_at = created_at WHERE updated_at = '';
        UPDATE course_reviews SET moderation_status = 'hidden' WHERE status = 'pending';
        UPDATE tree_posts SET moderation_status = 'hidden' WHERE status = 'pending';
        DELETE FROM sessions;
      `);
      db.query(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)",
      ).run(new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  const versionTwo = db
    .query("SELECT version FROM schema_migrations WHERE version = 2")
    .get();
  if (!versionTwo) {
    db.exec("BEGIN IMMEDIATE");
    try {
      addColumn("skill_collaborations", "completed_at", "TEXT");
      db.query(
        "UPDATE skill_collaborations SET completed_at = updated_at WHERE status = 'completed' AND completed_at IS NULL",
      ).run();
      db.query(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)",
      ).run(new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  const versionThree = db
    .query("SELECT version FROM schema_migrations WHERE version = 3")
    .get();
  if (!versionThree) {
    db.exec("BEGIN IMMEDIATE");
    try {
      addColumn("users", "account_cleanup_completed_at", "TEXT");
      db.query(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?)",
      ).run(new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  const versionFour = db
    .query("SELECT version FROM schema_migrations WHERE version = 4")
    .get();
  if (!versionFour) {
    db.exec("PRAGMA legacy_alter_table = ON");
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("ALTER TABLE reports RENAME TO reports_before_comment_targets");
      db.exec("DROP INDEX IF EXISTS reports_status_idx");
      db.exec(`CREATE TABLE reports (
        id TEXT PRIMARY KEY,
        reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL CHECK (target_type IN ('tree-hole', 'review', 'listing', 'skill', 'comment', 'message')),
        target_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'dismissed')),
        created_at TEXT NOT NULL,
        UNIQUE (reporter_id, target_type, target_id)
      )`);
      db.exec(
        "INSERT INTO reports (id, reporter_id, target_type, target_id, reason, status, created_at) SELECT id, reporter_id, target_type, target_id, reason, status, created_at FROM reports_before_comment_targets",
      );
      db.exec("DROP TABLE reports_before_comment_targets");
      db.exec(
        "CREATE INDEX reports_status_idx ON reports(status, created_at DESC)",
      );
      db.query(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (4, ?)",
      ).run(new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      db.exec("PRAGMA legacy_alter_table = OFF");
      db.exec("PRAGMA foreign_keys = ON");
      throw error;
    }
    db.exec("PRAGMA legacy_alter_table = OFF");
    db.exec("PRAGMA foreign_keys = ON");
  }
  const versionFive = db
    .query("SELECT version FROM schema_migrations WHERE version = 5")
    .get();
  if (!versionFive) {
    db.exec("BEGIN IMMEDIATE");
    try {
      addColumn("moderation_cases", "report_id", "TEXT");
      db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS moderation_cases_report_idx ON moderation_cases(report_id) WHERE report_id IS NOT NULL",
      );
      db.query(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (5, ?)",
      ).run(new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  const versionSix = db
    .query("SELECT version FROM schema_migrations WHERE version = 6")
    .get();
  if (!versionSix) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS moderation_evidence (
        report_id TEXT PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        expires_at TEXT
      )`);
      db.query(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (6, ?)",
      ).run(new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  const versionSeven = db
    .query("SELECT version FROM schema_migrations WHERE version = 7")
    .get();
  if (!versionSeven) {
    db.exec("BEGIN IMMEDIATE");
    try {
      addColumn("courses", "active", "INTEGER NOT NULL DEFAULT 1");
      addColumn(
        "course_reviews",
        "offering_id",
        "TEXT REFERENCES course_offerings(id) ON DELETE SET NULL",
      );
      db.exec(
        "CREATE INDEX IF NOT EXISTS course_reviews_offering_idx ON course_reviews(offering_id, status, created_at DESC)",
      );
      db.exec(`CREATE TABLE IF NOT EXISTS course_import_previews (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`);
      db.query(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (7, ?)",
      ).run(new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  const versionEight = db
    .query("SELECT version FROM schema_migrations WHERE version = 8")
    .get();
  if (!versionEight) {
    db.exec("BEGIN IMMEDIATE");
    try {
      addColumn(
        "email_outbox",
        "delivery_status",
        "TEXT NOT NULL DEFAULT 'unknown'",
      );
      db.query(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (8, ?)",
      ).run(new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  const versionNine = db
    .query("SELECT version FROM schema_migrations WHERE version = 9")
    .get();
  if (!versionNine) {
    db.exec("BEGIN IMMEDIATE");
    try {
      addColumn("skill_posts", "is_demo", "INTEGER NOT NULL DEFAULT 0");
      db.query(
        "UPDATE skill_posts SET is_demo = 1 WHERE id IN ('skill-rna-seq', 'skill-design', 'skill-embedded-help')",
      ).run();
      db.query(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (9, ?)",
      ).run(new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (!db.query("SELECT 1 FROM schema_migrations WHERE version = 10").get()) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE recovery_emails (
          user_id TEXT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          verified_at TEXT NOT NULL
        );
        CREATE TABLE recovery_challenges (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
          purpose TEXT NOT NULL CHECK (purpose IN ('bind', 'unbind', 'login')),
          campus_email TEXT NOT NULL,
          proof_method TEXT NOT NULL CHECK (proof_method IN ('campus', 'auxiliary')),
          proof_email TEXT NOT NULL,
          new_email TEXT,
          code_hash TEXT NOT NULL,
          new_code_hash TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX recovery_challenges_user_idx ON recovery_challenges(user_id, purpose);
        CREATE TABLE recovery_email_cooldowns (
          subject_hash TEXT PRIMARY KEY,
          last_sent_at INTEGER NOT NULL
        );
      `);
      db.query(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (10, ?)",
      ).run(new Date().toISOString());
    })();
  }
}

export function seedDatabase(db: AppDatabase, seedDemoUsers: boolean): void {
  if (!seedDemoUsers) return;
  const now = new Date().toISOString();
  if (seedDemoUsers) {
    db.query(
      `INSERT OR IGNORE INTO users (id, display_name, department, role, created_at)
       VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
    ).run(
      "demo-student",
      "演示狸友",
      "生物医学工程学院",
      "student",
      now,
      "demo-moderator",
      "演示管理员",
      "项目维护组",
      "moderator",
      now,
    );
  }

  const courseCountRow = db
    .query("SELECT COUNT(*) AS count FROM courses")
    .get() as { count: number };
  const courseCount = Number(courseCountRow.count ?? 0);
  if (courseCount === 0) {
    const insertCourse = db.query(
      `INSERT INTO courses
       (id, code, title, english_title, department, course_type, enrollment_type, credits, term, assessment, difficulty, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertReview = db.query(
      `INSERT INTO course_reviews
       (id, course_id, author_label, rating, difficulty, workload, content, tags_json, term, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?)`,
    );
    for (const course of DEMO_COURSES) {
      insertCourse.run(
        course.id,
        course.code,
        course.title,
        course.english,
        course.department,
        course.type,
        course.enrollment,
        course.credits,
        course.term,
        course.assessment,
        course.difficulty,
        now,
      );
      insertReview.run(
        `demo-review-${course.id}`,
        course.id,
        "开发演示评价",
        course.rating,
        course.difficulty,
        Math.min(5, Math.max(1, course.difficulty - 0.3)),
        course.content,
        JSON.stringify(["开发演示数据"]),
        "2026 秋",
        now,
      );
    }
  }

  const listingCountRow = db
    .query("SELECT COUNT(*) AS count FROM market_listings")
    .get() as { count: number };
  const listingCount = Number(listingCountRow.count ?? 0);
  if (listingCount === 0) {
    const insert = db.query(
      `INSERT INTO market_listings
       (id, title, category, price, condition, location, description, images_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 'active', ?, ?)`,
    );
    for (const listing of DEMO_LISTINGS) {
      insert.run(
        listing.id,
        listing.title,
        listing.category,
        listing.price,
        listing.condition,
        listing.location,
        listing.description,
        now,
        now,
      );
    }
  }

  const skillCountRow = db
    .query("SELECT COUNT(*) AS count FROM skill_posts")
    .get() as { count: number };
  const skillCount = Number(skillCountRow.count ?? 0);
  if (skillCount === 0) {
    const insert = db.query(
      `INSERT INTO skill_posts
       (id, kind, title, category, description, tags_json, can_offer, wants, status, created_at, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 1)`,
    );
    for (const skill of DEMO_SKILLS) {
      insert.run(
        skill.id,
        skill.kind,
        skill.title,
        skill.category,
        skill.description,
        JSON.stringify(skill.tags),
        skill.canOffer,
        skill.wants,
        now,
      );
    }
  }

  const treeCountRow = db
    .query("SELECT COUNT(*) AS count FROM tree_posts")
    .get() as { count: number };
  const treeCount = Number(treeCountRow.count ?? 0);
  if (treeCount === 0) {
    const insert = db.query(
      `INSERT INTO tree_posts (id, content, topic, status, created_at)
       VALUES (?, ?, ?, 'approved', ?)`,
    );
    for (const post of DEMO_TREE_POSTS) {
      insert.run(post.id, post.content, post.topic, now);
    }
  }
}
