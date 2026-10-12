import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";

export type AppDatabase = Database;

export interface DatabaseOptions {
  path?: string;
  seedDemoUsers?: boolean;
}

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('student', 'moderator')),
  created_at TEXT NOT NULL
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
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS course_reviews (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_label TEXT NOT NULL DEFAULT '匿名同学',
  rating REAL NOT NULL CHECK (rating >= 1 AND rating <= 10),
  difficulty REAL NOT NULL CHECK (difficulty >= 1 AND difficulty <= 5),
  workload REAL NOT NULL CHECK (workload >= 1 AND workload <= 5),
  content TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  term TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
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
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS skill_posts_public_idx ON skill_posts(status, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS tree_posts (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '校园生活',
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
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
  target_type TEXT NOT NULL CHECK (target_type IN ('tree-hole', 'review', 'listing', 'skill')),
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
  db.exec(SCHEMA);
  seedDatabase(db, Boolean(options.seedDemoUsers));
  return db;
}

function seedDatabase(db: AppDatabase, seedDemoUsers: boolean): void {
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
       (id, kind, title, category, description, tags_json, can_offer, wants, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
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
