import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import { calculateLevel, getUserGamification, awardPoints, updateStreak } from "./gamificationService";

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);
});

describe("userGamification schema", () => {
  it("can insert and retrieve a row", () => {
    const row = testDb
      .insert(schema.userGamification)
      .values({ userId: base.user.id })
      .returning()
      .get();

    expect(row.userId).toBe(base.user.id);
    expect(row.id).toBeDefined();
  });

  it("applies correct default values", () => {
    const row = testDb
      .insert(schema.userGamification)
      .values({ userId: base.user.id })
      .returning()
      .get();

    expect(row.totalPoints).toBe(0);
    expect(row.currentLevel).toBe(1);
    expect(row.currentStreak).toBe(0);
    expect(row.longestStreak).toBe(0);
    expect(row.lastActivityDate).toBeNull();
  });

  it("rejects a second row for the same user", () => {
    testDb.insert(schema.userGamification).values({ userId: base.user.id }).run();

    expect(() =>
      testDb.insert(schema.userGamification).values({ userId: base.user.id }).run()
    ).toThrow();
  });

  it("rejects a row referencing a nonexistent user", () => {
    expect(() =>
      testDb.insert(schema.userGamification).values({ userId: 99999 }).run()
    ).toThrow();
  });
});

describe("awardPoints", () => {
  it("awards 10 points for a lesson completion", () => {
    const result = awardPoints(base.user.id, "lesson_complete", 1);
    expect(result.pointsAwarded).toBe(10);
    expect(getUserGamification(base.user.id).totalPoints).toBe(10);
  });

  it("does not double-award when called twice with the same event", () => {
    awardPoints(base.user.id, "lesson_complete", 1);
    const second = awardPoints(base.user.id, "lesson_complete", 1);
    expect(second.pointsAwarded).toBe(0);
    expect(getUserGamification(base.user.id).totalPoints).toBe(10);
  });

  it("awards 25 points for a quiz first pass", () => {
    const result = awardPoints(base.user.id, "quiz_first_pass", 42);
    expect(result.pointsAwarded).toBe(25);
    expect(getUserGamification(base.user.id).totalPoints).toBe(25);
  });

  it("awards 100 points for course completion", () => {
    const result = awardPoints(base.user.id, "course_complete", base.course.id);
    expect(result.pointsAwarded).toBe(100);
    expect(getUserGamification(base.user.id).totalPoints).toBe(100);
  });

  it("updates level when points cross a threshold", () => {
    // 4 lessons = 40 pts, then a quiz = 25 pts = 65 pts still Beginner
    // need 100 for Apprentice: 9 lessons + 1 quiz = 90 + 25 = 115 pts (crosses 100)
    for (let i = 1; i <= 9; i++) awardPoints(base.user.id, "lesson_complete", i);
    const result = awardPoints(base.user.id, "quiz_first_pass", 1);
    expect(result.currentLevel).toBe(2);
    expect(result.levelName).toBe("Apprentice");
  });

  it("accumulates points across different event types", () => {
    awardPoints(base.user.id, "lesson_complete", 1);   // 10
    awardPoints(base.user.id, "quiz_first_pass", 1);   // 25
    awardPoints(base.user.id, "course_complete", 1);   // 100
    expect(getUserGamification(base.user.id).totalPoints).toBe(135);
  });
});

describe("updateStreak", () => {
  beforeEach(() => {
    testDb.insert(schema.userGamification).values({ userId: base.user.id }).run();
  });

  it("sets streak to 1 on first activity", () => {
    updateStreak(base.user.id, "2024-01-01");
    expect(getUserGamification(base.user.id).currentStreak).toBe(1);
  });

  it("extends streak on consecutive days", () => {
    updateStreak(base.user.id, "2024-01-01");
    updateStreak(base.user.id, "2024-01-02");
    expect(getUserGamification(base.user.id).currentStreak).toBe(2);
  });

  it("does not change streak when called twice on the same day", () => {
    updateStreak(base.user.id, "2024-01-01");
    updateStreak(base.user.id, "2024-01-01");
    expect(getUserGamification(base.user.id).currentStreak).toBe(1);
  });

  it("resets streak to 1 when a day is missed", () => {
    updateStreak(base.user.id, "2024-01-01");
    updateStreak(base.user.id, "2024-01-03"); // gap of 2 days
    expect(getUserGamification(base.user.id).currentStreak).toBe(1);
  });

  it("updates longestStreak when current streak exceeds it", () => {
    updateStreak(base.user.id, "2024-01-01");
    updateStreak(base.user.id, "2024-01-02");
    updateStreak(base.user.id, "2024-01-03");
    const g = getUserGamification(base.user.id);
    expect(g.currentStreak).toBe(3);
    expect(g.longestStreak).toBe(3);
  });

  it("preserves longestStreak after a reset", () => {
    updateStreak(base.user.id, "2024-01-01");
    updateStreak(base.user.id, "2024-01-02");
    updateStreak(base.user.id, "2024-01-03"); // longest = 3
    updateStreak(base.user.id, "2024-01-10"); // reset
    const g = getUserGamification(base.user.id);
    expect(g.currentStreak).toBe(1);
    expect(g.longestStreak).toBe(3);
  });
});

describe("getUserGamification", () => {
  it("returns zeroed defaults for a user with no activity", () => {
    const result = getUserGamification(base.user.id);
    expect(result.totalPoints).toBe(0);
    expect(result.currentLevel).toBe(1);
    expect(result.levelName).toBe("Beginner");
    expect(result.currentStreak).toBe(0);
    expect(result.longestStreak).toBe(0);
    expect(result.pointsToNextLevel).toBe(100);
  });
});

describe("calculateLevel", () => {
  it("returns Beginner for 0 points", () => {
    const result = calculateLevel(0);
    expect(result.level).toBe(1);
    expect(result.name).toBe("Beginner");
  });

  it("returns correct level at every threshold boundary", () => {
    const cases = [
      { pts: 99,  level: 1, name: "Beginner" },
      { pts: 100, level: 2, name: "Apprentice" },
      { pts: 299, level: 2, name: "Apprentice" },
      { pts: 300, level: 3, name: "Practitioner" },
      { pts: 699, level: 3, name: "Practitioner" },
      { pts: 700, level: 4, name: "Proficient" },
      { pts: 1499, level: 4, name: "Proficient" },
      { pts: 1500, level: 5, name: "Advanced" },
      { pts: 2999, level: 5, name: "Advanced" },
      { pts: 3000, level: 6, name: "Expert" },
      { pts: 5999, level: 6, name: "Expert" },
      { pts: 6000, level: 7, name: "Master" },
      { pts: 9999, level: 7, name: "Master" },
    ];
    for (const { pts, level, name } of cases) {
      const r = calculateLevel(pts);
      expect(r.level, `at ${pts} pts`).toBe(level);
      expect(r.name, `at ${pts} pts`).toBe(name);
    }
  });

  it("returns null nextLevelPoints at max level", () => {
    expect(calculateLevel(6000).nextLevelPoints).toBeNull();
  });

  it("returns correct nextLevelPoints below max level", () => {
    expect(calculateLevel(0).nextLevelPoints).toBe(100);
    expect(calculateLevel(50).nextLevelPoints).toBe(100);
    expect(calculateLevel(100).nextLevelPoints).toBe(300);
  });
});
