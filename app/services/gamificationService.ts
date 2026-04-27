import { eq, and } from "drizzle-orm";
import { db } from "~/db";
import { userGamification, gamificationEvents } from "~/db/schema";

const LEVELS = [
  { level: 1, name: "Beginner", minPoints: 0 },
  { level: 2, name: "Apprentice", minPoints: 100 },
  { level: 3, name: "Practitioner", minPoints: 300 },
  { level: 4, name: "Proficient", minPoints: 700 },
  { level: 5, name: "Advanced", minPoints: 1500 },
  { level: 6, name: "Expert", minPoints: 3000 },
  { level: 7, name: "Master", minPoints: 6000 },
] as const;

export function calculateLevel(totalPoints: number) {
  let current = LEVELS[0];
  for (const lvl of LEVELS) {
    if (totalPoints >= lvl.minPoints) current = lvl;
  }
  const nextIndex = LEVELS.findIndex((l) => l.level === current.level) + 1;
  const next = nextIndex < LEVELS.length ? LEVELS[nextIndex] : null;
  return {
    level: current.level,
    name: current.name,
    minPoints: current.minPoints,
    nextLevelPoints: next ? next.minPoints : null,
  };
}

export function getUserGamification(userId: number) {
  const row = db
    .select()
    .from(userGamification)
    .where(eq(userGamification.userId, userId))
    .get();

  const points = row?.totalPoints ?? 0;
  const lvl = calculateLevel(points);

  return {
    totalPoints: points,
    currentLevel: lvl.level,
    levelName: lvl.name,
    currentStreak: row?.currentStreak ?? 0,
    longestStreak: row?.longestStreak ?? 0,
    pointsToNextLevel: lvl.nextLevelPoints != null ? lvl.nextLevelPoints - points : null,
  };
}

const POINTS: Record<string, number> = {
  lesson_complete: 10,
  quiz_first_pass: 25,
  course_complete: 100,
};

export function awardPoints(
  userId: number,
  eventType: "lesson_complete" | "quiz_first_pass" | "course_complete",
  referenceId: number
) {
  const alreadyAwarded = db
    .select()
    .from(gamificationEvents)
    .where(
      and(
        eq(gamificationEvents.userId, userId),
        eq(gamificationEvents.eventType, eventType),
        eq(gamificationEvents.referenceId, referenceId)
      )
    )
    .get();

  if (alreadyAwarded) {
    const current = getUserGamification(userId);
    return { pointsAwarded: 0, currentStreak: current.currentStreak, currentLevel: current.currentLevel, levelName: current.levelName };
  }

  const pointsToAdd = POINTS[eventType];

  db.insert(gamificationEvents).values({ userId, eventType, referenceId }).run();

  const existing = db.select().from(userGamification).where(eq(userGamification.userId, userId)).get();

  const newPoints = (existing?.totalPoints ?? 0) + pointsToAdd;
  const lvl = calculateLevel(newPoints);
  const todayUtc = new Date().toISOString().slice(0, 10);

  if (existing) {
    db.update(userGamification)
      .set({ totalPoints: newPoints, currentLevel: lvl.level })
      .where(eq(userGamification.userId, userId))
      .run();
  } else {
    db.insert(userGamification)
      .values({ userId, totalPoints: newPoints, currentLevel: lvl.level })
      .run();
  }

  updateStreak(userId, todayUtc);

  const updated = getUserGamification(userId);
  return {
    pointsAwarded: pointsToAdd,
    currentStreak: updated.currentStreak,
    currentLevel: updated.currentLevel,
    levelName: updated.levelName,
  };
}

export function updateStreak(userId: number, utcDate: string) {
  const row = db.select().from(userGamification).where(eq(userGamification.userId, userId)).get();

  if (!row) return;

  const last = row.lastActivityDate;

  if (last === utcDate) return;

  let newStreak: number;
  if (!last) {
    newStreak = 1;
  } else {
    const lastDate = new Date(last + "T00:00:00Z");
    const thisDate = new Date(utcDate + "T00:00:00Z");
    const diffDays = Math.round((thisDate.getTime() - lastDate.getTime()) / 86400000);
    newStreak = diffDays === 1 ? row.currentStreak + 1 : 1;
  }

  const newLongest = Math.max(newStreak, row.longestStreak);

  db.update(userGamification)
    .set({ currentStreak: newStreak, longestStreak: newLongest, lastActivityDate: utcDate })
    .where(eq(userGamification.userId, userId))
    .run();
}
